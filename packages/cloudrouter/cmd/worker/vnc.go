package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	vncServerPort    = 5901
	vncProxyPort     = 39380
	vncSessionCookie = "vnc_session"
	vncSessionTTL    = 24 * time.Hour
)

// vncSession represents an authenticated VNC session.
type vncSession struct {
	token     string
	createdAt time.Time
}

// vncProxy is the VNC auth proxy server.
type vncProxy struct {
	mu       sync.RWMutex
	sessions map[string]*vncSession
	noVNCDir string
	server   *http.Server
}

// newVNCProxy creates a new VNC proxy.
func newVNCProxy() *vncProxy {
	// Auto-detect noVNC directory
	noVNCDir := "/opt/noVNC"
	if _, err := os.Stat(noVNCDir); os.IsNotExist(err) {
		noVNCDir = "/usr/share/novnc"
	}

	return &vncProxy{
		sessions: make(map[string]*vncSession),
		noVNCDir: noVNCDir,
	}
}

// Start starts the VNC proxy server.
func (vp *vncProxy) Start() {
	mux := http.NewServeMux()
	mux.HandleFunc("/", vp.handleRequest)

	vp.server = &http.Server{
		Addr:    fmt.Sprintf("0.0.0.0:%d", vncProxyPort),
		Handler: mux,
	}

	// Periodically clean expired sessions
	go vp.cleanExpiredSessions()

	log.Printf("[vnc-proxy] Listening on port %d, serving noVNC from %s", vncProxyPort, vp.noVNCDir)
	if err := vp.server.ListenAndServe(); err != http.ErrServerClosed {
		log.Printf("[vnc-proxy] Server error: %v", err)
	}
}

// Close gracefully shuts down the VNC proxy.
func (vp *vncProxy) Close() {
	if vp.server != nil {
		vp.server.Close()
	}
}

func (vp *vncProxy) handleRequest(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// Health checks - no auth
	if path == "/health" || path == "/healthz" {
		w.Header().Set("Content-Type", "text/plain")
		w.Write([]byte("OK"))
		return
	}

	// WebSocket upgrade for /websockify
	if path == "/websockify" || path == "/websockify/" {
		if r.Header.Get("Upgrade") == "websocket" {
			vp.handleWebSocket(w, r)
			return
		}
		http.Error(w, "WebSocket upgrade required", http.StatusBadRequest)
		return
	}

	// Check auth
	token := r.URL.Query().Get("tkn")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	existingSession := vp.getSessionFromCookie(r)

	var newSessionID string
	authorized := false

	if token != "" && vp.validateToken(token) {
		newSessionID = vp.createSession(token)
		authorized = true
		log.Printf("[vnc-proxy] Token validated, session created")
	} else if existingSession != "" && vp.validateSession(existingSession) {
		authorized = true
	}

	if !authorized {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		w.Write([]byte(`{"error":"Forbidden","message":"Invalid or missing token"}`))
		return
	}

	// If we just validated a token, redirect to strip it from URL
	if newSessionID != "" && token != "" {
		q := r.URL.Query()
		q.Del("tkn")
		q.Del("token")
		redirectURL := r.URL.Path
		if encoded := q.Encode(); encoded != "" {
			redirectURL += "?" + encoded
		}
		http.SetCookie(w, vp.sessionCookie(newSessionID))
		http.Redirect(w, r, redirectURL, http.StatusFound)
		return
	}

	// Serve static files
	filePath := path
	if filePath == "/" {
		filePath = "/vnc.html"
	}

	if newSessionID != "" {
		http.SetCookie(w, vp.sessionCookie(newSessionID))
	}

	vp.serveStaticFile(w, r, filePath)
}

func (vp *vncProxy) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	// Check auth
	token := r.URL.Query().Get("tkn")
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	sessionID := vp.getSessionFromCookie(r)

	authorized := false
	if token != "" && vp.validateToken(token) {
		authorized = true
	} else if sessionID != "" && vp.validateSession(sessionID) {
		authorized = true
	}

	if !authorized {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Upgrade to WebSocket
	upgrader := websocket.Upgrader{
		CheckOrigin:  func(r *http.Request) bool { return true },
		Subprotocols: []string{"binary"},
	}

	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[vnc-proxy] WebSocket upgrade failed: %v", err)
		return
	}
	defer wsConn.Close()

	// Connect to VNC server
	vncConn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", vncServerPort), 5*time.Second)
	if err != nil {
		log.Printf("[vnc-proxy] Failed to connect to VNC server: %v", err)
		return
	}
	defer vncConn.Close()

	vncConn.(*net.TCPConn).SetNoDelay(true)
	log.Printf("[vnc-proxy] WebSocket connected, bridging to VNC")

	done := make(chan struct{})

	// VNC → WebSocket
	go func() {
		defer close(done)
		buf := make([]byte, 32768)
		for {
			n, err := vncConn.Read(buf)
			if err != nil {
				return
			}
			if err := wsConn.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
				return
			}
		}
	}()

	// WebSocket → VNC
	go func() {
		for {
			_, data, err := wsConn.ReadMessage()
			if err != nil {
				vncConn.Close()
				return
			}
			if _, err := vncConn.Write(data); err != nil {
				return
			}
		}
	}()

	<-done
	log.Printf("[vnc-proxy] WebSocket connection closed")
}

func (vp *vncProxy) serveStaticFile(w http.ResponseWriter, r *http.Request, filePath string) {
	fullPath := filepath.Join(vp.noVNCDir, filepath.Clean(filePath))

	// Security: prevent directory traversal
	if !strings.HasPrefix(fullPath, vp.noVNCDir) {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	info, err := os.Stat(fullPath)
	if err != nil {
		http.NotFound(w, r)
		return
	}

	if info.IsDir() {
		fullPath = filepath.Join(fullPath, "index.html")
		info, err = os.Stat(fullPath)
		if err != nil {
			http.NotFound(w, r)
			return
		}
	}

	f, err := os.Open(fullPath)
	if err != nil {
		http.Error(w, "Internal Server Error", http.StatusInternalServerError)
		return
	}
	defer f.Close()

	ext := filepath.Ext(fullPath)
	contentType := mime.TypeByExtension(ext)
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))

	io.Copy(w, f)
}

// Token and session management

func (vp *vncProxy) validateToken(provided string) bool {
	data, err := os.ReadFile(authTokenPath)
	if err != nil {
		log.Printf("[vnc-proxy] Failed to read auth token: %v", err)
		return false
	}
	return strings.TrimSpace(string(data)) == provided
}

func (vp *vncProxy) createSession(token string) string {
	b := make([]byte, 32)
	rand.Read(b)
	id := hex.EncodeToString(b)

	vp.mu.Lock()
	vp.sessions[id] = &vncSession{
		token:     token,
		createdAt: time.Now(),
	}
	vp.mu.Unlock()

	return id
}

func (vp *vncProxy) validateSession(sessionID string) bool {
	vp.mu.RLock()
	session, ok := vp.sessions[sessionID]
	vp.mu.RUnlock()

	if !ok {
		return false
	}

	if time.Since(session.createdAt) > vncSessionTTL {
		vp.mu.Lock()
		delete(vp.sessions, sessionID)
		vp.mu.Unlock()
		return false
	}

	// Verify the token is still valid
	data, err := os.ReadFile(authTokenPath)
	if err != nil {
		return false
	}
	return session.token == strings.TrimSpace(string(data))
}

func (vp *vncProxy) getSessionFromCookie(r *http.Request) string {
	cookie, err := r.Cookie(vncSessionCookie)
	if err != nil {
		return ""
	}
	return cookie.Value
}

func (vp *vncProxy) sessionCookie(sessionID string) *http.Cookie {
	return &http.Cookie{
		Name:     vncSessionCookie,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteNoneMode,
		Secure:   true,
	}
}

func (vp *vncProxy) cleanExpiredSessions() {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		vp.mu.Lock()
		now := time.Now()
		for id, session := range vp.sessions {
			if now.Sub(session.createdAt) > vncSessionTTL {
				delete(vp.sessions, id)
			}
		}
		vp.mu.Unlock()
	}
}
