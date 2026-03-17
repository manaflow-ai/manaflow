// Package vm provides a simple client for managing Morph VMs via Convex API.
package vm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
)

// readErrorBody reads the response body for error messages, handling read errors gracefully
func readErrorBody(body io.Reader) string {
	data, err := io.ReadAll(body)
	if err != nil {
		return fmt.Sprintf("(failed to read response body: %v)", err)
	}
	if len(data) == 0 {
		return "(empty response)"
	}
	return string(data)
}

// Instance represents a VM instance
type Instance struct {
	ID              string `json:"id"`              // Our cmux ID (Convex doc ID)
	MorphInstanceID string `json:"morphInstanceId"` // Internal Morph ID
	Status          string `json:"status"`
	VSCodeURL       string `json:"vscodeUrl"`
	VNCURL          string `json:"vncUrl"`
	WorkerURL       string `json:"workerUrl"`
	ChromeURL       string `json:"chromeUrl"` // Chrome DevTools proxy URL
}

// Client is a simple VM management client
type Client struct {
	httpClient *http.Client
	baseURL    string
	teamSlug   string
}

// NewClient creates a new VM client
func NewClient() (*Client, error) {
	cfg := auth.GetConfig()
	return &Client{
		httpClient: &http.Client{Timeout: 180 * time.Second}, // 3 minutes for slow Morph operations
		baseURL:    cfg.ConvexSiteURL,
	}, nil
}

// SetTeamSlug sets the team slug for API calls
func (c *Client) SetTeamSlug(teamSlug string) {
	c.teamSlug = teamSlug
}

// doRequest makes an authenticated request to the API
func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
	accessToken, err := auth.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("not authenticated: %w", err)
	}

	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(data)
	}

	url := c.baseURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	return c.httpClient.Do(req)
}

// CreateOptions for creating a VM
type CreateOptions struct {
	SnapshotID string
	Name       string
	TTLSeconds int
}

// CreateInstance creates a new VM instance
func (c *Client) CreateInstance(ctx context.Context, opts CreateOptions) (*Instance, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}
	if opts.SnapshotID != "" {
		body["snapshotId"] = opts.SnapshotID
	}
	if opts.Name != "" {
		body["name"] = opts.Name
	}
	if opts.TTLSeconds > 0 {
		body["ttlSeconds"] = opts.TTLSeconds
	}

	resp, err := c.doRequest(ctx, "POST", "/api/v1/cmux/instances", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result Instance
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// GetInstance gets the status of an instance
func (c *Client) GetInstance(ctx context.Context, instanceID string) (*Instance, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v1/cmux/instances/%s?teamSlugOrId=%s", instanceID, c.teamSlug)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result Instance
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// StopInstance stops (deletes) an instance
func (c *Client) StopInstance(ctx context.Context, instanceID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/instances/%s/stop", instanceID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// PauseInstance pauses an instance
func (c *Client) PauseInstance(ctx context.Context, instanceID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/instances/%s/pause", instanceID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// ResumeInstance resumes a paused instance
func (c *Client) ResumeInstance(ctx context.Context, instanceID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/instances/%s/resume", instanceID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// ListInstances lists all instances for the team
func (c *Client) ListInstances(ctx context.Context) ([]Instance, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v1/cmux/instances?teamSlugOrId=%s", c.teamSlug)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		Instances []Instance `json:"instances"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Instances, nil
}

// WaitForReady waits for an instance to be ready
func (c *Client) WaitForReady(ctx context.Context, instanceID string, timeout time.Duration) (*Instance, error) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		instance, err := c.GetInstance(ctx, instanceID)
		if err != nil {
			// Keep trying on transient errors
			time.Sleep(2 * time.Second)
			continue
		}

		if instance.Status == "running" {
			return instance, nil
		}

		if instance.Status == "stopped" || instance.Status == "error" {
			return nil, fmt.Errorf("instance failed with status: %s", instance.Status)
		}

		time.Sleep(2 * time.Second)
	}

	return nil, fmt.Errorf("timeout waiting for instance to be ready")
}

// ExecCommand executes a command in the VM
func (c *Client) ExecCommand(ctx context.Context, instanceID string, command string) (string, string, int, error) {
	if c.teamSlug == "" {
		return "", "", -1, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"command":      command,
		"timeout":      60,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/instances/%s/exec", instanceID), body)
	if err != nil {
		return "", "", -1, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", -1, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		Stdout   string `json:"stdout"`
		Stderr   string `json:"stderr"`
		ExitCode int    `json:"exit_code"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", -1, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Stdout, result.Stderr, result.ExitCode, nil
}

// GenerateAuthToken generates a one-time auth token for browser access
func (c *Client) GenerateAuthToken(ctx context.Context, instanceID string) (string, error) {
	if c.teamSlug == "" {
		return "", fmt.Errorf("team slug not set")
	}

	// First, get the instance to get the worker URL
	instance, err := c.GetInstance(ctx, instanceID)
	if err != nil {
		return "", fmt.Errorf("failed to get instance: %w", err)
	}
	if instance.WorkerURL == "" {
		return "", fmt.Errorf("worker URL not available")
	}

	// Get access token for worker auth
	accessToken, err := auth.GetAccessToken()
	if err != nil {
		return "", fmt.Errorf("not authenticated: %w", err)
	}

	// Call the worker's /_cmux/generate-token endpoint
	workerURL := strings.TrimRight(instance.WorkerURL, "/") + "/_cmux/generate-token"

	req, err := http.NewRequestWithContext(ctx, "POST", workerURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to call worker: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("worker error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Token, nil
}

// GetSSHCredentials gets SSH credentials for an instance
func (c *Client) GetSSHCredentials(ctx context.Context, instanceID string) (string, error) {
	if c.teamSlug == "" {
		return "", fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v1/cmux/instances/%s/ssh?teamSlugOrId=%s", instanceID, c.teamSlug)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		SSHCommand string `json:"sshCommand"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}

	return result.SSHCommand, nil
}

// sshOptions returns SSH options for connecting to ephemeral VMs.
//
// Security Note: Host key verification is disabled because:
// 1. VMs are ephemeral and get new host keys on each creation
// 2. Connections go through Morph's SSH proxy which terminates TLS
// 3. Users authenticate to their own VMs via Morph tokens
//
// This is a deliberate tradeoff for usability with ephemeral development
// environments. Production systems should use proper host key verification.
func sshOptions() []string {
	return []string{
		"-o", "StrictHostKeyChecking=no",
		"-o", "UserKnownHostsFile=/dev/null",
	}
}

func resolveRemoteSyncPath(ctx context.Context, sshTarget string) (string, error) {
	// Use a single-line command that works reliably over SSH
	script := `for p in /home/cmux/workspace /root/workspace /workspace /home/user/project; do [ -d "$p" ] && echo "$p" && exit 0; done; echo "$HOME"`
	cmdArgs := append(sshOptions(), sshTarget, script)
	cmd := exec.CommandContext(ctx, "ssh", cmdArgs...)
	// Use Output() not CombinedOutput() to avoid stderr (SSH warnings) in the path
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("failed to determine remote sync path: %w", err)
	}

	remotePath := strings.TrimSpace(string(output))
	if remotePath == "" {
		return "", fmt.Errorf("remote sync path is empty")
	}

	return remotePath, nil
}

func ensureRemoteDir(ctx context.Context, sshTarget, remotePath string) error {
	// Use a single command string to avoid issues with argument parsing
	mkdirCmd := fmt.Sprintf("mkdir -p %s", remotePath)
	cmdArgs := append(sshOptions(), sshTarget, mkdirCmd)
	cmd := exec.CommandContext(ctx, "ssh", cmdArgs...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		trimmed := strings.TrimSpace(string(output))
		// Ignore "Warning: Permanently added" messages which go to stderr
		if trimmed != "" && !strings.HasPrefix(trimmed, "Warning: Permanently added") {
			return fmt.Errorf("failed to create remote directory: %w: %s", err, trimmed)
		}
		// If the only output is the warning, don't treat as error
		if strings.HasPrefix(trimmed, "Warning: Permanently added") {
			return nil
		}
		return fmt.Errorf("failed to create remote directory: %w", err)
	}

	return nil
}

func formatRemotePath(remotePath string) string {
	if strings.HasSuffix(remotePath, "/") {
		return remotePath
	}
	return remotePath + "/"
}

// SyncToVM syncs a local directory to the VM using rsync over SSH
func (c *Client) SyncToVM(ctx context.Context, instanceID string, localPath string) error {
	// Get SSH credentials
	sshCmd, err := c.GetSSHCredentials(ctx, instanceID)
	if err != nil {
		return fmt.Errorf("failed to get SSH credentials: %w", err)
	}

	// Parse SSH command: "ssh token@ssh.cloud.morph.so"
	parts := strings.Fields(sshCmd)
	if len(parts) < 2 {
		return fmt.Errorf("invalid SSH command format")
	}
	sshTarget := parts[1] // token@ssh.cloud.morph.so

	remotePath, err := resolveRemoteSyncPath(ctx, sshTarget)
	if err != nil {
		return err
	}

	if err := ensureRemoteDir(ctx, sshTarget, remotePath); err != nil {
		return err
	}

	remoteDest := formatRemotePath(remotePath)

	// Use rsync to sync files
	// Exclude common large/generated directories
	rsyncArgs := []string{
		"-avz",
		"--delete",
		"--exclude", ".git",
		"--exclude", "node_modules",
		"--exclude", ".next",
		"--exclude", "dist",
		"--exclude", "build",
		"--exclude", "__pycache__",
		"--exclude", ".venv",
		"--exclude", "venv",
		"--exclude", "target",
		"-e", "ssh " + strings.Join(sshOptions(), " "),
		localPath + "/",
		fmt.Sprintf("%s:%s", sshTarget, remoteDest),
	}

	cmd := exec.CommandContext(ctx, "rsync", rsyncArgs...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rsync failed: %w", err)
	}

	return nil
}

// SyncFromVM syncs files from the VM to a local directory
func (c *Client) SyncFromVM(ctx context.Context, instanceID string, localPath string) error {
	// Get SSH credentials
	sshCmd, err := c.GetSSHCredentials(ctx, instanceID)
	if err != nil {
		return fmt.Errorf("failed to get SSH credentials: %w", err)
	}

	// Parse SSH command
	parts := strings.Fields(sshCmd)
	if len(parts) < 2 {
		return fmt.Errorf("invalid SSH command format")
	}
	sshTarget := parts[1]

	remotePath, err := resolveRemoteSyncPath(ctx, sshTarget)
	if err != nil {
		return err
	}

	remoteSource := formatRemotePath(remotePath)

	// Ensure local directory exists
	if err := os.MkdirAll(localPath, 0755); err != nil {
		return fmt.Errorf("failed to create local directory: %w", err)
	}

	// Use rsync to sync files
	rsyncArgs := []string{
		"-avz",
		"--exclude", "node_modules",
		"--exclude", ".next",
		"--exclude", "dist",
		"--exclude", "build",
		"--exclude", "__pycache__",
		"--exclude", ".venv",
		"--exclude", "venv",
		"--exclude", "target",
		"-e", "ssh " + strings.Join(sshOptions(), " "),
		fmt.Sprintf("%s:%s", sshTarget, remoteSource),
		filepath.Clean(localPath) + "/",
	}

	cmd := exec.CommandContext(ctx, "rsync", rsyncArgs...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return fmt.Errorf("rsync failed: %w", err)
	}

	return nil
}

// PtySession represents a PTY session
type PtySession struct {
	ID          string `json:"id"`
	CreatedAt   int64  `json:"createdAt"`
	ClientCount int    `json:"clientCount"`
}

// ListPtySessions lists all PTY sessions in a VM
func (c *Client) ListPtySessions(ctx context.Context, instanceID string) ([]PtySession, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	// Get instance to get worker URL
	instance, err := c.GetInstance(ctx, instanceID)
	if err != nil {
		return nil, fmt.Errorf("failed to get instance: %w", err)
	}
	if instance.WorkerURL == "" {
		return nil, fmt.Errorf("worker URL not available")
	}

	// Get access token
	accessToken, err := auth.GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("not authenticated: %w", err)
	}

	// Call worker's PTY list endpoint
	workerURL := strings.TrimRight(instance.WorkerURL, "/") + "/_cmux/pty/list"

	req, err := http.NewRequestWithContext(ctx, "POST", workerURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to call worker: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("worker error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		Success  bool         `json:"success"`
		Sessions []PtySession `json:"sessions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Sessions, nil
}
