package main

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolvePathWithinRejectsTraversalAndExternalSymlinks(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	outside := filepath.Join(root, "outside")
	if err := os.MkdirAll(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(outside, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "secret"), []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(workspace, "linked")); err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"../outside/secret", filepath.Join(workspace, "linked", "secret")} {
		if _, err := resolvePathWithin(workspace, path, false); !errors.Is(err, errWorkspacePath) {
			t.Errorf("resolvePathWithin(%q) error = %v, want workspace boundary error", path, err)
		}
	}
}

func TestResolvePathWithinAllowsInWorkspacePathsAndMissingFiles(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	if err := os.MkdirAll(filepath.Join(workspace, "src"), 0700); err != nil {
		t.Fatal(err)
	}

	got, err := resolvePathWithin(workspace, "src/new.txt", false)
	if err != nil {
		t.Fatalf("resolvePathWithin missing file: %v", err)
	}
	if want := filepath.Join(workspace, "src", "new.txt"); got != want {
		t.Fatalf("resolved path = %q, want %q", got, want)
	}
	if _, err := resolvePathWithin(workspace, workspace, true); err != nil {
		t.Fatalf("resolvePathWithin workspace root: %v", err)
	}
	if _, err := resolvePathWithin(workspace, workspace, false); !errors.Is(err, errWorkspacePath) {
		t.Fatalf("resolvePathWithin root with allowRoot=false error = %v, want boundary error", err)
	}
}

func TestWriteSecretFileUsesPrivatePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "token")
	if err := writeSecretFile(path, "secret"); err != nil {
		t.Fatalf("writeSecretFile: %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if got := info.Mode().Perm(); got != 0600 {
		t.Fatalf("token mode = %04o, want 0600", got)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "secret" {
		t.Fatalf("token content = %q, want secret", content)
	}
	if _, err := readSecretFile(path); err != nil {
		t.Fatalf("readSecretFile: %v", err)
	}
}

func TestReadSecretFileRejectsPublicOrSymlinkedFiles(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("private mode and no-follow checks are Unix-specific")
	}
	dir := t.TempDir()
	path := filepath.Join(dir, "token")
	if err := writeSecretFile(path, "secret"); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(path, 0640); err != nil {
		t.Fatal(err)
	}
	if _, err := readSecretFile(path); !errors.Is(err, os.ErrPermission) {
		t.Fatalf("readSecretFile(public file) error = %v, want permission error", err)
	}

	target := filepath.Join(dir, "target")
	if err := os.WriteFile(target, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "linked")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	if _, err := readSecretFile(link); err == nil {
		t.Fatal("readSecretFile followed a symlink")
	}
}

func TestWorkspaceFileWriteDoesNotFollowFinalSymlink(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("O_NOFOLLOW is Unix-specific")
	}
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	outside := filepath.Join(root, "outside")
	if err := os.MkdirAll(workspace, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(workspace, "output")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if err := writeWorkspaceFile(link, []byte("replacement"), 0600); err == nil {
		t.Fatal("writeWorkspaceFile followed a final symlink")
	}
	content, err := os.ReadFile(outside)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "original" {
		t.Fatalf("outside file changed to %q", content)
	}
}

func TestWorkerShellRejectsUntrustedExecutablePaths(t *testing.T) {
	if _, err := workerShell("/tmp/attacker-shell"); err == nil {
		t.Fatal("workerShell accepted an executable outside the system shell directories")
	}
	if _, err := workerShell("/bin/bash -c id"); err == nil {
		t.Fatal("workerShell accepted shell arguments")
	}
	if shell, err := workerShell("/bin/bash"); err != nil || shell != "/bin/bash" {
		t.Fatalf("workerShell(/bin/bash) = %q, %v", shell, err)
	}
}

func TestConstantTimeTokenMatch(t *testing.T) {
	if !constantTimeTokenMatch("token", "token") {
		t.Fatal("matching tokens were rejected")
	}
	if constantTimeTokenMatch("token", "other") || constantTimeTokenMatch("", "token") {
		t.Fatal("non-matching token accepted")
	}
}

func TestRequestAuthenticationKeepsTokensOutOfHTTPQueries(t *testing.T) {
	const token = "0123456789abcdef"

	headerRequest := httptest.NewRequest(http.MethodGet, "https://worker.test/status", nil)
	headerRequest.Header.Set("Authorization", "Bearer "+token)
	if !requestHasValidToken(headerRequest, token) {
		t.Fatal("Authorization header was rejected")
	}

	queryRequest := httptest.NewRequest(http.MethodGet, "https://worker.test/status?token="+token, nil)
	if requestHasValidToken(queryRequest, token) {
		t.Fatal("ordinary HTTP endpoint accepted a query token")
	}

	websocketRequest := httptest.NewRequest(http.MethodGet, "https://worker.test/ssh?token="+token, nil)
	if !requestHasValidToken(websocketRequest, token) {
		t.Fatal("SSH WebSocket compatibility token was rejected")
	}

	cookieRequest := httptest.NewRequest(http.MethodGet, "https://worker.test/status", nil)
	cookieRequest.AddCookie(&http.Cookie{Name: authCookieName, Value: token})
	if !requestHasValidToken(cookieRequest, token) {
		t.Fatal("auth cookie was rejected")
	}
}

func TestVNCStaticFilesStayUsableAndConfined(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.txt")
	if err := os.WriteFile(filepath.Join(root, "vnc.html"), []byte("vnc"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("vnc.html", filepath.Join(root, "index.html")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(outside, []byte("secret"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "leak.txt")); err != nil {
		t.Fatal(err)
	}

	proxy := &vncProxy{noVNCDir: root}
	request := httptest.NewRequest(http.MethodGet, "/vnc.html", nil)
	response := httptest.NewRecorder()
	proxy.serveStaticFile(response, request, "/vnc.html")
	if response.Code != http.StatusOK {
		t.Fatalf("static file status = %d, want %d", response.Code, http.StatusOK)
	}
	body, err := io.ReadAll(response.Result().Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(body) != "vnc" {
		t.Fatalf("static file body = %q, want vnc", body)
	}

	for _, path := range []string{"/index.html"} {
		response := httptest.NewRecorder()
		proxy.serveStaticFile(response, request, path)
		if response.Code != http.StatusOK {
			t.Errorf("internal static path %q status = %d, want %d", path, response.Code, http.StatusOK)
		}
	}

	for _, path := range []string{"/../secret.txt", "/leak.txt"} {
		response := httptest.NewRecorder()
		proxy.serveStaticFile(response, request, path)
		if response.Code != http.StatusForbidden {
			t.Errorf("static path %q status = %d, want %d", path, response.Code, http.StatusForbidden)
		}
	}
}
