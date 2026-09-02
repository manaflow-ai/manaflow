// cmd/worker/main.go
// Worker daemon for E2B cmux sandbox - Go implementation
package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	cryptossh "golang.org/x/crypto/ssh"
)

const (
	httpPort     = 39377
	sshPort      = 10000
	cdpPort      = 9222
	vscodePort   = 39378
	vncPort      = 39380
	workspaceDir = "/home/user/workspace"

	authTokenPath   = "/home/user/.worker-auth-token"
	vscodeTokenPath = "/home/user/.vscode-token"
	bootIDPath      = "/home/user/.token-boot-id"
	authCookieName  = "_cmux_auth"
)

var (
	authToken   string
	authTokenMu sync.RWMutex

	// PTY sessions
	ptySessions   = make(map[string]*ptySession)
	ptySessionsMu sync.RWMutex

	wsUpgrader = websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
)

type ptySession struct {
	ID        string
	PTY       *os.File
	Cmd       *exec.Cmd
	CreatedAt time.Time
	Shell     string
	Cwd       string
	Cols      uint16
	Rows      uint16
}

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	log.Printf("[worker] Starting cmux worker daemon...")
	if err := dropPrivilegesToWorkerUser(); err != nil {
		log.Fatalf("[worker] refusing to start with unsafe privileges: %v", err)
	}

	// Initialize auth token
	initAuthToken()

	// Start SSH server in goroutine
	go startSSHServer()

	// Start VNC auth proxy in goroutine
	vncProxySrv := newVNCProxy()
	go vncProxySrv.Start()

	// Start HTTP server (browser manager is cleaned up on shutdown)
	startHTTPServer(vncProxySrv)
}

// =============================================================================
// Auth Token Management
// =============================================================================

func initAuthToken() {
	currentBootID := getCurrentBootID()
	savedBootID := getSavedBootID()

	if currentBootID == "" || savedBootID == "" || currentBootID != savedBootID {
		log.Printf("[worker] Boot ID changed, generating fresh token")
		authToken = generateFreshToken()
	} else {
		existing := getExistingToken()
		if existing != "" {
			authToken = existing
			log.Printf("[worker] Using existing auth token")
		} else {
			authToken = generateFreshToken()
		}
	}
}

func getCurrentBootID() string {
	data, err := os.ReadFile("/proc/sys/kernel/random/boot_id")
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func getSavedBootID() string {
	data, err := readSecretFile(bootIDPath)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func getExistingToken() string {
	data, err := readSecretFile(authTokenPath)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}

func generateFreshToken() string {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		log.Printf("[worker] Failed to generate random token: %v", err)
		return ""
	}
	token := hex.EncodeToString(bytes)
	bootID := getCurrentBootID()

	// Write token files
	if err := writeSecretFile(authTokenPath, token); err != nil {
		log.Printf("[worker] Failed to write auth token: %v", err)
		return ""
	}
	if err := writeSecretFile(vscodeTokenPath, token); err != nil {
		log.Printf("[worker] Failed to write vscode token: %v", err)
		return ""
	}
	if bootID != "" {
		if err := writeSecretFile(bootIDPath, bootID); err != nil {
			log.Printf("[worker] Failed to write boot ID: %v", err)
			return ""
		}
	}

	log.Printf("[worker] Fresh auth token generated")
	return token
}

func writeSecretFile(path, value string) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".worker-secret-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(tempPath)
		}
	}()
	if err := temp.Chmod(0600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.WriteString(value); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		return err
	}
	removeTemp = false
	return nil
}

func ensureValidToken() string {
	authTokenMu.Lock()
	defer authTokenMu.Unlock()

	currentBootID := getCurrentBootID()
	savedBootID := getSavedBootID()

	if currentBootID == "" || savedBootID == "" || currentBootID != savedBootID {
		log.Printf("[worker] Boot ID changed, regenerating token")
		authToken = generateFreshToken()
	}

	if authToken == "" {
		existing := getExistingToken()
		if existing != "" {
			authToken = existing
		} else {
			authToken = generateFreshToken()
		}
	}

	return authToken
}

func verifyAuth(r *http.Request) bool {
	return requestHasValidToken(r, ensureValidToken())
}

func requestHasValidToken(r *http.Request, token string) bool {
	// Check Authorization header
	if auth := r.Header.Get("Authorization"); auth != "" {
		if strings.HasPrefix(auth, "Bearer ") {
			if constantTimeTokenMatch(auth[7:], token) {
				return true
			}
		} else if constantTimeTokenMatch(auth, token) {
			return true
		}
	}

	// Query tokens are retained only for WebSocket clients that cannot set an
	// Authorization header through the SSH proxy. Ordinary HTTP API requests
	// must use the header or cookie so URLs do not carry bearer credentials.
	if r.URL.Path == "/pty" || r.URL.Path == "/ssh" {
		if constantTimeTokenMatch(r.URL.Query().Get("token"), token) {
			return true
		}
	}

	// Check cookie
	if cookie, err := r.Cookie(authCookieName); err == nil && constantTimeTokenMatch(cookie.Value, token) {
		return true
	}

	return false
}

func constantTimeTokenMatch(provided, expected string) bool {
	if provided == "" || expected == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

// =============================================================================
// HTTP Server
// =============================================================================

func startHTTPServer(vncProxySrv *vncProxy) {
	mux := http.NewServeMux()

	// Health check - no auth
	mux.HandleFunc("/health", handleHealth)

	// Auth token endpoint - localhost only
	mux.HandleFunc("/auth-token", handleAuthToken)

	// Auth cookie setter
	mux.HandleFunc("/_cmux/auth", handleAuthCookie)

	// All other endpoints require auth
	mux.HandleFunc("/", handleAPI)

	server := &http.Server{
		Addr:    fmt.Sprintf("0.0.0.0:%d", httpPort),
		Handler: corsMiddleware(mux),
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
		<-sigCh
		log.Printf("[worker] Shutting down...")
		browser.Close()
		vncProxySrv.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(ctx)
	}()

	log.Printf("[worker] HTTP server listening on port %d", httpPort)
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("[worker] HTTP server error: %v", err)
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, map[string]interface{}{
		"status":        "ok",
		"provider":      "e2b",
		"authenticated": false,
	})
}

func handleAuthToken(w http.ResponseWriter, r *http.Request) {
	// Only allow from localhost
	host, _, _ := net.SplitHostPort(r.RemoteAddr)
	if host != "127.0.0.1" && host != "::1" && host != "::ffff:127.0.0.1" {
		sendJSON(w, map[string]string{"error": "Forbidden"})
		return
	}
	sendJSON(w, map[string]string{"token": ensureValidToken()})
}

func handleAuthCookie(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	returnPath := r.URL.Query().Get("return")
	if !isSafeRedirectPath(returnPath) {
		returnPath = "/"
	}

	currentToken := ensureValidToken()
	if !constantTimeTokenMatch(token, currentToken) {
		w.WriteHeader(http.StatusUnauthorized)
		sendJSON(w, map[string]string{"error": "Invalid token"})
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     authCookieName,
		Value:    token,
		Path:     "/",
		MaxAge:   86400,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, returnPath, http.StatusFound)
}

func isSafeRedirectPath(path string) bool {
	return path != "" && strings.HasPrefix(path, "/") && !strings.HasPrefix(path, "//") && !strings.Contains(path, "\\")
}

func handleAPI(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// WebSocket endpoints
	if path == "/pty" {
		if !verifyAuth(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		handlePTYWebSocket(w, r)
		return
	}
	if path == "/ssh" {
		if !verifyAuth(r) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		handleSSHWebSocket(w, r)
		return
	}

	// Require auth for all other endpoints
	if !verifyAuth(r) {
		w.WriteHeader(http.StatusUnauthorized)
		sendJSON(w, map[string]string{"error": "Unauthorized"})
		return
	}

	// Parse body for POST requests
	var body map[string]interface{}
	if r.Method == "POST" {
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
			w.WriteHeader(http.StatusBadRequest)
			sendJSON(w, map[string]string{"error": "Invalid JSON"})
			return
		}
		if body == nil {
			body = make(map[string]interface{})
		}
	}

	switch path {
	case "/exec":
		handleExec(w, r, body)
	case "/read-file":
		handleReadFile(w, r, body)
	case "/write-file":
		handleWriteFile(w, r, body)
	case "/delete-file":
		handleDeleteFile(w, r, body)
	case "/list-files":
		handleListFiles(w, r, body)
	case "/status":
		handleStatus(w, r)
	case "/services":
		handleServices(w, r)
	case "/pty-sessions":
		handlePTYSessions(w, r)
	case "/cdp-info":
		handleCDPInfo(w, r)
	case "/screenshot":
		handleScreenshot(w, r, body)
	// Browser automation (screenshot returns base64 data, browser-agent runs in agent mode)
	// All other browser commands go through /exec with "agent-browser <command>"
	case "/browser-agent":
		handleBrowserAgent(w, r, body)
	default:
		w.WriteHeader(http.StatusNotFound)
		sendJSON(w, map[string]string{"error": "Not found"})
	}
}

// =============================================================================
// API Handlers
// =============================================================================

func handleExec(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
	command, _ := body["command"].(string)
	if command == "" {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "command required"})
		return
	}

	timeout := 60 * time.Second
	if t, ok := body["timeout"].(float64); ok {
		timeout = time.Duration(t) * time.Millisecond
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// The endpoint intentionally executes a user-requested shell command, but
	// the daemon itself has already dropped to the unprivileged worker user.
	cmd := exec.CommandContext(ctx, "/bin/bash", "-lc", command)
	cmd.Dir = workspaceDir
	cmd.Env = append(os.Environ(), "FORCE_COLOR=0")

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	exitCode := 0
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	} else if runErr != nil {
		exitCode = 1
		if stderr.Len() == 0 {
			stderr.WriteString(runErr.Error())
		}
	}

	sendJSON(w, map[string]interface{}{
		"stdout":    strings.TrimSpace(stdout.String()),
		"stderr":    strings.TrimSpace(stderr.String()),
		"exit_code": exitCode,
	})
}

func handleReadFile(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
	rawPath, _ := body["path"].(string)
	if rawPath == "" {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path required"})
		return
	}
	path, err := resolveExistingPathWithin(workspaceDir, rawPath, false)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path must be inside workspace"})
		return
	}

	content, err := readWorkspaceFile(path)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		sendJSON(w, map[string]string{"error": err.Error()})
		return
	}

	sendJSON(w, map[string]string{"content": string(content)})
}

func handleWriteFile(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
	rawPath, _ := body["path"].(string)
	content, hasContent := body["content"].(string)
	if rawPath == "" || !hasContent {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path and content required"})
		return
	}
	path, err := resolveWorkspacePath(rawPath, false)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path must be inside workspace"})
		return
	}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		sendJSON(w, map[string]string{"error": err.Error()})
		return
	}

	if err := writeWorkspaceFile(path, []byte(content), 0644); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		sendJSON(w, map[string]string{"error": err.Error()})
		return
	}

	sendJSON(w, map[string]bool{"success": true})
}

func handleDeleteFile(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
	rawPath, _ := body["path"].(string)
	if rawPath == "" {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path required"})
		return
	}
	path, err := resolveWorkspacePath(rawPath, false)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path must be inside workspace"})
		return
	}

	if err := os.RemoveAll(path); err != nil && !os.IsNotExist(err) {
		w.WriteHeader(http.StatusInternalServerError)
		sendJSON(w, map[string]string{"error": err.Error()})
		return
	}

	sendJSON(w, map[string]bool{"success": true})
}

func handleListFiles(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
	rawPath, _ := body["path"].(string)
	if rawPath == "" {
		rawPath = workspaceDir
	}
	dirPath, err := resolveWorkspacePath(rawPath, true)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path must be inside workspace"})
		return
	}
	if info, statErr := os.Stat(dirPath); statErr != nil || !info.IsDir() {
		w.WriteHeader(http.StatusBadRequest)
		sendJSON(w, map[string]string{"error": "path must be a directory"})
		return
	}

	recursive := true
	if r, ok := body["recursive"].(bool); ok {
		recursive = r
	}

	var files []map[string]interface{}
	skipDirs := map[string]bool{"node_modules": true, ".git": true, ".venv": true}

	var walkDir func(dir, base string) error
	walkDir = func(dir, base string) error {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}

		for _, entry := range entries {
			if skipDirs[entry.Name()] {
				continue
			}

			fullPath := filepath.Join(dir, entry.Name())
			relativePath := filepath.Join(base, entry.Name())

			if entry.IsDir() {
				if recursive {
					if err := walkDir(fullPath, relativePath); err != nil {
						return err
					}
				}
			} else {
				info, err := entry.Info()
				if err != nil {
					continue
				}
				files = append(files, map[string]interface{}{
					"path":  relativePath,
					"size":  info.Size(),
					"mtime": info.ModTime().UnixMilli(),
				})
			}
		}
		return nil
	}

	if err := walkDir(dirPath, ""); err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		sendJSON(w, map[string]string{"error": err.Error()})
		return
	}

	sendJSON(w, map[string]interface{}{
		"files":    files,
		"basePath": dirPath,
	})
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, map[string]interface{}{
		"provider":     "e2b",
		"cdpAvailable": isCDPAvailable(),
		"vncAvailable": true,
	})
}

func handleServices(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, map[string]interface{}{
		"vscode": map[string]interface{}{"running": isProcessRunning("code-server-oss"), "port": vscodePort},
		"chrome": map[string]interface{}{"running": isProcessRunning("chrome.*remote-debugging"), "port": cdpPort},
		"vnc":    map[string]interface{}{"running": isProcessRunning("vncserver"), "port": 5901},
		"novnc":  map[string]interface{}{"running": isProcessRunning("novnc_proxy"), "port": vncPort},
		"worker": map[string]interface{}{"running": true, "port": httpPort},
	})
}

func handlePTYSessions(w http.ResponseWriter, r *http.Request) {
	ptySessionsMu.RLock()
	defer ptySessionsMu.RUnlock()

	sessions := make([]map[string]interface{}, 0, len(ptySessions))
	for id, s := range ptySessions {
		sessions = append(sessions, map[string]interface{}{
			"id":        id,
			"createdAt": s.CreatedAt.UnixMilli(),
			"shell":     s.Shell,
			"cwd":       s.Cwd,
			"connected": s.PTY != nil,
		})
	}

	sendJSON(w, map[string]interface{}{
		"success":  true,
		"sessions": sessions,
	})
}

func handleCDPInfo(w http.ResponseWriter, r *http.Request) {
	wsURL := getCDPWebSocketURL()
	if wsURL == "" {
		w.WriteHeader(http.StatusServiceUnavailable)
		sendJSON(w, map[string]string{"error": "Chrome CDP not available"})
		return
	}

	sendJSON(w, map[string]interface{}{
		"wsUrl":        wsURL,
		"httpEndpoint": fmt.Sprintf("http://localhost:%d", cdpPort),
	})
}

func handleScreenshot(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
	result, err := browser.Screenshot()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		sendJSON(w, map[string]string{"error": err.Error()})
		return
	}

	// If a custom path was requested, save there too.
	if p, ok := body["path"].(string); ok && p != "" {
		path, err := resolveWorkspacePath(p, false)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			sendJSON(w, map[string]string{"error": "path must be inside workspace"})
			return
		}
		if b64, ok := result["base64"].(string); ok {
			if raw, err := base64.StdEncoding.DecodeString(b64); err == nil {
				if err := writeWorkspaceFile(path, raw, 0644); err != nil {
					log.Printf("[worker] failed to save screenshot: %v", err)
				} else {
					result["path"] = path
				}
			}
		}
	}

	sendJSON(w, result)
}

func handleBrowserAgent(w http.ResponseWriter, r *http.Request, body map[string]interface{}) {
	result, err := browser.RunBrowserAgent(body)
	if err != nil {
		log.Printf("[worker] browser-agent failed: %v", err)
		sendJSON(w, map[string]interface{}{"error": err.Error()})
		return
	}
	sendJSON(w, result)
}

// =============================================================================
// PTY WebSocket Handler
// =============================================================================

func handlePTYWebSocket(w http.ResponseWriter, r *http.Request) {
	// Parse options from query
	q := r.URL.Query()
	cols := parseUint16(q.Get("cols"), 80)
	rows := parseUint16(q.Get("rows"), 24)
	cwd := q.Get("cwd")
	if cwd == "" {
		cwd = workspaceDir
	}
	var err error
	cwd, err = resolveWorkspacePath(cwd, true)
	if err != nil {
		http.Error(w, "cwd must be inside workspace", http.StatusBadRequest)
		return
	}
	if info, statErr := os.Stat(cwd); statErr != nil || !info.IsDir() {
		http.Error(w, "cwd must be a directory", http.StatusBadRequest)
		return
	}

	shell, err := workerShell(q.Get("shell"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[worker] Failed to accept WebSocket: %v", err)
		return
	}
	defer conn.Close()

	// Spawn PTY
	cmd := exec.Command(shell)
	cmd.Dir = cwd
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: cols, Rows: rows})
	if err != nil {
		log.Printf("[worker] Failed to start PTY: %v", err)
		conn.Close()
		return
	}
	defer ptmx.Close()

	// Create session
	sessionID := generateSessionID()
	session := &ptySession{
		ID:        sessionID,
		PTY:       ptmx,
		Cmd:       cmd,
		CreatedAt: time.Now(),
		Shell:     shell,
		Cwd:       cwd,
		Cols:      cols,
		Rows:      rows,
	}

	ptySessionsMu.Lock()
	ptySessions[sessionID] = session
	ptySessionsMu.Unlock()

	defer func() {
		ptySessionsMu.Lock()
		delete(ptySessions, sessionID)
		ptySessionsMu.Unlock()
	}()

	// Send session info
	conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"session","id":"%s"}`, sessionID)))

	// Read from PTY, write to WebSocket
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if err != nil {
				return
			}
			msg, _ := json.Marshal(map[string]string{
				"type": "data",
				"data": string(buf[:n]),
			})
			if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		}
	}()

	// Read from WebSocket, write to PTY
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}

		var msg struct {
			Type string `json:"type"`
			Data string `json:"data"`
			Cols int    `json:"cols"`
			Rows int    `json:"rows"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}

		switch msg.Type {
		case "data":
			ptmx.Write([]byte(msg.Data))
		case "resize":
			if msg.Cols > 0 && msg.Rows > 0 {
				pty.Setsize(ptmx, &pty.Winsize{Cols: uint16(msg.Cols), Rows: uint16(msg.Rows)})
			}
		}
	}

	// Cleanup
	cmd.Process.Kill()
	cmd.Wait()

	// Send exit message
	exitCode := 0
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	}
	conn.WriteMessage(websocket.TextMessage, []byte(fmt.Sprintf(`{"type":"exit","code":%d}`, exitCode)))
}

// =============================================================================
// SSH WebSocket Tunnel
// =============================================================================

func handleSSHWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[worker] Failed to accept SSH WebSocket: %v", err)
		return
	}
	defer conn.Close()

	// Connect to local SSH server
	sshConn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", sshPort))
	if err != nil {
		log.Printf("[worker] Failed to connect to SSH: %v", err)
		conn.Close()
		return
	}
	defer sshConn.Close()

	// Bridge WebSocket <-> SSH
	done := make(chan struct{})

	// SSH -> WebSocket
	go func() {
		defer close(done)
		buf := make([]byte, 4096)
		for {
			n, err := sshConn.Read(buf)
			if err != nil {
				return
			}
			if err := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	// WebSocket -> SSH
	go func() {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				sshConn.Close()
				return
			}
			if _, err := sshConn.Write(data); err != nil {
				return
			}
		}
	}()

	<-done
}

// =============================================================================
// SSH Server
// =============================================================================

func startSSHServer() {
	config := &cryptossh.ServerConfig{
		// Token-as-username authentication: username must equal the auth token
		// Password can be anything (we use empty string from client)
		PasswordCallback: func(conn cryptossh.ConnMetadata, password []byte) (*cryptossh.Permissions, error) {
			token := ensureValidToken()
			if constantTimeTokenMatch(conn.User(), token) {
				return nil, nil
			}
			return nil, fmt.Errorf("invalid credentials")
		},
	}

	// Generate or load host key
	hostKeyPath := "/home/user/.ssh/host_key"
	if _, err := os.Stat(hostKeyPath); os.IsNotExist(err) {
		os.MkdirAll("/home/user/.ssh", 0700)
		exec.Command("ssh-keygen", "-t", "ed25519", "-f", hostKeyPath, "-N", "", "-q").Run()
	}

	keyBytes, err := os.ReadFile(hostKeyPath)
	if err != nil {
		log.Printf("[ssh] Failed to read host key: %v", err)
		return
	}
	signer, err := cryptossh.ParsePrivateKey(keyBytes)
	if err != nil {
		log.Printf("[ssh] Failed to parse host key: %v", err)
		return
	}
	config.AddHostKey(signer)

	listener, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", sshPort))
	if err != nil {
		log.Printf("[ssh] Failed to listen: %v", err)
		return
	}

	log.Printf("[ssh] SSH server listening on port %d", sshPort)
	log.Printf("[ssh] Connect with: ssh <token>@<host> -p %d", sshPort)

	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Printf("[ssh] Failed to accept connection: %v", err)
			continue
		}
		go handleSSHConn(conn, config)
	}
}

func handleSSHConn(conn net.Conn, config *cryptossh.ServerConfig) {
	defer conn.Close()

	sshConn, chans, reqs, err := cryptossh.NewServerConn(conn, config)
	if err != nil {
		log.Printf("[ssh] Handshake failed: %v", err)
		return
	}
	defer sshConn.Close()

	go cryptossh.DiscardRequests(reqs)

	for newChannel := range chans {
		if newChannel.ChannelType() != "session" {
			newChannel.Reject(cryptossh.UnknownChannelType, "unknown channel type")
			continue
		}

		channel, requests, err := newChannel.Accept()
		if err != nil {
			log.Printf("[ssh] Failed to accept channel: %v", err)
			continue
		}

		go handleSSHChannel(channel, requests)
	}
}

func handleSSHChannel(channel cryptossh.Channel, requests <-chan *cryptossh.Request) {
	defer channel.Close()

	var ptyReq *sshPtyRequest

	for req := range requests {
		switch req.Type {
		case "pty-req":
			ptyReq = parsePtyRequest(req.Payload)
			if req.WantReply {
				req.Reply(ptyReq != nil, nil)
			}

		case "exec":
			cmdStr := parseExecPayload(req.Payload)
			if req.WantReply {
				req.Reply(true, nil)
			}
			exitCode := runSSHExec(channel, cmdStr)
			sendExitStatus(channel, exitCode)
			return

		case "shell":
			if req.WantReply {
				req.Reply(true, nil)
			}
			if ptyReq != nil {
				exitCode := runSSHShellPTY(channel, requests, ptyReq)
				sendExitStatus(channel, exitCode)
			} else {
				io.WriteString(channel, "No PTY requested\n")
				sendExitStatus(channel, 1)
			}
			return

		default:
			if req.WantReply {
				req.Reply(false, nil)
			}
		}
	}
}

type sshPtyRequest struct {
	Term string
	Cols uint32
	Rows uint32
}

func parsePtyRequest(payload []byte) *sshPtyRequest {
	// SSH pty-req: string term, uint32 cols, uint32 rows, uint32 pxWidth, uint32 pxHeight, string modes
	if len(payload) < 4 {
		return nil
	}
	termLen := binary.BigEndian.Uint32(payload[:4])
	if int(4+termLen+8) > len(payload) {
		return nil
	}
	term := string(payload[4 : 4+termLen])
	offset := 4 + termLen
	cols := binary.BigEndian.Uint32(payload[offset : offset+4])
	rows := binary.BigEndian.Uint32(payload[offset+4 : offset+8])
	return &sshPtyRequest{Term: term, Cols: cols, Rows: rows}
}

func parseExecPayload(payload []byte) string {
	if len(payload) < 4 {
		return ""
	}
	cmdLen := binary.BigEndian.Uint32(payload[:4])
	if int(4+cmdLen) > len(payload) {
		return ""
	}
	return string(payload[4 : 4+cmdLen])
}

func sendExitStatus(channel cryptossh.Channel, exitCode int) {
	payload := make([]byte, 4)
	binary.BigEndian.PutUint32(payload, uint32(exitCode))
	channel.SendRequest("exit-status", false, payload)
}

func runSSHExec(channel cryptossh.Channel, cmdStr string) int {
	// The daemon starts only after dropping to the dedicated worker account.
	// Execute directly as that account instead of invoking a root-capable su
	// fallback or inheriting a root shell.
	c := exec.Command("/bin/bash", "-lc", cmdStr)
	c.Env = append(os.Environ(), "HOME=/home/user", "USER=user", "LOGNAME=user")
	c.Dir = workspaceDir

	stdin, _ := c.StdinPipe()
	stdout, _ := c.StdoutPipe()
	stderr, _ := c.StderrPipe()

	if err := c.Start(); err != nil {
		return 1
	}

	go io.Copy(stdin, channel)
	go io.Copy(channel, stdout)
	go io.Copy(channel.Stderr(), stderr)

	c.Wait()
	if c.ProcessState != nil {
		return c.ProcessState.ExitCode()
	}
	return 0
}

func runSSHShellPTY(channel cryptossh.Channel, requests <-chan *cryptossh.Request, pr *sshPtyRequest) int {
	shellPath, err := workerShell("")
	if err != nil {
		return 1
	}
	shell := exec.Command(shellPath)
	shell.Env = append(os.Environ(),
		"TERM="+sanitizeTerm(pr.Term),
		"HOME=/home/user",
		"USER=user",
		"LOGNAME=user",
	)
	shell.Dir = workspaceDir

	ptmx, err := pty.StartWithSize(shell, &pty.Winsize{
		Cols: uint16(pr.Cols),
		Rows: uint16(pr.Rows),
	})
	if err != nil {
		return 1
	}
	defer ptmx.Close()

	// Handle remaining requests (window-change)
	go func() {
		for req := range requests {
			switch req.Type {
			case "window-change":
				if len(req.Payload) >= 8 {
					cols := binary.BigEndian.Uint32(req.Payload[:4])
					rows := binary.BigEndian.Uint32(req.Payload[4:8])
					pty.Setsize(ptmx, &pty.Winsize{
						Cols: uint16(cols),
						Rows: uint16(rows),
					})
				}
			}
			if req.WantReply {
				req.Reply(false, nil)
			}
		}
	}()

	go io.Copy(ptmx, channel)
	io.Copy(channel, ptmx)

	shell.Wait()
	if shell.ProcessState != nil {
		return shell.ProcessState.ExitCode()
	}
	return 0
}

func sanitizeTerm(term string) string {
	if term == "" || strings.ContainsAny(term, "\x00\r\n") {
		return "xterm-256color"
	}
	return term
}

// =============================================================================
// Helpers
// =============================================================================

func sendJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func parseUint16(s string, def uint16) uint16 {
	if s == "" {
		return def
	}
	var v int
	fmt.Sscanf(s, "%d", &v)
	if v <= 0 {
		return def
	}
	return uint16(v)
}

func generateSessionID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func workerShell(requested string) (string, error) {
	shell := requested
	if shell == "" {
		shell = os.Getenv("SHELL")
	}
	if shell == "" {
		shell = "/bin/bash"
	}
	if !filepath.IsAbs(shell) || strings.ContainsAny(shell, "\x00\r\n") {
		return "", fmt.Errorf("shell must be an absolute path")
	}

	base := filepath.Base(shell)
	switch base {
	case "bash", "sh", "zsh", "fish":
	default:
		return "", fmt.Errorf("unsupported shell")
	}
	dir := filepath.Clean(filepath.Dir(shell))
	if dir != "/bin" && dir != "/usr/bin" {
		return "", fmt.Errorf("shell must be installed in /bin or /usr/bin")
	}
	info, err := os.Stat(shell)
	if err != nil || info.IsDir() || info.Mode()&0111 == 0 {
		return "", fmt.Errorf("shell is not executable")
	}
	return shell, nil
}

func isProcessRunning(pattern string) bool {
	cmd := exec.Command("pgrep", "-f", pattern)
	return cmd.Run() == nil
}

func isCDPAvailable() bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", cdpPort), time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func getCDPWebSocketURL() string {
	resp, err := http.Get(fmt.Sprintf("http://localhost:%d/json/version", cdpPort))
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	var data struct {
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return ""
	}
	return data.WebSocketDebuggerURL
}
