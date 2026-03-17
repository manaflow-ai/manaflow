package cli

import (
	"os"
	"os/exec"
	"runtime"
	"strings"
	"testing"
)

// TestBuildSSHCmdPasswordAuth verifies that buildSSHCmd sets up non-interactive
// password authentication so SSH doesn't prompt via /dev/tty on Linux.
//
// Regression test for https://github.com/manaflow-ai/manaflow/issues/1711
func TestBuildSSHCmdPasswordAuth(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SSH_ASKPASS test not applicable on Windows")
	}

	sshArgs := []string{
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
		"-o", "PubkeyAuthentication=no",
		"user@host",
		"echo hello",
	}

	cmd, cleanup, err := buildSSHCmd(sshArgs)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		t.Fatalf("buildSSHCmd failed: %v", err)
	}

	hasSshpass, _ := exec.LookPath("sshpass")

	if hasSshpass != "" {
		// When sshpass is available, it should be the command
		if cmd.Path != hasSshpass {
			t.Errorf("expected sshpass binary at %s, got %s", hasSshpass, cmd.Path)
		}
		// First three args should be: sshpass -p '' ssh
		args := cmd.Args
		if len(args) < 4 || args[1] != "-p" || args[2] != "" || args[3] != "ssh" {
			t.Errorf("expected sshpass -p '' ssh ..., got %v", args[:min(4, len(args))])
		}
	} else {
		// When sshpass is NOT available, SSH_ASKPASS must be configured
		var hasAskpass, hasAskpassRequire, hasDisplay bool
		for _, env := range cmd.Env {
			if strings.HasPrefix(env, "SSH_ASKPASS=") {
				hasAskpass = true
				askpassPath := strings.TrimPrefix(env, "SSH_ASKPASS=")
				// Verify the askpass script exists and is executable
				info, err := os.Stat(askpassPath)
				if err != nil {
					t.Errorf("SSH_ASKPASS script does not exist: %s", askpassPath)
				} else if info.Mode()&0100 == 0 {
					t.Errorf("SSH_ASKPASS script is not executable: %s", askpassPath)
				}
				// Verify script content echoes empty string
				content, err := os.ReadFile(askpassPath)
				if err != nil {
					t.Errorf("failed to read askpass script: %v", err)
				} else if !strings.Contains(string(content), "echo ''") {
					t.Errorf("askpass script should echo empty string, got: %s", content)
				}
			}
			if env == "SSH_ASKPASS_REQUIRE=force" {
				hasAskpassRequire = true
			}
			if env == "DISPLAY=dummy" {
				hasDisplay = true
			}
		}

		if !hasAskpass {
			t.Error("SSH_ASKPASS not set in command environment")
		}
		if !hasAskpassRequire {
			t.Error("SSH_ASKPASS_REQUIRE=force not set in command environment")
		}
		if !hasDisplay {
			t.Error("DISPLAY=dummy not set in command environment")
		}
	}
}

// TestBuildSSHCmdCleanup verifies that the cleanup function removes temp files.
func TestBuildSSHCmdCleanup(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("SSH_ASKPASS test not applicable on Windows")
	}
	if _, err := exec.LookPath("sshpass"); err == nil {
		t.Skip("sshpass is installed; SSH_ASKPASS path not exercised")
	}

	sshArgs := []string{"user@host", "echo hello"}
	cmd, cleanup, err := buildSSHCmd(sshArgs)
	if err != nil {
		t.Fatalf("buildSSHCmd failed: %v", err)
	}

	// Find the askpass file path
	var askpassPath string
	for _, env := range cmd.Env {
		if strings.HasPrefix(env, "SSH_ASKPASS=") {
			askpassPath = strings.TrimPrefix(env, "SSH_ASKPASS=")
			break
		}
	}
	if askpassPath == "" {
		t.Fatal("SSH_ASKPASS not found in env")
	}

	// File should exist before cleanup
	if _, err := os.Stat(askpassPath); err != nil {
		t.Fatalf("askpass file should exist before cleanup: %v", err)
	}

	// Run cleanup
	if cleanup != nil {
		cleanup()
	}

	// File should be gone after cleanup
	if _, err := os.Stat(askpassPath); !os.IsNotExist(err) {
		t.Errorf("askpass file should be removed after cleanup, got: %v", err)
	}
}
