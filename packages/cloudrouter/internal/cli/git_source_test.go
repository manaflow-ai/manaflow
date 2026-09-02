package cli

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizeGitSource(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "github shorthand", input: "manaflow-ai/cmux", want: "https://github.com/manaflow-ai/cmux"},
		{name: "https URL", input: "https://git.example.test/team/repo.git", want: "https://git.example.test/team/repo.git"},
		{name: "SSH URL", input: "ssh://git@example.test/team/repo.git", want: "ssh://git@example.test/team/repo.git"},
		{name: "scp URL", input: "git@example.test:team/repo.git", want: "git@example.test:team/repo.git"},
		{name: "HTTP scheme rejected", input: "http://example.test/team/repo.git", wantErr: true},
		{name: "credentials rejected", input: "https://token@example.test/team/repo.git", wantErr: true},
		{name: "query rejected", input: "https://example.test/team/repo.git?token=secret", wantErr: true},
		{name: "SSH option host rejected", input: "ssh://git@-oProxyCommand=touch%20/tmp/pwn/example.git", wantErr: true},
		{name: "SCP option host rejected", input: "git@-oProxyCommand=touch/tmp/pwn:team/repo.git", wantErr: true},
		{name: "invalid hostname rejected", input: "https://example_test/team/repo.git", wantErr: true},
		{name: "unsupported scheme", input: "file:///tmp/repo.git", wantErr: true},
		{name: "newline rejected", input: "https://example.test/repo.git\n-touch", wantErr: true},
		{name: "path escape rejected", input: "https://example.test/team/../repo.git", wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := normalizeGitSource(test.input)
			if test.wantErr {
				if err == nil {
					t.Fatalf("normalizeGitSource(%q) succeeded, want error", test.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("normalizeGitSource(%q): %v", test.input, err)
			}
			if got != test.want {
				t.Fatalf("normalizeGitSource(%q) = %q, want %q", test.input, got, test.want)
			}
		})
	}
}

func TestBuildGitCloneCommandQuotesRemoteArguments(t *testing.T) {
	marker := filepath.Join(t.TempDir(), "injected")
	source := "https://example.test/team/repo.git;touch${IFS}" + marker
	workspace := t.TempDir()
	command, err := buildGitCloneCommandIn(workspace, source, "feature/quoted")
	if err != nil {
		t.Fatalf("buildGitCloneCommand: %v", err)
	}

	fakeBin := t.TempDir()
	argsFile := filepath.Join(fakeBin, "args")
	fakeGit := filepath.Join(fakeBin, "git")
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + shellQuote(argsFile) + "\n"
	if err := os.WriteFile(fakeGit, []byte(script), 0700); err != nil {
		t.Fatalf("write fake git: %v", err)
	}

	cmd := exec.Command("/bin/bash", "-c", command)
	cmd.Env = append(os.Environ(), "PATH="+fakeBin+":"+os.Getenv("PATH"))
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("clone command failed: %v (%s)", err, output)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatalf("shell metacharacter executed an injected command, marker error: %v", err)
	}
	args, err := os.ReadFile(argsFile)
	if err != nil {
		t.Fatalf("read captured git args: %v", err)
	}
	got := strings.Split(strings.TrimSpace(string(args)), "\n")
	normalizedSource, err := normalizeGitSource(source)
	if err != nil {
		t.Fatalf("normalize test source: %v", err)
	}
	want := []string{"-C", workspace, "clone", "--branch=feature/quoted", "--", normalizedSource, "."}
	if strings.Join(got, "\x00") != strings.Join(want, "\x00") {
		t.Fatalf("git argv = %#v, want %#v", got, want)
	}
}

func TestValidateGitBranchRejectsShellSyntax(t *testing.T) {
	for _, branch := range []string{"main;touch /tmp/pwn", "$(touch /tmp/pwn)", "-c"} {
		if err := validateGitBranch(branch); err == nil {
			t.Errorf("validateGitBranch(%q) succeeded, want error", branch)
		}
	}
	if err := validateGitBranch("feature/safe"); err != nil {
		t.Fatalf("validateGitBranch(feature/safe): %v", err)
	}
}
