package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// browserManager wraps the agent-browser CLI for screenshot and agent mode.
type browserManager struct{}

var browser = &browserManager{}

// Close is called on shutdown. No-op for CLI-based approach.
func (bm *browserManager) Close() {}

// Screenshot takes a screenshot via agent-browser and returns base64-encoded PNG.
func (bm *browserManager) Screenshot() (map[string]interface{}, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	targetPath := "/tmp/screenshot.png"
	cmd := exec.CommandContext(ctx, "agent-browser", "screenshot", targetPath)
	cmd.Dir = workspaceDir
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("CDP_ENDPOINT=http://localhost:%d", cdpPort),
	)

	if out, err := cmd.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("screenshot failed: %s", strings.TrimSpace(string(out)))
	}

	data, err := os.ReadFile(targetPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read screenshot: %w", err)
	}

	b64 := base64.StdEncoding.EncodeToString(data)
	return map[string]interface{}{
		"success": true,
		"path":    targetPath,
		"base64":  b64,
		"data":    map[string]interface{}{"base64": b64},
	}, nil
}

// RunBrowserAgent shells out to the agent-browser CLI in agent mode.
func (bm *browserManager) RunBrowserAgent(body map[string]interface{}) (map[string]interface{}, error) {
	prompt, _ := body["prompt"].(string)
	if prompt == "" {
		return nil, fmt.Errorf("prompt required")
	}

	timeout := 120 * time.Second
	if t, ok := body["timeout"].(float64); ok && t > 0 {
		timeout = time.Duration(t) * time.Millisecond
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "agent-browser", "run", prompt)
	cmd.Dir = workspaceDir
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("CDP_ENDPOINT=http://localhost:%d", cdpPort),
	)

	stdout, err := cmd.Output()
	exitCode := 0
	if cmd.ProcessState != nil {
		exitCode = cmd.ProcessState.ExitCode()
	}
	var stderr string
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			stderr = string(ee.Stderr)
		}
	}

	return map[string]interface{}{
		"stdout":    strings.TrimSpace(string(stdout)),
		"stderr":    strings.TrimSpace(stderr),
		"exit_code": exitCode,
	}, nil
}
