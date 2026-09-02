package cli

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveStartArgumentPrefersExistingRelativeDirectory(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)
	if err := os.MkdirAll(filepath.Join(root, "src", "app"), 0o755); err != nil {
		t.Fatalf("create local source: %v", err)
	}

	syncPath, gitURL, err := resolveStartArgument("src/app")
	if err != nil {
		t.Fatalf("resolveStartArgument: %v", err)
	}
	wantPath := filepath.Join(root, "src", "app")
	if syncPath != wantPath || gitURL != "" {
		t.Fatalf("resolved source = (%q, %q), want (%q, \"\")", syncPath, gitURL, wantPath)
	}
}

func TestResolveStartArgumentRecognizesGitHubShorthandWhenPathMissing(t *testing.T) {
	root := t.TempDir()
	t.Chdir(root)

	syncPath, gitURL, err := resolveStartArgument("manaflow-ai/cmux")
	if err != nil {
		t.Fatalf("resolveStartArgument: %v", err)
	}
	if syncPath != "" || gitURL != "https://github.com/manaflow-ai/cmux" {
		t.Fatalf("resolved source = (%q, %q), want (\"\", https://github.com/manaflow-ai/cmux)", syncPath, gitURL)
	}
}
