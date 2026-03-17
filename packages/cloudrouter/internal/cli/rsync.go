package cli

import (
	"bytes"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
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

// buildSSHProxyCommand creates an SSH wrapper script that uses cloudrouter's
// built-in __ssh-proxy as ProxyCommand for WebSocket tunneling.
// Uses sshpass or SSH_ASKPASS to provide an empty password non-interactively.
// Returns: sshCmd string (path to wrapper script), cleanup function, error
func buildSSHProxyCommand(wsURL string) (string, func(), error) {
	selfPath, err := getSelfPath()
	if err != nil {
		return "", nil, err
	}

	proxyCmd := fmt.Sprintf("%s __ssh-proxy '%s'", selfPath, wsURL)

	tmpFile, err := os.CreateTemp("", "cmux-ssh-proxy-*.sh")
	if err != nil {
		return "", nil, fmt.Errorf("failed to create SSH wrapper script: %w", err)
	}

	var cleanups []string
	cleanups = append(cleanups, tmpFile.Name())

	var scriptContent string
	if _, err := exec.LookPath("sshpass"); err == nil {
		scriptContent = fmt.Sprintf("#!/bin/sh\nexec sshpass -p '' ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no -o ProxyCommand=%q \"$@\"\n", proxyCmd)
	} else {
		askpassFile, err := os.CreateTemp("", "cmux-askpass-*.sh")
		if err != nil {
			tmpFile.Close()
			os.Remove(tmpFile.Name())
			return "", nil, fmt.Errorf("failed to create askpass script: %w", err)
		}
		if _, err := askpassFile.WriteString("#!/bin/sh\necho ''\n"); err != nil {
			askpassFile.Close()
			os.Remove(askpassFile.Name())
			tmpFile.Close()
			os.Remove(tmpFile.Name())
			return "", nil, fmt.Errorf("failed to write askpass script: %w", err)
		}
		askpassFile.Close()
		os.Chmod(askpassFile.Name(), 0700)
		cleanups = append(cleanups, askpassFile.Name())

		scriptContent = fmt.Sprintf("#!/bin/sh\nexport SSH_ASKPASS=\"%s\"\nexport SSH_ASKPASS_REQUIRE=force\nexport DISPLAY=dummy\nexec ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o PubkeyAuthentication=no -o ProxyCommand=%q \"$@\"\n", askpassFile.Name(), proxyCmd)
	}

	if _, err := tmpFile.WriteString(scriptContent); err != nil {
		tmpFile.Close()
		for _, f := range cleanups {
			os.Remove(f)
		}
		return "", nil, fmt.Errorf("failed to write SSH wrapper script: %w", err)
	}
	tmpFile.Close()

	if err := os.Chmod(tmpFile.Name(), 0700); err != nil {
		for _, f := range cleanups {
			os.Remove(f)
		}
		return "", nil, fmt.Errorf("failed to chmod SSH wrapper script: %w", err)
	}

	cleanup := func() {
		for _, f := range cleanups {
			os.Remove(f)
		}
	}

	return tmpFile.Name(), cleanup, nil
}

// toWebSocketURL converts an HTTP(S) worker URL to a WebSocket URL with auth token
func toWebSocketURL(workerURL, token string) string {
	wsURL := strings.Replace(workerURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	return wsURL + "/ssh?token=" + url.QueryEscape(token)
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

	fmt.Printf("Syncing %d files...\n", totalFiles)

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
	if _, err := exec.LookPath("rsync"); err != nil {
		return fmt.Errorf("rsync not found. Install with: brew install rsync (macOS) or apt install rsync (Linux)")
	}

	wsURL := toWebSocketURL(workerURL, token)
	startTime := time.Now()

	rsyncArgs := buildRsyncArgsSingleFile(localFile, remotePath)

	sshCmd, cleanup, err := buildSSHProxyCommand(wsURL)
	if err != nil {
		return err
	}
	defer cleanup()
	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	remoteSpec := fmt.Sprintf("%s@e2b-sandbox:%s", token, remotePath)
	rsyncArgs = append(rsyncArgs, remoteSpec)

	stats, err := execRsync(rsyncArgs)
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

// runRsyncDownload downloads files from remote sandbox to local using rsync over WebSocket SSH
func runRsyncDownload(workerURL, token, remotePath, localPath string) error {
	if _, err := exec.LookPath("rsync"); err != nil {
		return fmt.Errorf("rsync not found. Install with: brew install rsync (macOS) or apt install rsync (Linux)")
	}

	wsURL := toWebSocketURL(workerURL, token)
	startTime := time.Now()

	rsyncArgs := buildRsyncDownloadArgs()

	sshCmd, cleanup, err := buildSSHProxyCommand(wsURL)
	if err != nil {
		return err
	}
	defer cleanup()
	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	remoteSpec := fmt.Sprintf("%s@e2b-sandbox:%s/", token, remotePath)
	localDest := localPath
	if !strings.HasSuffix(localDest, "/") {
		localDest += "/"
	}
	rsyncArgs = append(rsyncArgs, remoteSpec, localDest)

	stats, err := execRsync(rsyncArgs)
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

// buildRsyncDownloadArgs builds rsync arguments for download (minimal excludes)
func buildRsyncDownloadArgs() []string {
	args := []string{
		"-az",
		"--stats",
		"--no-owner",
		"--no-group",
	}

	// Apply default excludes (e.g., .env files, secrets, build artifacts)
	for _, ex := range defaultExcludes {
		args = append(args, "--exclude", ex)
	}

	return args
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
	wsURL := toWebSocketURL(workerURL, token)

	rsyncArgs := buildRsyncArgs(localPath, remotePath, items)

	sshCmd, cleanup, err := buildSSHProxyCommand(wsURL)
	if err != nil {
		return nil, err
	}
	defer cleanup()
	rsyncArgs = append(rsyncArgs, "-e", sshCmd)

	remoteSpec := fmt.Sprintf("%s@e2b-sandbox:%s/", token, remotePath)
	rsyncArgs = append(rsyncArgs, remoteSpec)

	return execRsync(rsyncArgs)
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

