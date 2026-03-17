package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// E2E tests for cmux CLI
// These tests require:
// - Valid authentication (cmux login)
// - E2B API access
// - Network connectivity
//
// Run with: go test -v -timeout 10m ./...

var (
	// Sandbox ID created during tests - cleaned up at the end
	testSandboxID string
)

func TestMain(m *testing.M) {
	// Run tests
	code := m.Run()

	// Cleanup: delete sandbox if it was created
	if testSandboxID != "" {
		fmt.Printf("Cleaning up sandbox: %s\n", testSandboxID)
		runCmux("delete", testSandboxID)
	}

	os.Exit(code)
}

// runCmux executes a cmux command and returns stdout, stderr, and error
func runCmux(args ...string) (string, string, error) {
	cmd := exec.Command("go", append([]string{"run", "./cmd/cmux"}, args...)...)
	cmd.Dir = getProjectRoot()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	return stdout.String(), stderr.String(), err
}

// runCmuxWithTimeout executes a cmux command with a timeout
func runCmuxWithTimeout(timeout time.Duration, args ...string) (string, string, error) {
	cmd := exec.Command("go", append([]string{"run", "./cmd/cmux"}, args...)...)
	cmd.Dir = getProjectRoot()

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	done := make(chan error, 1)
	go func() {
		done <- cmd.Run()
	}()

	select {
	case err := <-done:
		return stdout.String(), stderr.String(), err
	case <-time.After(timeout):
		cmd.Process.Kill()
		return stdout.String(), stderr.String(), fmt.Errorf("command timed out after %v", timeout)
	}
}

func getProjectRoot() string {
	// Get the directory containing this test file
	_, err := os.Getwd()
	if err != nil {
		return "."
	}
	return "."
}

// ===========================================================================
// Basic Command Tests (no sandbox required)
// ===========================================================================

func TestVersion(t *testing.T) {
	stdout, _, err := runCmux("version")
	if err != nil {
		t.Fatalf("version command failed: %v", err)
	}

	if !strings.Contains(stdout, "cmux") {
		t.Errorf("version output should contain 'cmux', got: %s", stdout)
	}
}

func TestWhoami(t *testing.T) {
	stdout, _, err := runCmux("whoami")
	if err != nil {
		t.Fatalf("whoami command failed: %v", err)
	}

	if !strings.Contains(stdout, "User:") {
		t.Errorf("whoami output should contain 'User:', got: %s", stdout)
	}
	if !strings.Contains(stdout, "Team:") {
		t.Errorf("whoami output should contain 'Team:', got: %s", stdout)
	}
}

func TestTemplates(t *testing.T) {
	stdout, _, err := runCmux("templates")
	if err != nil {
		t.Fatalf("templates command failed: %v", err)
	}

	if !strings.Contains(stdout, "Templates:") {
		t.Errorf("templates output should contain 'Templates:', got: %s", stdout)
	}
}

func TestHelp(t *testing.T) {
	stdout, _, err := runCmux("--help")
	if err != nil {
		t.Fatalf("help command failed: %v", err)
	}

	expectedCommands := []string{"start", "stop", "delete", "exec", "status", "sync", "upload"}
	for _, cmd := range expectedCommands {
		if !strings.Contains(stdout, cmd) {
			t.Errorf("help output should contain '%s', got: %s", cmd, stdout)
		}
	}
}

// ===========================================================================
// Sandbox Lifecycle Tests
// ===========================================================================

func TestSandboxLifecycle(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping sandbox lifecycle test in short mode")
	}

	// Test: Create sandbox
	t.Run("Start", func(t *testing.T) {
		stdout, stderr, err := runCmuxWithTimeout(2*time.Minute, "start", "--template", "cmux-devbox-docker", "--name", "E2E Test")
		if err != nil {
			t.Fatalf("start command failed: %v\nstdout: %s\nstderr: %s", err, stdout, stderr)
		}

		// Extract sandbox ID from output
		lines := strings.Split(stdout, "\n")
		for _, line := range lines {
			if strings.HasPrefix(line, "Created sandbox:") {
				parts := strings.Fields(line)
				if len(parts) >= 3 {
					testSandboxID = parts[2]
				}
			}
		}

		if testSandboxID == "" {
			t.Fatalf("failed to extract sandbox ID from output: %s", stdout)
		}
		t.Logf("Created sandbox: %s", testSandboxID)
	})

	if testSandboxID == "" {
		t.Fatal("no sandbox ID, cannot continue tests")
	}

	// Test: Status
	t.Run("Status", func(t *testing.T) {
		stdout, _, err := runCmux("status", testSandboxID)
		if err != nil {
			t.Fatalf("status command failed: %v", err)
		}

		if !strings.Contains(stdout, "running") {
			t.Errorf("status should show 'running', got: %s", stdout)
		}
		if !strings.Contains(stdout, testSandboxID) {
			t.Errorf("status should contain sandbox ID, got: %s", stdout)
		}
	})

	// Test: Status JSON
	t.Run("StatusJSON", func(t *testing.T) {
		stdout, _, err := runCmux("status", testSandboxID, "--json")
		if err != nil {
			t.Fatalf("status --json command failed: %v", err)
		}

		var status map[string]interface{}
		if err := json.Unmarshal([]byte(stdout), &status); err != nil {
			t.Fatalf("failed to parse JSON output: %v\noutput: %s", err, stdout)
		}

		if status["status"] != "running" {
			t.Errorf("status should be 'running', got: %v", status["status"])
		}
	})

	// Test: Exec
	t.Run("Exec", func(t *testing.T) {
		stdout, _, err := runCmux("exec", testSandboxID, "echo 'Hello from E2E test'")
		if err != nil {
			t.Fatalf("exec command failed: %v", err)
		}

		if !strings.Contains(stdout, "Hello from E2E test") {
			t.Errorf("exec output should contain echo result, got: %s", stdout)
		}
	})

	// Test: Exec with multiple commands
	t.Run("ExecMultipleCommands", func(t *testing.T) {
		stdout, _, err := runCmux("exec", testSandboxID, "whoami && pwd && echo done")
		if err != nil {
			t.Fatalf("exec command failed: %v", err)
		}

		if !strings.Contains(stdout, "user") {
			t.Errorf("exec should show 'user', got: %s", stdout)
		}
		if !strings.Contains(stdout, "/home/user") {
			t.Errorf("exec should show '/home/user', got: %s", stdout)
		}
		if !strings.Contains(stdout, "done") {
			t.Errorf("exec should show 'done', got: %s", stdout)
		}
	})

	// Test: PTY List
	t.Run("PTYList", func(t *testing.T) {
		stdout, _, err := runCmux("pty-list", testSandboxID)
		if err != nil {
			t.Fatalf("pty-list command failed: %v", err)
		}

		// Should show no active sessions or a list
		if !strings.Contains(stdout, "PTY") && !strings.Contains(stdout, "No active") {
			t.Errorf("pty-list output unexpected: %s", stdout)
		}
	})

	// Test: Upload
	t.Run("Upload", func(t *testing.T) {
		// Create a temp file
		tmpFile, err := os.CreateTemp("", "cmux-e2e-*.txt")
		if err != nil {
			t.Fatalf("failed to create temp file: %v", err)
		}
		defer os.Remove(tmpFile.Name())

		testContent := fmt.Sprintf("E2E test content %d", time.Now().Unix())
		if _, err := tmpFile.WriteString(testContent); err != nil {
			t.Fatalf("failed to write temp file: %v", err)
		}
		tmpFile.Close()

		// Upload the file
		stdout, stderr, err := runCmuxWithTimeout(30*time.Second, "upload", tmpFile.Name(), testSandboxID+":/home/user/e2e-test.txt")
		if err != nil {
			t.Fatalf("upload command failed: %v\nstdout: %s\nstderr: %s", err, stdout, stderr)
		}

		if !strings.Contains(stdout, "Uploaded") {
			t.Errorf("upload output should confirm upload, got: %s", stdout)
		}

		// Verify the file was uploaded
		verifyStdout, _, err := runCmux("exec", testSandboxID, "cat /home/user/e2e-test.txt")
		if err != nil {
			t.Fatalf("failed to verify uploaded file: %v", err)
		}

		if !strings.Contains(verifyStdout, testContent) {
			t.Errorf("uploaded file content mismatch, expected %q, got: %s", testContent, verifyStdout)
		}
	})

	// Test: Sync
	t.Run("Sync", func(t *testing.T) {
		// Create a temp directory with files
		tmpDir, err := os.MkdirTemp("", "cmux-e2e-sync-*")
		if err != nil {
			t.Fatalf("failed to create temp dir: %v", err)
		}
		defer os.RemoveAll(tmpDir)

		// Create test files
		for i := 1; i <= 3; i++ {
			content := fmt.Sprintf("file %d content", i)
			if err := os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte(content), 0644); err != nil {
				t.Fatalf("failed to create test file: %v", err)
			}
		}

		// Sync the directory
		stdout, stderr, err := runCmuxWithTimeout(60*time.Second, "sync", testSandboxID, tmpDir, "/home/user/e2e-sync")
		if err != nil {
			t.Fatalf("sync command failed: %v\nstdout: %s\nstderr: %s", err, stdout, stderr)
		}

		if !strings.Contains(stdout, "Synced") {
			t.Errorf("sync output should confirm sync, got: %s", stdout)
		}

		// Verify files were synced
		verifyStdout, _, err := runCmux("exec", testSandboxID, "ls -la /home/user/e2e-sync/")
		if err != nil {
			t.Fatalf("failed to verify synced files: %v", err)
		}

		for i := 1; i <= 3; i++ {
			if !strings.Contains(verifyStdout, fmt.Sprintf("file%d.txt", i)) {
				t.Errorf("synced directory should contain file%d.txt, got: %s", i, verifyStdout)
			}
		}
	})

	// Test: Extend
	t.Run("Extend", func(t *testing.T) {
		stdout, _, err := runCmux("extend", testSandboxID)
		if err != nil {
			t.Fatalf("extend command failed: %v", err)
		}

		if !strings.Contains(stdout, "Extended") {
			t.Errorf("extend output should confirm extension, got: %s", stdout)
		}
	})

	// Test: Code URL
	t.Run("Code", func(t *testing.T) {
		stdout, _, err := runCmux("code", testSandboxID)
		if err != nil {
			t.Fatalf("code command failed: %v", err)
		}

		if !strings.Contains(stdout, "Opening") || !strings.Contains(stdout, "VS Code") {
			t.Errorf("code output should mention opening VS Code, got: %s", stdout)
		}
	})

	// Test: VNC URL
	t.Run("VNC", func(t *testing.T) {
		stdout, _, err := runCmux("vnc", testSandboxID)
		if err != nil {
			t.Fatalf("vnc command failed: %v", err)
		}

		if !strings.Contains(stdout, "Opening") || !strings.Contains(stdout, "VNC") {
			t.Errorf("vnc output should mention opening VNC, got: %s", stdout)
		}
	})

	// Test: Stop
	t.Run("Stop", func(t *testing.T) {
		stdout, _, err := runCmux("stop", testSandboxID)
		if err != nil {
			t.Fatalf("stop command failed: %v", err)
		}

		if !strings.Contains(stdout, "Stopped") {
			t.Errorf("stop output should confirm stop, got: %s", stdout)
		}
	})

	// Test: Delete
	t.Run("Delete", func(t *testing.T) {
		stdout, _, err := runCmux("delete", testSandboxID)
		if err != nil {
			t.Fatalf("delete command failed: %v", err)
		}

		if !strings.Contains(stdout, "Deleted") {
			t.Errorf("delete output should confirm deletion, got: %s", stdout)
		}

		// Clear the sandbox ID so TestMain doesn't try to delete again
		testSandboxID = ""
	})
}

// ===========================================================================
// Skills Tests
// ===========================================================================

func TestSkillsInstall(t *testing.T) {
	stdout, _, err := runCmux("skills", "install")
	if err != nil {
		t.Fatalf("skills install command failed: %v", err)
	}

	if !strings.Contains(stdout, "Skill") {
		t.Errorf("skills install output should mention skill, got: %s", stdout)
	}
}

// ===========================================================================
// Error Handling Tests
// ===========================================================================

func TestInvalidSandboxID(t *testing.T) {
	_, stderr, err := runCmux("status", "invalid_sandbox_id_12345")
	if err == nil {
		t.Error("expected error for invalid sandbox ID")
	}

	// Should show some error message
	combined := stderr
	if !strings.Contains(strings.ToLower(combined), "error") && !strings.Contains(strings.ToLower(combined), "not found") {
		t.Logf("Warning: error message may not be descriptive: %s", combined)
	}
}

func TestMissingArguments(t *testing.T) {
	testCases := []struct {
		name string
		args []string
	}{
		{"exec without sandbox", []string{"exec"}},
		{"status without sandbox", []string{"status"}},
		{"upload without args", []string{"upload"}},
		{"sync without args", []string{"sync"}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			_, _, err := runCmux(tc.args...)
			if err == nil {
				t.Errorf("expected error for %s", tc.name)
			}
		})
	}
}
