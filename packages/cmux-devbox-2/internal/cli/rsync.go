package cli

import (
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// Rsync flags - set by sync.go before calling runRsyncOverWebSocket
var (
	rsyncFlagDelete   bool
	rsyncFlagDryRun   bool
	rsyncFlagVerbose  bool
	rsyncFlagExclude  []string
	rsyncFlagParallel int // Number of parallel rsync processes
)

const (
	maxParallelism      = 8  // Max parallel SSH connections
	minFilesForParallel = 50 // Min files before using parallel sync
)

// buildSSHCommand creates an SSH command for use with rsync.
// Creates a wrapper script that calls sshpass or uses SSH_ASKPASS.
// Returns: sshCmd string (path to wrapper script), script path (to be deleted after use), error
func buildSSHCommand(port int) (string, string, error) {
	// Create a wrapper script for SSH with password
	tmpFile, err := os.CreateTemp("", "cmux-ssh-*.sh")
	if err != nil {
		return "", "", fmt.Errorf("failed to create SSH wrapper script: %w", err)
	}

	var scriptContent string
	if _, err := exec.LookPath("sshpass"); err == nil {
		// Use sshpass for password authentication
		scriptContent = fmt.Sprintf(`#!/bin/sh
exec sshpass -p '' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no -p %d "$@"
`, port)
	} else {
		// Fall back to SSH_ASKPASS approach
		// Create askpass helper that echoes empty password
		askpassFile, err := os.CreateTemp("", "cmux-askpass-*.sh")
		if err != nil {
			tmpFile.Close()
			os.Remove(tmpFile.Name())
			return "", "", fmt.Errorf("failed to create askpass script: %w", err)
		}
		if _, err := askpassFile.WriteString("#!/bin/sh\necho ''\n"); err != nil {
			askpassFile.Close()
			os.Remove(askpassFile.Name())
			tmpFile.Close()
			os.Remove(tmpFile.Name())
			return "", "", fmt.Errorf("failed to write askpass script: %w", err)
		}
		askpassFile.Close()
		os.Chmod(askpassFile.Name(), 0700)

		scriptContent = fmt.Sprintf(`#!/bin/sh
export SSH_ASKPASS="%s"
export SSH_ASKPASS_REQUIRE=force
export DISPLAY=dummy
exec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no -p %d "$@"
`, askpassFile.Name(), port)
	}

	if _, err := tmpFile.WriteString(scriptContent); err != nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		return "", "", fmt.Errorf("failed to write SSH wrapper script: %w", err)
	}
	tmpFile.Close()

	// Make executable
	if err := os.Chmod(tmpFile.Name(), 0700); err != nil {
		os.Remove(tmpFile.Name())
		return "", "", fmt.Errorf("failed to chmod SSH wrapper script: %w", err)
	}

	return tmpFile.Name(), tmpFile.Name(), nil
}

// getCurlWithWebSocket returns the path to curl with WebSocket support, or empty string if not found
// We need curl built with WebSocket protocol support (shows "ws" or "wss" in protocols)
func getCurlWithWebSocket() string {
	var curlPaths []string
	if runtime.GOOS == "darwin" {
		// Prefer Homebrew curl which typically has WebSocket support
		curlPaths = []string{
			"/opt/homebrew/opt/curl/bin/curl",
			"/usr/local/opt/curl/bin/curl",
			"/usr/bin/curl",
		}
	} else {
		curlPaths = []string{"curl"}
	}

	for _, path := range curlPaths {
		if _, err := os.Stat(path); err != nil {
			continue
		}
		// Check if this curl supports WebSocket protocol
		out, err := exec.Command(path, "--version").Output()
		if err != nil {
			continue
		}
		// Look for "ws" or "wss" in the Protocols line
		if strings.Contains(string(out), " ws ") || strings.Contains(string(out), " wss ") {
			return path
		}
	}
	return ""
}

// runRsyncOverWebSocket syncs files using rsync over a WebSocket SSH tunnel
func runRsyncOverWebSocket(workerURL, token, localPath, remotePath string) error {
	// Check for rsync
	if _, err := exec.LookPath("rsync"); err != nil {
		return fmt.Errorf("rsync not found. Install with: brew install rsync (macOS) or apt install rsync (Linux)")
	}

	// Count total files to determine parallelism
	totalFiles := countFiles(localPath)

	// Get list of top-level entries for parallel sync
	entries, err := os.ReadDir(localPath)
	if err != nil {
		return fmt.Errorf("failed to read directory: %w", err)
	}

	// Filter out excluded entries
	var syncEntries []string
	for _, entry := range entries {
		name := entry.Name()
		if shouldExcludeEntry(name) {
			continue
		}
		syncEntries = append(syncEntries, name)
	}

	if len(syncEntries) == 0 {
		fmt.Println("No files to sync")
		return nil
	}

	// Determine parallelism based on file count
	// More files = more parallel streams (up to max)
	parallelism := rsyncFlagParallel
	if parallelism <= 0 {
		// Auto-determine based on file count
		if totalFiles < minFilesForParallel {
			parallelism = 1
		} else if totalFiles < 500 {
			parallelism = 2
		} else if totalFiles < 2000 {
			parallelism = 4
		} else if totalFiles < 5000 {
			parallelism = 6
		} else {
			parallelism = maxParallelism
		}
	}

	// Can't have more parallel streams than top-level entries
	if parallelism > len(syncEntries) {
		parallelism = len(syncEntries)
	}

	// For small syncs or single stream, just use single rsync
	if parallelism == 1 {
		startTime := time.Now()
		stats, err := runSingleRsync(workerURL, token, localPath, remotePath, nil)
		if err != nil {
			return err
		}
		elapsed := time.Since(startTime)
		if stats != nil && stats.bytes > 0 {
			speedMBps := float64(stats.bytes) / elapsed.Seconds() / 1024 / 1024
			fmt.Printf("✓ Synced %d files (%.1f MB) in %.1fs (%.1f MB/s)\n",
				stats.files, float64(stats.bytes)/1024/1024, elapsed.Seconds(), speedMBps)
		} else {
			fmt.Println("✓ Sync complete")
		}
		return nil
	}

	// Split entries into chunks for parallel processing
	chunks := splitEntries(syncEntries, parallelism)

	fmt.Printf("Syncing %d files in %d parallel streams...\n", totalFiles, len(chunks))

	// Run parallel rsync processes
	var wg sync.WaitGroup
	results := make(chan rsyncResult, len(chunks))

	startTime := time.Now()

	for i, chunk := range chunks {
		wg.Add(1)
		go func(workerID int, items []string) {
			defer wg.Done()
			result := rsyncResult{workerID: workerID}

			// Run rsync for this chunk
			stats, err := runSingleRsync(workerURL, token, localPath, remotePath, items)
			if err != nil {
				result.err = err
			} else {
				result.stats = stats
			}
			results <- result
		}(i, chunk)
	}

	// Wait for all to complete
	go func() {
		wg.Wait()
		close(results)
	}()

	// Collect results
	var syncedFiles, totalBytes int64
	var errors []error
	for result := range results {
		if result.err != nil {
			errors = append(errors, result.err)
		} else if result.stats != nil {
			syncedFiles += result.stats.files
			totalBytes += result.stats.bytes
		}
	}

	elapsed := time.Since(startTime)

	if len(errors) > 0 {
		for _, err := range errors {
			fmt.Printf("  Error: %v\n", err)
		}
		return fmt.Errorf("%d parallel sync(s) failed", len(errors))
	}

	// Print summary
	speedMBps := float64(totalBytes) / elapsed.Seconds() / 1024 / 1024
	fmt.Printf("✓ Synced %d files (%.1f MB) in %.1fs (%.1f MB/s)\n",
		syncedFiles, float64(totalBytes)/1024/1024, elapsed.Seconds(), speedMBps)

	return nil
}

// runRsyncSingleFile syncs a single file using rsync over WebSocket SSH
func runRsyncSingleFile(workerURL, token, localFile, remotePath string) error {
	// Check for rsync
	if _, err := exec.LookPath("rsync"); err != nil {
		return fmt.Errorf("rsync not found. Install with: brew install rsync (macOS) or apt install rsync (Linux)")
	}

	// Convert HTTP URL to WebSocket URL
	wsURL := strings.Replace(workerURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	wsURL = wsURL + "/ssh?token=" + url.QueryEscape(token)

	startTime := time.Now()

	// Check if curl with WebSocket support is available
	curlPath := getCurlWithWebSocket()
	var stats *rsyncStats
	var err error

	if curlPath != "" {
		stats, err = runRsyncSingleFileWithCurl(curlPath, wsURL, localFile, remotePath)
	} else {
		stats, err = runRsyncSingleFileWithBridge(wsURL, token, localFile, remotePath)
	}

	if err != nil {
		return err
	}

	elapsed := time.Since(startTime)
	if stats != nil && stats.bytes > 0 {
		speedMBps := float64(stats.bytes) / elapsed.Seconds() / 1024 / 1024
		fmt.Printf("✓ Uploaded %s (%.1f MB) in %.1fs (%.1f MB/s)\n",
			filepath.Base(localFile), float64(stats.bytes)/1024/1024, elapsed.Seconds(), speedMBps)
	} else {
		fmt.Printf("✓ Uploaded %s\n", filepath.Base(localFile))
	}

	return nil
}

// runRsyncSingleFileWithCurl uses curl as SSH ProxyCommand for single file transfer
func runRsyncSingleFileWithCurl(curlPath, wsURL, localFile, remotePath string) (*rsyncStats, error) {
	rsyncArgs := buildRsyncArgsSingleFile(localFile, remotePath)

	proxyCmd := fmt.Sprintf("%s --no-progress-meter -N --http1.1 -T . '%s'", curlPath, wsURL)
	sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ProxyCommand=%q", proxyCmd)
	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	// Remote destination
	remoteSpec := fmt.Sprintf("user@e2b-sandbox:%s", remotePath)
	rsyncArgs = append(rsyncArgs, remoteSpec)

	return execRsync(rsyncArgs)
}

// runRsyncSingleFileWithBridge uses Go WebSocket bridge for single file transfer
func runRsyncSingleFileWithBridge(wsURL, token, localFile, remotePath string) (*rsyncStats, error) {
	// Create a local TCP listener that will proxy to the WebSocket
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("failed to create local listener: %w", err)
	}
	defer listener.Close()

	localPort := listener.Addr().(*net.TCPAddr).Port

	// Accept one connection for rsync
	connCh := make(chan net.Conn, 1)
	errCh := make(chan error, 1)

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			errCh <- err
			return
		}
		connCh <- conn
	}()

	rsyncArgs := buildRsyncArgsSingleFile(localFile, remotePath)

	// Create SSH wrapper script
	sshCmd, scriptPath, err := buildSSHCommand(localPort)
	if err != nil {
		return nil, err
	}
	if scriptPath != "" {
		defer os.Remove(scriptPath)
	}

	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	// Remote destination: token@host
	remoteSpec := fmt.Sprintf("%s@127.0.0.1:%s", token, remotePath)
	rsyncArgs = append(rsyncArgs, remoteSpec)

	// Start rsync
	rsyncExec := exec.Command("rsync", rsyncArgs...)

	var stdout, stderr bytes.Buffer
	rsyncExec.Stdout = &stdout
	rsyncExec.Stderr = &stderr

	if err := rsyncExec.Start(); err != nil {
		return nil, fmt.Errorf("failed to start rsync: %w", err)
	}

	// Wait for connection from rsync
	var conn net.Conn
	select {
	case conn = <-connCh:
		// Got connection
	case err := <-errCh:
		rsyncExec.Process.Kill()
		return nil, fmt.Errorf("failed to accept connection: %w", err)
	case <-time.After(30 * time.Second):
		rsyncExec.Process.Kill()
		rsyncExec.Wait()
		return nil, fmt.Errorf("timeout waiting for rsync connection: %s", stderr.String())
	}

	// Bridge to WebSocket
	proxyDone := make(chan error, 1)
	go func() {
		err := bridgeToWebSocket(conn, wsURL)
		proxyDone <- err
	}()

	// Wait for rsync to complete
	rsyncErr := rsyncExec.Wait()
	conn.Close()
	<-proxyDone

	// Parse stats
	stats := parseRsyncStats(stdout.String())

	if rsyncErr != nil {
		stderrStr := stderr.String()
		if strings.Contains(stderrStr, "Warning: Permanently added") && stats != nil && stats.files > 0 {
			return stats, nil
		}
		if len(stderrStr) > 0 {
			return nil, fmt.Errorf("rsync failed: %s", stderrStr)
		}
		return nil, fmt.Errorf("rsync failed: %w", rsyncErr)
	}

	return stats, nil
}

// runRsyncDownload downloads files from remote sandbox to local using rsync over WebSocket SSH
func runRsyncDownload(workerURL, token, remotePath, localPath string) error {
	// Check for rsync
	if _, err := exec.LookPath("rsync"); err != nil {
		return fmt.Errorf("rsync not found. Install with: brew install rsync (macOS) or apt install rsync (Linux)")
	}

	// Convert HTTP URL to WebSocket URL
	wsURL := strings.Replace(workerURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	wsURL = wsURL + "/ssh?token=" + url.QueryEscape(token)

	startTime := time.Now()

	curlPath := getCurlWithWebSocket()
	var stats *rsyncStats
	var err error

	if curlPath != "" {
		stats, err = runRsyncDownloadWithCurl(curlPath, wsURL, remotePath, localPath)
	} else {
		stats, err = runRsyncDownloadWithBridge(wsURL, token, remotePath, localPath)
	}

	if err != nil {
		return err
	}

	elapsed := time.Since(startTime)
	if stats != nil && stats.bytes > 0 {
		speedMBps := float64(stats.bytes) / elapsed.Seconds() / 1024 / 1024
		fmt.Printf("✓ Downloaded %d files (%.1f MB) in %.1fs (%.1f MB/s)\n",
			stats.files, float64(stats.bytes)/1024/1024, elapsed.Seconds(), speedMBps)
	} else {
		fmt.Println("✓ Download complete")
	}

	return nil
}

// runRsyncDownloadWithCurl uses curl as SSH ProxyCommand for download (remote → local)
func runRsyncDownloadWithCurl(curlPath, wsURL, remotePath, localPath string) (*rsyncStats, error) {
	rsyncArgs := buildRsyncDownloadArgs()

	proxyCmd := fmt.Sprintf("%s --no-progress-meter -N --http1.1 -T . '%s'", curlPath, wsURL)
	sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ProxyCommand=%q", proxyCmd)
	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	// Remote as source, local as destination
	remoteSpec := fmt.Sprintf("user@e2b-sandbox:%s/", remotePath)
	localDest := localPath
	if !strings.HasSuffix(localDest, "/") {
		localDest += "/"
	}
	rsyncArgs = append(rsyncArgs, remoteSpec, localDest)

	return execRsync(rsyncArgs)
}

// runRsyncDownloadWithBridge uses Go WebSocket bridge for download (remote → local)
func runRsyncDownloadWithBridge(wsURL, token, remotePath, localPath string) (*rsyncStats, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("failed to create local listener: %w", err)
	}
	defer listener.Close()

	localPort := listener.Addr().(*net.TCPAddr).Port

	connCh := make(chan net.Conn, 1)
	errCh := make(chan error, 1)

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			errCh <- err
			return
		}
		connCh <- conn
	}()

	rsyncArgs := buildRsyncDownloadArgs()

	sshCmd, scriptPath, err := buildSSHCommand(localPort)
	if err != nil {
		return nil, err
	}
	if scriptPath != "" {
		defer os.Remove(scriptPath)
	}

	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	// Remote as source (token as username), local as destination
	remoteSpec := fmt.Sprintf("%s@127.0.0.1:%s/", token, remotePath)
	localDest := localPath
	if !strings.HasSuffix(localDest, "/") {
		localDest += "/"
	}
	rsyncArgs = append(rsyncArgs, remoteSpec, localDest)

	rsyncExec := exec.Command("rsync", rsyncArgs...)

	var stdout, stderr bytes.Buffer
	rsyncExec.Stdout = &stdout
	rsyncExec.Stderr = &stderr

	if err := rsyncExec.Start(); err != nil {
		return nil, fmt.Errorf("failed to start rsync: %w", err)
	}

	var conn net.Conn
	select {
	case conn = <-connCh:
	case err := <-errCh:
		rsyncExec.Process.Kill()
		return nil, fmt.Errorf("failed to accept connection: %w", err)
	case <-time.After(30 * time.Second):
		rsyncExec.Process.Kill()
		rsyncExec.Wait()
		return nil, fmt.Errorf("timeout waiting for rsync connection: %s", stderr.String())
	}

	proxyDone := make(chan error, 1)
	go func() {
		err := bridgeToWebSocket(conn, wsURL)
		proxyDone <- err
	}()

	rsyncErr := rsyncExec.Wait()
	conn.Close()
	<-proxyDone

	stats := parseRsyncStats(stdout.String())

	if rsyncErr != nil {
		stderrStr := stderr.String()
		if strings.Contains(stderrStr, "Warning: Permanently added") && stats != nil && stats.files > 0 {
			return stats, nil
		}
		if len(stderrStr) > 0 {
			return nil, fmt.Errorf("rsync failed: %s", stderrStr)
		}
		return nil, fmt.Errorf("rsync failed: %w", rsyncErr)
	}

	return stats, nil
}

// buildRsyncDownloadArgs builds rsync arguments for download (minimal excludes)
func buildRsyncDownloadArgs() []string {
	return []string{
		"-az",
		"--stats",
		"--no-owner",
		"--no-group",
	}
}

// buildRsyncArgsSingleFile builds rsync arguments for single file transfer
func buildRsyncArgsSingleFile(localFile, remotePath string) []string {
	rsyncArgs := []string{
		"-az",
		"--stats",
		"--no-owner",  // Don't preserve owner (use remote user)
		"--no-group",  // Don't preserve group (use remote group)
	}

	if rsyncFlagDryRun {
		rsyncArgs = append(rsyncArgs, "-n")
	}

	// Add the local file as source
	rsyncArgs = append(rsyncArgs, localFile)

	return rsyncArgs
}

type rsyncResult struct {
	workerID int
	stats    *rsyncStats
	err      error
}

type rsyncStats struct {
	files int64
	bytes int64
}

// countFiles quickly counts files in a directory (for parallelism decision)
func countFiles(dir string) int {
	count := 0
	filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		name := d.Name()
		// Skip excluded directories
		if d.IsDir() && shouldExcludeEntry(name) {
			return filepath.SkipDir
		}
		if !d.IsDir() && !shouldExcludeEntry(name) {
			count++
		}
		return nil
	})
	return count
}

// defaultExcludes contains patterns that should never be synced.
// These fall into categories:
// 1. Dependencies (agents can run install commands)
// 2. Build artifacts (agents can rebuild)
// 3. Caches (regenerated automatically)
// 4. Secrets/credentials (security)
// 5. OS/IDE files (not needed)
// 6. Logs/temp files (not needed)
var defaultExcludes = []string{
	// === Version control ===
	".git",
	".hg",
	".svn",

	// === Package manager dependencies (agents run install) ===
	"node_modules",
	".pnpm-store",
	"vendor",           // Go, PHP, Ruby
	"target",           // Rust, Java/Maven
	".gradle",          // Gradle
	"Pods",             // iOS CocoaPods
	".dart_tool",       // Dart/Flutter
	".pub-cache",       // Dart/Flutter
	".bundle",          // Ruby Bundler
	"elm-stuff",        // Elm
	"bower_components", // Bower (legacy)
	"jspm_packages",    // JSPM (legacy)

	// === Virtual environments (agents can create) ===
	".venv",
	"venv",
	"env",
	"virtualenv",
	".virtualenv",
	".conda",
	"conda-env",
	".pixi",

	// === Build artifacts (agents can rebuild) ===
	"dist",
	"build",
	"out",
	".next",       // Next.js
	".nuxt",       // Nuxt.js
	".output",     // Nuxt 3
	".svelte-kit", // SvelteKit
	".vercel",     // Vercel
	".netlify",    // Netlify
	"storybook-static",
	"coverage",
	".nyc_output",

	// === Caches (regenerated automatically) ===
	".cache",
	".turbo",        // Turborepo
	".parcel-cache", // Parcel
	".webpack",      // Webpack
	".rollup.cache", // Rollup
	".eslintcache",
	".stylelintcache",
	".prettiercache",
	"__pycache__",
	".mypy_cache",
	".pytest_cache",
	".ruff_cache",
	".tox",
	".nox",
	".hypothesis",
	"*.egg-info",
	".eggs",

	// === Secrets and credentials (security) ===
	".npmrc",     // May contain auth tokens
	".yarnrc",    // May contain auth tokens
	".yarnrc.yml",
	"auth.json",
	".netrc",
	"credentials.json",
	"secrets.json",
	"*.pem",
	"*.key",
	"*.p12",
	"*.pfx",
	".aws",
	".docker/config.json",

	// === OS and IDE files ===
	".DS_Store",
	"Thumbs.db",
	"desktop.ini",
	".Spotlight-V100",
	".Trashes",
	".idea",        // JetBrains
	"*.swp",        // Vim
	"*.swo",        // Vim
	"*~",           // Backup files
	".project",     // Eclipse
	".classpath",   // Eclipse
	".settings",    // Eclipse
	"*.sublime-*",

	// === Logs and temp files ===
	"*.log",
	"logs",
	"tmp",
	"temp",
	".temp",
	".tmp",
	"npm-debug.log*",
	"yarn-debug.log*",
	"yarn-error.log*",
	"pnpm-debug.log*",
	"lerna-debug.log*",

	// === Compiled files (can be regenerated) ===
	"*.pyc",
	"*.pyo",
	"*.o",
	"*.obj",
	"*.so",
	"*.dylib",
	"*.dll",
	"*.class",

	// === Large generated files ===
	"*.js.map",  // Source maps (if not needed for debugging)
	"*.css.map", // Source maps
}

func shouldExcludeEntry(name string) bool {
	excludes := append([]string{}, defaultExcludes...)
	excludes = append(excludes, rsyncFlagExclude...)

	for _, ex := range excludes {
		if name == ex {
			return true
		}
		// Handle glob patterns
		if strings.HasPrefix(ex, "*") && strings.HasSuffix(name, ex[1:]) {
			return true
		}
		if strings.HasSuffix(ex, "*") && strings.HasPrefix(name, ex[:len(ex)-1]) {
			return true
		}
	}
	return false
}

func splitEntries(entries []string, n int) [][]string {
	chunks := make([][]string, n)
	for i, entry := range entries {
		chunks[i%n] = append(chunks[i%n], entry)
	}
	// Remove empty chunks
	var result [][]string
	for _, chunk := range chunks {
		if len(chunk) > 0 {
			result = append(result, chunk)
		}
	}
	return result
}

// runSingleRsync runs a single rsync process, optionally for specific items only
// Tries curl with WebSocket support first, falls back to Go WebSocket bridge
func runSingleRsync(workerURL, token, localPath, remotePath string, items []string) (*rsyncStats, error) {
	// Convert HTTP URL to WebSocket URL
	wsURL := strings.Replace(workerURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	wsURL = wsURL + "/ssh?token=" + url.QueryEscape(token)

	// Check if curl with WebSocket support is available
	curlPath := getCurlWithWebSocket()
	if curlPath != "" {
		return runRsyncWithCurl(curlPath, wsURL, localPath, remotePath, items)
	}

	// Fall back to Go WebSocket bridge
	return runRsyncWithBridge(wsURL, token, localPath, remotePath, items)
}

// runRsyncWithCurl uses curl as SSH ProxyCommand for WebSocket tunneling
func runRsyncWithCurl(curlPath, wsURL, localPath, remotePath string, items []string) (*rsyncStats, error) {
	rsyncArgs := buildRsyncArgs(localPath, remotePath, items)

	// SSH command using curl as ProxyCommand for WebSocket tunneling
	// curl flags:
	//   --no-progress-meter: suppress progress output
	//   -N: disable buffering
	//   --http1.1: force HTTP/1.1 (required for WebSocket upgrade)
	//   -T .: read stdin and send as request body (bidirectional tunnel)
	// Note: URL must be single-quoted to prevent shell glob expansion of '?' in query string
	proxyCmd := fmt.Sprintf("%s --no-progress-meter -N --http1.1 -T . '%s'", curlPath, wsURL)
	sshCmd := fmt.Sprintf("ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ProxyCommand=%q", proxyCmd)
	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	// Remote destination - hostname doesn't matter since ProxyCommand handles the connection
	remoteSpec := fmt.Sprintf("user@e2b-sandbox:%s/", remotePath)
	rsyncArgs = append(rsyncArgs, remoteSpec)

	return execRsync(rsyncArgs)
}

// runRsyncWithBridge uses a Go WebSocket bridge for SSH tunneling
// Uses token-as-username auth with empty password
func runRsyncWithBridge(wsURL, token, localPath, remotePath string, items []string) (*rsyncStats, error) {
	// Create a local TCP listener that will proxy to the WebSocket
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("failed to create local listener: %w", err)
	}
	defer listener.Close()

	localPort := listener.Addr().(*net.TCPAddr).Port

	// Accept one connection for rsync
	connCh := make(chan net.Conn, 1)
	errCh := make(chan error, 1)

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			errCh <- err
			return
		}
		connCh <- conn
	}()

	rsyncArgs := buildRsyncArgs(localPath, remotePath, items)

	// Create SSH wrapper script
	sshCmd, scriptPath, err := buildSSHCommand(localPort)
	if err != nil {
		return nil, err
	}
	if scriptPath != "" {
		defer os.Remove(scriptPath)
	}

	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	// Remote destination: token@host (token is the username!)
	remoteSpec := fmt.Sprintf("%s@127.0.0.1:%s/", token, remotePath)
	rsyncArgs = append(rsyncArgs, remoteSpec)

	// Start rsync
	rsyncExec := exec.Command("rsync", rsyncArgs...)

	var stdout, stderr bytes.Buffer
	rsyncExec.Stdout = &stdout
	rsyncExec.Stderr = &stderr

	if err := rsyncExec.Start(); err != nil {
		return nil, fmt.Errorf("failed to start rsync: %w", err)
	}

	// Wait for connection from rsync
	var conn net.Conn
	select {
	case conn = <-connCh:
		// Got connection
	case err := <-errCh:
		rsyncExec.Process.Kill()
		return nil, fmt.Errorf("failed to accept connection: %w", err)
	case <-time.After(30 * time.Second):
		rsyncExec.Process.Kill()
		return nil, fmt.Errorf("timeout waiting for rsync connection")
	}

	// Bridge to WebSocket
	proxyDone := make(chan error, 1)
	go func() {
		err := bridgeToWebSocket(conn, wsURL)
		proxyDone <- err
	}()

	// Wait for rsync to complete
	rsyncErr := rsyncExec.Wait()
	conn.Close()
	<-proxyDone

	// Parse stats first - rsync might have succeeded even with SSH warnings
	stats := parseRsyncStats(stdout.String())

	if rsyncErr != nil {
		// Check if it's just SSH warnings (not real errors)
		stderrStr := stderr.String()
		if strings.Contains(stderrStr, "Warning: Permanently added") && stats != nil && stats.files > 0 {
			// SSH host key warning is not a real error, sync succeeded
			return stats, nil
		}
		if len(stderrStr) > 0 {
			return nil, fmt.Errorf("rsync failed: %s", stderrStr)
		}
		return nil, fmt.Errorf("rsync failed: %w", rsyncErr)
	}

	return stats, nil
}

// buildRsyncArgs builds common rsync arguments
func buildRsyncArgs(localPath, remotePath string, items []string) []string {
	rsyncArgs := []string{
		"-az",
		"--stats",
		"--no-owner",  // Don't preserve owner (use remote user)
		"--no-group",  // Don't preserve group (use remote group)
	}

	if rsyncFlagDelete {
		rsyncArgs = append(rsyncArgs, "--delete")
	}
	if rsyncFlagDryRun {
		rsyncArgs = append(rsyncArgs, "-n")
	}

	// Add excludes
	for _, ex := range defaultExcludes {
		rsyncArgs = append(rsyncArgs, "--exclude", ex)
	}
	for _, ex := range rsyncFlagExclude {
		rsyncArgs = append(rsyncArgs, "--exclude", ex)
	}

	// Source path(s)
	if items == nil {
		srcPath := localPath
		if !strings.HasSuffix(srcPath, "/") {
			srcPath = srcPath + "/"
		}
		rsyncArgs = append(rsyncArgs, srcPath)
	} else {
		for _, item := range items {
			itemPath := filepath.Join(localPath, item)
			info, err := os.Stat(itemPath)
			if err != nil {
				continue
			}
			if info.IsDir() {
				rsyncArgs = append(rsyncArgs, "--include", item+"/***")
			} else {
				rsyncArgs = append(rsyncArgs, "--include", item)
			}
		}
		rsyncArgs = append(rsyncArgs, "--exclude", "*")
		srcPath := localPath
		if !strings.HasSuffix(srcPath, "/") {
			srcPath = srcPath + "/"
		}
		rsyncArgs = append(rsyncArgs, srcPath)
	}

	return rsyncArgs
}

// execRsync runs rsync and returns stats
func execRsync(rsyncArgs []string) (*rsyncStats, error) {
	rsyncExec := exec.Command("rsync", rsyncArgs...)

	var stdout, stderr bytes.Buffer
	rsyncExec.Stdout = &stdout
	rsyncExec.Stderr = &stderr

	if err := rsyncExec.Run(); err != nil {
		if stderr.Len() > 0 {
			return nil, fmt.Errorf("rsync failed: %s", stderr.String())
		}
		return nil, fmt.Errorf("rsync failed: %w", err)
	}

	return parseRsyncStats(stdout.String()), nil
}

// bridgeToWebSocket bridges a TCP connection to a WebSocket
func bridgeToWebSocket(conn net.Conn, wsURL string) error {
	defer conn.Close()

	// Buffer to hold TCP data that arrives before WebSocket is connected
	var pendingData [][]byte
	var pendingMu sync.Mutex
	wsReady := false

	// Start reading from TCP immediately
	tcpDataCh := make(chan []byte, 100)
	tcpErrCh := make(chan error, 1)

	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := conn.Read(buf)
			if err != nil {
				tcpErrCh <- err
				return
			}
			data := make([]byte, n)
			copy(data, buf[:n])
			tcpDataCh <- data
		}
	}()

	// Connect to WebSocket
	dialer := websocket.Dialer{
		HandshakeTimeout:  30 * time.Second,
		EnableCompression: false,
	}

	wsConn, _, err := dialer.Dial(wsURL, http.Header{})
	if err != nil {
		return fmt.Errorf("WebSocket connect failed: %w", err)
	}
	defer wsConn.Close()

	// Flush pending data
	pendingMu.Lock()
	wsReady = true
	for _, data := range pendingData {
		if err := wsConn.WriteMessage(websocket.BinaryMessage, data); err != nil {
			pendingMu.Unlock()
			return fmt.Errorf("failed to send pending data: %w", err)
		}
	}
	pendingData = nil
	pendingMu.Unlock()

	// Bridge TCP <-> WebSocket
	done := make(chan struct{})

	go func() {
		defer close(done)
		for {
			select {
			case data := <-tcpDataCh:
				pendingMu.Lock()
				if wsReady {
					pendingMu.Unlock()
					if err := wsConn.WriteMessage(websocket.BinaryMessage, data); err != nil {
						return
					}
				} else {
					pendingData = append(pendingData, data)
					pendingMu.Unlock()
				}
			case err := <-tcpErrCh:
				if err != io.EOF {
					// Ignore
				}
				wsConn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
				return
			}
		}
	}()

	go func() {
		for {
			messageType, data, err := wsConn.ReadMessage()
			if err != nil {
				conn.Close()
				return
			}
			if messageType == websocket.BinaryMessage || messageType == websocket.TextMessage {
				if _, err := conn.Write(data); err != nil {
					return
				}
			}
		}
	}()

	<-done
	return nil
}

var (
	// Match both GNU rsync and openrsync (macOS) formats
	filesTransferredRe = regexp.MustCompile(`Number of (?:regular )?files transferred:\s*(\d+)`)
	totalBytesRe       = regexp.MustCompile(`Total transferred file size:\s*([\d,]+)\s*(?:B|bytes)?`)
)

func parseRsyncStats(output string) *rsyncStats {
	stats := &rsyncStats{}

	if match := filesTransferredRe.FindStringSubmatch(output); len(match) > 1 {
		stats.files, _ = strconv.ParseInt(match[1], 10, 64)
	}

	if match := totalBytesRe.FindStringSubmatch(output); len(match) > 1 {
		// Remove commas and parse
		bytesStr := strings.ReplaceAll(match[1], ",", "")
		stats.bytes, _ = strconv.ParseInt(bytesStr, 10, 64)
	}

	return stats
}

