package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var errWorkspacePath = errors.New("path must stay inside the workspace")

// resolveWorkspacePath validates a path supplied to the worker API. Relative
// paths are interpreted below workspaceDir. Existing symlinks, including
// symlinked parent directories, are resolved before the containment check so a
// request cannot use ../ or a symlink to reach another part of the sandbox.
func resolveWorkspacePath(rawPath string, allowRoot bool) (string, error) {
	return resolvePathWithin(workspaceDir, rawPath, allowRoot)
}

func resolvePathWithin(root, rawPath string, allowRoot bool) (string, error) {
	if rawPath == "" || strings.IndexByte(rawPath, 0) >= 0 {
		return "", errWorkspacePath
	}

	rootAbs, err := filepath.Abs(root)
	if err != nil {
		return "", fmt.Errorf("resolve workspace root: %w", err)
	}
	rootAbs = filepath.Clean(rootAbs)
	rootReal, err := filepath.EvalSymlinks(rootAbs)
	if err != nil {
		return "", fmt.Errorf("resolve workspace root: %w", err)
	}
	rootReal = filepath.Clean(rootReal)

	candidate := rawPath
	if !filepath.IsAbs(candidate) {
		candidate = filepath.Join(rootAbs, candidate)
	}
	candidate = filepath.Clean(candidate)
	if !pathWithin(rootAbs, candidate) {
		return "", errWorkspacePath
	}

	// Resolve the deepest existing ancestor. This also validates paths whose
	// final component does not exist yet, which is required for safe writes.
	existing := candidate
	var missing []string
	for {
		_, statErr := os.Lstat(existing)
		if statErr == nil {
			break
		}
		if !os.IsNotExist(statErr) {
			return "", fmt.Errorf("inspect workspace path: %w", statErr)
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return "", errWorkspacePath
		}
		missing = append([]string{filepath.Base(existing)}, missing...)
		existing = parent
	}

	existingReal, err := filepath.EvalSymlinks(existing)
	if err != nil {
		return "", fmt.Errorf("resolve workspace path: %w", err)
	}
	if !pathWithin(rootReal, existingReal) {
		return "", errWorkspacePath
	}

	resolved := existingReal
	for _, component := range missing {
		resolved = filepath.Join(resolved, component)
	}
	if !pathWithin(rootReal, resolved) {
		return "", errWorkspacePath
	}
	if !allowRoot && filepath.Clean(resolved) == rootReal {
		return "", errWorkspacePath
	}

	// Keep the original lexical path for filesystem operations. The checks
	// above establish that every currently existing symlink points back into the
	// workspace, while preserving the caller's intended path semantics.
	return candidate, nil
}

// resolveExistingPathWithin returns the canonical target for an existing path
// after applying the same workspace boundary checks. Callers that serve or
// read a file can then open the canonical path without following a final
// symlink during the actual operation.
func resolveExistingPathWithin(root, rawPath string, allowRoot bool) (string, error) {
	candidate, err := resolvePathWithin(root, rawPath, allowRoot)
	if err != nil {
		return "", err
	}
	realPath, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return "", fmt.Errorf("resolve existing path: %w", err)
	}
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("resolve path root: %w", err)
	}
	if !pathWithin(rootReal, realPath) || (!allowRoot && filepath.Clean(realPath) == filepath.Clean(rootReal)) {
		return "", errWorkspacePath
	}
	return filepath.Clean(realPath), nil
}

func pathWithin(root, candidate string) bool {
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(candidate))
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}
