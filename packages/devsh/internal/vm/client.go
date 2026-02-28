// Package vm provides a simple client for managing Morph VMs via Convex API.
package vm

import (
	"bufio"
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

	"github.com/karlorz/devsh/internal/auth"
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

// doRequest makes an authenticated request to the Convex HTTP API
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

// doWwwRequest makes an authenticated request to the www API (for sandbox operations)
func (c *Client) doWwwRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
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

	// www API is at CmuxURL (not ConvexSiteURL)
	cfg := auth.GetConfig()
	url := cfg.CmuxURL + path
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

// Team represents a team the user is a member of
type Team struct {
	TeamID      string `json:"teamId"`
	Slug        string `json:"slug"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	Selected    bool   `json:"selected"`
}

// ListTeamsResult represents the result of listing teams
type ListTeamsResult struct {
	Teams          []Team `json:"teams"`
	SelectedTeamID string `json:"selectedTeamId"`
}

// SwitchTeamResult represents the result of switching teams
type SwitchTeamResult struct {
	TeamID          string `json:"teamId"`
	TeamSlug        string `json:"teamSlug"`
	TeamDisplayName string `json:"teamDisplayName"`
}

// ListTeams lists all teams the user is a member of
func (c *Client) ListTeams(ctx context.Context) (*ListTeamsResult, error) {
	resp, err := c.doRequest(ctx, "GET", "/api/v1/cmux/me/teams", nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result ListTeamsResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// SwitchTeam switches the user's selected team
func (c *Client) SwitchTeam(ctx context.Context, teamSlugOrId string) (*SwitchTeamResult, error) {
	body := map[string]string{
		"teamSlugOrId": teamSlugOrId,
	}

	resp, err := c.doRequest(ctx, "POST", "/api/v1/cmux/me/team", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result SwitchTeamResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// Task represents a task from the web app
type Task struct {
	ID          string `json:"id"`
	Prompt      string `json:"prompt"`
	Repository  string `json:"repository"`
	BaseBranch  string `json:"baseBranch"`
	Status      string `json:"status"`
	Agent       string `json:"agent"`
	VSCodeURL   string `json:"vscodeUrl"`
	IsCompleted bool   `json:"isCompleted"`
	IsArchived  bool   `json:"isArchived"`
	CreatedAt   int64  `json:"createdAt"`
	UpdatedAt   int64  `json:"updatedAt"`
	TaskRunID   string `json:"taskRunId"`
	ExitCode    *int   `json:"exitCode,omitempty"`
}

// TaskRun represents a run within a task
type TaskRun struct {
	ID             string `json:"id"`
	Agent          string `json:"agent"`
	Status         string `json:"status"`
	VSCodeURL      string `json:"vscodeUrl"`
	PullRequestURL string `json:"pullRequestUrl"`
	CreatedAt      int64  `json:"createdAt"`
	CompletedAt    int64  `json:"completedAt"`
	ExitCode       *int   `json:"exitCode,omitempty"`
}

// TaskImage represents a task image stored in Convex.
type TaskImage struct {
	StorageID string `json:"storageId"`
	AltText   string `json:"altText"`
	FileName  string `json:"fileName,omitempty"`
}

// TaskDetail represents a task with full details including runs
type TaskDetail struct {
	ID          string    `json:"id"`
	Prompt      string    `json:"prompt"`
	Repository  string    `json:"repository"`
	BaseBranch  string    `json:"baseBranch"`
	IsCompleted bool      `json:"isCompleted"`
	IsArchived  bool      `json:"isArchived"`
	Pinned      bool      `json:"pinned,omitempty"`
	MergeStatus string    `json:"mergeStatus,omitempty"`
	PRTitle     string    `json:"pullRequestTitle,omitempty"`
	CrownStatus string    `json:"crownEvaluationStatus,omitempty"`
	CrownError  string    `json:"crownEvaluationError,omitempty"`
	CreatedAt   int64     `json:"createdAt"`
	UpdatedAt   int64     `json:"updatedAt"`
	TaskRuns    []TaskRun `json:"taskRuns"`
	Images      []TaskImage `json:"images,omitempty"`
}

// ListTasksResult represents the result of listing tasks
type ListTasksResult struct {
	Tasks []Task `json:"tasks"`
}

// Environment represents a sandbox environment configuration
type Environment struct {
	ID             string   `json:"id"`
	Name           string   `json:"name"`
	SnapshotID     string   `json:"snapshotId"`
	SelectedRepos  []string `json:"selectedRepos,omitempty"`
	Description    string   `json:"description,omitempty"`
	CreatedAt      int64    `json:"createdAt"`
	UpdatedAt      int64    `json:"updatedAt"`
}

// CreateTaskOptions represents options for creating a task
type CreateTaskOptions struct {
	Prompt           string
	Repository       string
	BaseBranch       string
	Agents           []string
	Images           []TaskImage
	PRTitle          string
	EnvironmentID    string
	IsCloudWorkspace bool
}

// TaskRunWithJWT represents a task run with its JWT for sandbox auth
type TaskRunWithJWT struct {
	TaskRunID string `json:"taskRunId"`
	JWT       string `json:"jwt"`
	AgentName string `json:"agentName"`
}

// CreateTaskResult represents the result of creating a task
type CreateTaskResult struct {
	TaskID   string           `json:"taskId"`
	TaskRuns []TaskRunWithJWT `json:"taskRuns"`
	Status   string           `json:"status"`
}

// StartSandboxOptions represents options for starting a sandbox
type StartSandboxOptions struct {
	TaskRunID       string
	TaskRunJWT      string
	AgentName       string
	Prompt          string
	ProjectFullName string
	RepoURL         string
	Branch          string
	TTLSeconds      int
}

// StartSandboxResult represents the result of starting a sandbox
type StartSandboxResult struct {
	InstanceID string `json:"instanceId"`
	Provider   string `json:"provider"`
	VSCodeURL  string `json:"vscodeUrl"`
	VncURL     string `json:"vncUrl"`
	XtermURL   string `json:"xtermUrl"`
	WorkerURL  string `json:"workerUrl"`
}

// ListTasks lists all tasks for the team
func (c *Client) ListTasks(ctx context.Context, archived bool) (*ListTasksResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v1/cmux/tasks?teamSlugOrId=%s&archived=%t", c.teamSlug, archived)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result ListTasksResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// ListEnvironments lists all environments for the team.
// /api/environments is a Hono route on the www app, not a Convex site route.
func (c *Client) ListEnvironments(ctx context.Context) ([]Environment, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/environments?teamSlugOrId=%s", c.teamSlug)
	resp, err := c.doWwwRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result []Environment
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result, nil
}

// FindEnvironmentForRepo finds the most recent environment that includes the given repository
// Returns the environment ID or empty string if none found
func (c *Client) FindEnvironmentForRepo(ctx context.Context, repository string) (string, error) {
	environments, err := c.ListEnvironments(ctx)
	if err != nil {
		return "", err
	}

	// Environments are returned in descending order by creation time
	// Find the first one that includes this repository
	for _, env := range environments {
		for _, repo := range env.SelectedRepos {
			if repo == repository {
				return env.ID, nil
			}
		}
	}

	return "", nil
}

// CreateTask creates a new task with optional task runs
func (c *Client) CreateTask(ctx context.Context, opts CreateTaskOptions) (*CreateTaskResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"prompt":       opts.Prompt,
	}
	if opts.Repository != "" {
		body["repository"] = opts.Repository
	}
	if opts.BaseBranch != "" {
		body["baseBranch"] = opts.BaseBranch
	}
	if len(opts.Agents) > 0 {
		body["agents"] = opts.Agents
	}
	if len(opts.Images) > 0 {
		body["images"] = opts.Images
	}
	if opts.PRTitle != "" {
		body["prTitle"] = opts.PRTitle
	}
	if opts.EnvironmentID != "" {
		body["environmentId"] = opts.EnvironmentID
	}
	if opts.IsCloudWorkspace {
		body["isCloudWorkspace"] = true
	}

	resp, err := c.doRequest(ctx, "POST", "/api/v1/cmux/tasks", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result CreateTaskResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// CreateStorageUploadURL returns a one-time Convex upload URL for storing a file.
func (c *Client) CreateStorageUploadURL(ctx context.Context) (string, error) {
	if c.teamSlug == "" {
		return "", fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", "/api/v1/cmux/storage/upload-url", body)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		UploadURL string `json:"uploadUrl"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode response: %w", err)
	}
	if result.UploadURL == "" {
		return "", fmt.Errorf("missing uploadUrl in response")
	}

	return result.UploadURL, nil
}

// UploadFileToStorage uploads a local file to Convex storage and returns its storage ID.
func (c *Client) UploadFileToStorage(ctx context.Context, filePath string) (string, error) {
	uploadURL, err := c.CreateStorageUploadURL(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to create upload URL: %w", err)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %w", err)
	}

	contentType := http.DetectContentType(data)
	req, err := http.NewRequestWithContext(ctx, "POST", uploadURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to create upload request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("upload failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		StorageID string `json:"storageId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", fmt.Errorf("failed to decode upload response: %w", err)
	}
	if result.StorageID == "" {
		return "", fmt.Errorf("missing storageId in upload response")
	}

	return result.StorageID, nil
}

// StartSandbox starts a sandbox for a task run via the www API
func (c *Client) StartSandbox(ctx context.Context, opts StartSandboxOptions) (*StartSandboxResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"taskRunId":    opts.TaskRunID,
		"taskRunJwt":   opts.TaskRunJWT,
	}
	if opts.AgentName != "" {
		body["agentName"] = opts.AgentName
	}
	if opts.Prompt != "" {
		body["prompt"] = opts.Prompt
	}
	if opts.ProjectFullName != "" {
		body["projectFullName"] = opts.ProjectFullName
	}
	if opts.RepoURL != "" {
		body["repoUrl"] = opts.RepoURL
	}
	if opts.Branch != "" {
		body["branch"] = opts.Branch
	}
	if opts.TTLSeconds > 0 {
		body["ttlSeconds"] = opts.TTLSeconds
	} else {
		body["ttlSeconds"] = 3600 // Default 1 hour
	}

	// Call the www API /api/sandboxes/start endpoint
	resp, err := c.doWwwRequest(ctx, "POST", "/api/sandboxes/start", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sandbox start failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result StartSandboxResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// SetupProvidersResult represents the result of setting up provider auth
type SetupProvidersResult struct {
	Success   bool     `json:"success"`
	Providers []string `json:"providers"`
}

// SetupProviders configures Claude + Codex provider auth on an existing sandbox.
// Calls POST /api/sandboxes/{id}/setup-providers on the www API.
func (c *Client) SetupProviders(ctx context.Context, instanceID string) (*SetupProvidersResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doWwwRequest(ctx, "POST",
		fmt.Sprintf("/api/sandboxes/%s/setup-providers", instanceID), body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("setup-providers failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result SetupProvidersResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// GetTask gets the details of a specific task
func (c *Client) GetTask(ctx context.Context, taskID string) (*TaskDetail, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v1/cmux/tasks/%s?teamSlugOrId=%s", taskID, c.teamSlug)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result TaskDetail
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// StopTask stops/archives a task
func (c *Client) StopTask(ctx context.Context, taskID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/tasks/%s/stop", taskID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// ToggleTaskPin toggles a task's pinned state and returns the new state.
func (c *Client) ToggleTaskPin(ctx context.Context, taskID string) (bool, error) {
	if c.teamSlug == "" {
		return false, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/tasks/%s/pin", taskID), body)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result struct {
		Pinned bool `json:"pinned"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return false, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Pinned, nil
}

// ArchiveTask archives a task and all of its runs.
func (c *Client) ArchiveTask(ctx context.Context, taskID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/tasks/%s/archive", taskID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// UnarchiveTask unarchives a task and all of its runs.
func (c *Client) UnarchiveTask(ctx context.Context, taskID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v1/cmux/tasks/%s/unarchive", taskID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// StartTaskAgentsOptions represents options for starting agents via apps/server HTTP API
type StartTaskAgentsOptions struct {
	TaskID          string
	TaskDescription string
	ProjectFullName string
	RepoURL         string
	Branch          string
	TaskRunIDs      []string
	SelectedAgents  []string
	IsCloudMode     bool
	EnvironmentID   string
	Theme           string
	PRTitle         string
}

// StartTaskAgentsResult represents the result of starting task agents
type StartTaskAgentsResult struct {
	TaskID  string                    `json:"taskId"`
	Results []StartTaskAgentResult    `json:"results"`
}

// StartTaskAgentResult represents a single agent spawn result
type StartTaskAgentResult struct {
	AgentName string `json:"agentName"`
	TaskRunID string `json:"taskRunId"`
	VSCodeURL string `json:"vscodeUrl,omitempty"`
	Success   bool   `json:"success"`
	Error     string `json:"error,omitempty"`
}

// doServerRequest makes an authenticated request to the apps/server HTTP API
func (c *Client) doServerRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
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

	// apps/server API is at ServerURL (socket.io server)
	cfg := auth.GetConfig()
	url := cfg.ServerURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	return c.httpClient.Do(req)
}

// doServerRequestWithJwt makes a request to apps/server using X-Task-Run-JWT auth
// This allows agents to spawn sub-agents using their task-run JWT
func (c *Client) doServerRequestWithJwt(ctx context.Context, method, path string, body interface{}, jwt string) (*http.Response, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		bodyReader = bytes.NewReader(data)
	}

	// apps/server API is at ServerURL (socket.io server)
	cfg := auth.GetConfig()
	url := cfg.ServerURL + path
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, err
	}

	req.Header.Set("X-Task-Run-JWT", jwt)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	return c.httpClient.Do(req)
}

// StartTaskAgents starts agents for a task using the same flow as web app
// This calls apps/server HTTP API which uses the same agentSpawner as socket.io
func (c *Client) StartTaskAgents(ctx context.Context, opts StartTaskAgentsOptions) (*StartTaskAgentsResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId":    c.teamSlug,
		"taskId":          opts.TaskID,
		"taskDescription": opts.TaskDescription,
		"projectFullName": opts.ProjectFullName,
		"isCloudMode":     opts.IsCloudMode,
	}
	if opts.RepoURL != "" {
		body["repoUrl"] = opts.RepoURL
	}
	if opts.Branch != "" {
		body["branch"] = opts.Branch
	}
	if len(opts.TaskRunIDs) > 0 {
		body["taskRunIds"] = opts.TaskRunIDs
	}
	if len(opts.SelectedAgents) > 0 {
		body["selectedAgents"] = opts.SelectedAgents
	}
	if opts.EnvironmentID != "" {
		body["environmentId"] = opts.EnvironmentID
	}
	if opts.Theme != "" {
		body["theme"] = opts.Theme
	}
	if opts.PRTitle != "" {
		body["prTitle"] = opts.PRTitle
	}

	resp, err := c.doServerRequest(ctx, "POST", "/api/start-task", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("start-task failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result StartTaskAgentsResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// CreateCloudWorkspaceOptions contains options for creating a cloud workspace
type CreateCloudWorkspaceOptions struct {
	TaskID          string
	EnvironmentID   string
	ProjectFullName string
	RepoURL         string
	Theme           string
}

// CreateCloudWorkspaceResult represents the result of creating a cloud workspace
type CreateCloudWorkspaceResult struct {
	Success   bool   `json:"success"`
	TaskID    string `json:"taskId"`
	TaskRunID string `json:"taskRunId"`
	VSCodeURL string `json:"vscodeUrl,omitempty"`
	VNCURL    string `json:"vncUrl,omitempty"`
	Error     string `json:"error,omitempty"`
}

// CreateCloudWorkspace creates a cloud workspace without running an agent
// This spawns a sandbox with VSCode access, matching the web UI flow
func (c *Client) CreateCloudWorkspace(ctx context.Context, opts CreateCloudWorkspaceOptions) (*CreateCloudWorkspaceResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"taskId":       opts.TaskID,
	}
	if opts.EnvironmentID != "" {
		body["environmentId"] = opts.EnvironmentID
	}
	if opts.ProjectFullName != "" {
		body["projectFullName"] = opts.ProjectFullName
	}
	if opts.RepoURL != "" {
		body["repoUrl"] = opts.RepoURL
	}
	if opts.Theme != "" {
		body["theme"] = opts.Theme
	}

	resp, err := c.doServerRequest(ctx, "POST", "/api/create-cloud-workspace", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("create-cloud-workspace failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result CreateCloudWorkspaceResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// MemorySnapshot represents a single memory snapshot from a task run
type MemorySnapshot struct {
	ID         string `json:"id"`
	MemoryType string `json:"memoryType"`
	Content    string `json:"content"`
	FileName   string `json:"fileName,omitempty"`
	Date       string `json:"date,omitempty"`
	Truncated  bool   `json:"truncated"`
	AgentName  string `json:"agentName,omitempty"`
	CreatedAt  int64  `json:"createdAt,omitempty"`
}

// GetTaskRunMemoryResult represents the result of getting task run memory
type GetTaskRunMemoryResult struct {
	Memory []MemorySnapshot `json:"memory"`
}

// GetTaskRunMemory gets memory snapshots for a specific task run
func (c *Client) GetTaskRunMemory(ctx context.Context, taskRunID string, memoryType string) (*GetTaskRunMemoryResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v1/cmux/task-runs/%s/memory?teamSlugOrId=%s", taskRunID, c.teamSlug)
	if memoryType != "" {
		path += "&type=" + memoryType
	}

	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result GetTaskRunMemoryResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// ============================================================================
// Orchestration API
// ============================================================================

// OrchestrationSpawnOptions represents options for spawning with orchestration tracking
type OrchestrationSpawnOptions struct {
	Prompt              string
	Agent               string
	Repo                string
	Branch              string
	PRTitle             string
	EnvironmentID       string
	IsCloudMode         bool
	DependsOn           []string // Orchestration task IDs this task depends on
	Priority            int      // Task priority (1=highest, 10=lowest, default 5)
	TaskRunJwt          string   // If set, use X-Task-Run-JWT header instead of Bearer token
	IsCloudWorkspace    bool     // If true, spawn as a cloud workspace (interactive TUI session)
	IsOrchestrationHead bool     // If true, mark as orchestration head (coordinates sub-agents)
}

// OrchestrationSpawnResult represents the result of spawning an agent with orchestration
type OrchestrationSpawnResult struct {
	OrchestrationTaskID string `json:"orchestrationTaskId"`
	TaskID              string `json:"taskId"`
	TaskRunID           string `json:"taskRunId"`
	AgentName           string `json:"agentName"`
	VSCodeURL           string `json:"vscodeUrl,omitempty"`
	Status              string `json:"status"`
}

// OrchestrationTask represents an orchestration task from the API
type OrchestrationTask struct {
	ID                string   `json:"_id"`
	TeamID            string   `json:"teamId"`
	UserID            string   `json:"userId"`
	Prompt            string   `json:"prompt"`
	Status            string   `json:"status"`
	Priority          int      `json:"priority"`
	Dependencies      []string `json:"dependencies,omitempty"`
	AssignedAgentName *string  `json:"assignedAgentName,omitempty"`
	AssignedSandboxID *string  `json:"assignedSandboxId,omitempty"`
	TaskID            *string  `json:"taskId,omitempty"`
	TaskRunID         *string  `json:"taskRunId,omitempty"`
	Result            *string  `json:"result,omitempty"`
	ErrorMessage      *string  `json:"errorMessage,omitempty"`
	CreatedAt         int64    `json:"createdAt"`
	UpdatedAt         int64    `json:"updatedAt"`
	AssignedAt        *int64   `json:"assignedAt,omitempty"`
	StartedAt         *int64   `json:"startedAt,omitempty"`
	CompletedAt       *int64   `json:"completedAt,omitempty"`
}

// OrchestrationListResult represents the result of listing orchestration tasks
type OrchestrationListResult struct {
	Tasks []OrchestrationTask `json:"tasks"`
}

// OrchestrationStatusResult represents the status of an orchestration task
type OrchestrationStatusResult struct {
	Task    OrchestrationTask `json:"task"`
	TaskRun *TaskRun          `json:"taskRun,omitempty"`
}

// OrchestrationSpawn spawns an agent with orchestration tracking
func (c *Client) OrchestrationSpawn(ctx context.Context, opts OrchestrationSpawnOptions) (*OrchestrationSpawnResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"prompt":       opts.Prompt,
		"agent":        opts.Agent,
		"isCloudMode":  opts.IsCloudMode,
	}
	if opts.Repo != "" {
		body["repo"] = opts.Repo
	}
	if opts.Branch != "" {
		body["branch"] = opts.Branch
	}
	if opts.PRTitle != "" {
		body["prTitle"] = opts.PRTitle
	}
	if opts.EnvironmentID != "" {
		body["environmentId"] = opts.EnvironmentID
	}
	if len(opts.DependsOn) > 0 {
		body["dependsOn"] = opts.DependsOn
	}
	// Always send priority (0=highest is valid, server defaults to 5 if omitted)
	body["priority"] = opts.Priority
	if opts.IsCloudWorkspace {
		body["isCloudWorkspace"] = true
	}
	if opts.IsOrchestrationHead {
		body["isOrchestrationHead"] = true
	}

	var resp *http.Response
	var err error

	// Use JWT auth if TaskRunJwt is provided, otherwise use Bearer token
	if opts.TaskRunJwt != "" {
		resp, err = c.doServerRequestWithJwt(ctx, "POST", "/api/orchestrate/spawn", body, opts.TaskRunJwt)
	} else {
		resp, err = c.doServerRequest(ctx, "POST", "/api/orchestrate/spawn", body)
	}
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orchestration spawn failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result OrchestrationSpawnResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// OrchestrationList lists orchestration tasks for the team
func (c *Client) OrchestrationList(ctx context.Context, status string) (*OrchestrationListResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/orchestrate/list?teamSlugOrId=%s", c.teamSlug)
	if status != "" {
		path += "&status=" + status
	}

	resp, err := c.doServerRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orchestration list failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result OrchestrationListResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// OrchestrationStatus gets the status of an orchestration task
func (c *Client) OrchestrationStatus(ctx context.Context, orchTaskID string) (*OrchestrationStatusResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/orchestrate/status/%s?teamSlugOrId=%s", orchTaskID, c.teamSlug)

	resp, err := c.doServerRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orchestration status failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result OrchestrationStatusResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// OrchestrationCancel cancels an orchestration task
func (c *Client) OrchestrationCancel(ctx context.Context, orchTaskID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doServerRequest(ctx, "POST", fmt.Sprintf("/api/orchestrate/cancel/%s", orchTaskID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("orchestration cancel failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// SendOrchestrateMessage sends a message to a running agent via the orchestrate message endpoint
func (c *Client) SendOrchestrateMessage(ctx context.Context, taskRunID string, message string, messageType string, teamSlugOrId string) error {
	body := map[string]interface{}{
		"taskRunId":    taskRunID,
		"message":      message,
		"messageType":  messageType,
		"teamSlugOrId": teamSlugOrId,
	}

	resp, err := c.doWwwRequest(ctx, "POST", "/api/orchestrate/message", body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		return fmt.Errorf("orchestrate message failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	return nil
}

// OrchestrationMigrateOptions represents options for migrating orchestration state
type OrchestrationMigrateOptions struct {
	PlanJson      string // Raw PLAN.json content (required)
	AgentsJson    string // Raw AGENTS.json content (optional)
	Agent         string // Override head agent (defaults to plan.headAgent)
	Repo          string
	Branch        string
	EnvironmentID string
}

// OrchestrationMigrateResult represents the result of migrating orchestration state
type OrchestrationMigrateResult struct {
	OrchestrationTaskID string `json:"orchestrationTaskId"`
	TaskID              string `json:"taskId"`
	TaskRunID           string `json:"taskRunId"`
	AgentName           string `json:"agentName"`
	OrchestrationID     string `json:"orchestrationId"`
	VSCodeURL           string `json:"vscodeUrl,omitempty"`
	Status              string `json:"status"`
}

// OrchestrationMigrate migrates local orchestration state to a sandbox
func (c *Client) OrchestrationMigrate(ctx context.Context, opts OrchestrationMigrateOptions) (*OrchestrationMigrateResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	if opts.PlanJson == "" {
		return nil, fmt.Errorf("planJson is required")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"planJson":     opts.PlanJson,
	}
	if opts.AgentsJson != "" {
		body["agentsJson"] = opts.AgentsJson
	}
	if opts.Agent != "" {
		body["agent"] = opts.Agent
	}
	if opts.Repo != "" {
		body["repo"] = opts.Repo
	}
	if opts.Branch != "" {
		body["branch"] = opts.Branch
	}
	if opts.EnvironmentID != "" {
		body["environmentId"] = opts.EnvironmentID
	}

	resp, err := c.doServerRequest(ctx, "POST", "/api/orchestrate/migrate", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orchestration migrate failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result OrchestrationMigrateResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// OrchestrationResultsResult represents aggregated results from all sub-agents
type OrchestrationResultsResult struct {
	OrchestrationID string                      `json:"orchestrationId"`
	Status          string                      `json:"status"` // running, completed, failed, partial
	TotalTasks      int                         `json:"totalTasks"`
	CompletedTasks  int                         `json:"completedTasks"`
	Results         []OrchestrationResultEntry  `json:"results"`
}

// OrchestrationResultEntry represents a single task result
type OrchestrationResultEntry struct {
	TaskID       string  `json:"taskId"`
	AgentName    *string `json:"agentName,omitempty"`
	Status       string  `json:"status"`
	Prompt       string  `json:"prompt"`
	Result       *string `json:"result,omitempty"`
	ErrorMessage *string `json:"errorMessage,omitempty"`
	TaskRunID    *string `json:"taskRunId,omitempty"`
}

// OrchestrationResults gets aggregated results from all sub-agents
func (c *Client) OrchestrationResults(ctx context.Context, orchestrationID string, taskRunJwt string) (*OrchestrationResultsResult, error) {
	path := fmt.Sprintf("/api/orchestrate/results/%s", orchestrationID)

	var resp *http.Response
	var err error

	// Use JWT auth if provided, otherwise use Bearer token
	if taskRunJwt != "" {
		resp, err = c.doServerRequestWithJwt(ctx, "GET", path, nil, taskRunJwt)
	} else {
		if c.teamSlug == "" {
			return nil, fmt.Errorf("team slug not set")
		}
		path = fmt.Sprintf("/api/orchestrate/results/%s?teamSlugOrId=%s", orchestrationID, c.teamSlug)
		resp, err = c.doServerRequest(ctx, "GET", path, nil)
	}
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orchestration results failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result OrchestrationResultsResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// OrchestrationMetricsResult represents metrics for orchestration monitoring
type OrchestrationMetricsResult struct {
	ActiveOrchestrations int                                  `json:"activeOrchestrations"`
	TasksByStatus        map[string]int                       `json:"tasksByStatus"`
	ProviderHealth       map[string]OrchestrationProviderInfo `json:"providerHealth"`
}

// OrchestrationProviderInfo represents health info for a provider
type OrchestrationProviderInfo struct {
	Status       string  `json:"status"`
	CircuitState string  `json:"circuitState"`
	LatencyP50   float64 `json:"latencyP50"`
	LatencyP99   float64 `json:"latencyP99"`
	SuccessRate  float64 `json:"successRate"`
	FailureCount int     `json:"failureCount"`
}

// OrchestrationEvent represents an SSE event from orchestration updates
type OrchestrationEvent struct {
	Event string                 `json:"event"`
	Data  map[string]interface{} `json:"data"`
	ID    string                 `json:"id,omitempty"`
}

// OrchestrationSSECallback is called for each SSE event received
type OrchestrationSSECallback func(event OrchestrationEvent)

// SubscribeOrchestrationEvents connects to the SSE endpoint for real-time updates
// Returns a channel that closes when the connection ends
func (c *Client) SubscribeOrchestrationEvents(ctx context.Context, orchestrationID string, taskRunJwt string, callback OrchestrationSSECallback) error {
	cfg := auth.GetConfig()

	path := fmt.Sprintf("/api/orchestrate/events/%s", orchestrationID)
	if c.teamSlug != "" && taskRunJwt == "" {
		path += "?teamSlugOrId=" + c.teamSlug
	}

	url := cfg.ServerURL + path

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Set auth header
	if taskRunJwt != "" {
		req.Header.Set("X-Task-Run-JWT", taskRunJwt)
	} else {
		accessToken, err := auth.GetAccessToken()
		if err != nil {
			return fmt.Errorf("not authenticated: %w", err)
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
	}

	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")

	// Use a client without timeout for SSE
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("SSE connection failed: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return fmt.Errorf("SSE endpoint returned %d", resp.StatusCode)
	}

	// Read SSE events in a goroutine
	go func() {
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		// Set larger buffer to handle large SSE payloads (256KB max line)
		const maxScanTokenSize = 256 * 1024
		scanner.Buffer(make([]byte, maxScanTokenSize), maxScanTokenSize)

		var eventType string
		var data string
		var id string

		for scanner.Scan() {
			line := scanner.Text()

			if line == "" {
				// Empty line = end of event
				if eventType != "" && data != "" {
					var eventData map[string]interface{}
					if err := json.Unmarshal([]byte(data), &eventData); err == nil {
						callback(OrchestrationEvent{
							Event: eventType,
							Data:  eventData,
							ID:    id,
						})
					}
				}
				eventType = ""
				data = ""
				id = ""
				continue
			}

			if strings.HasPrefix(line, "event:") {
				eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
			} else if strings.HasPrefix(line, "data:") {
				data = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			} else if strings.HasPrefix(line, "id:") {
				id = strings.TrimSpace(strings.TrimPrefix(line, "id:"))
			}
		}

		// Log scanner errors if any
		if err := scanner.Err(); err != nil {
			fmt.Fprintf(os.Stderr, "[SSE] Scanner error: %v\n", err)
		}
	}()

	return nil
}

// OrchestrationMetrics gets orchestration metrics including provider health
func (c *Client) OrchestrationMetrics(ctx context.Context) (*OrchestrationMetricsResult, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/orchestrate/metrics?teamSlugOrId=%s", c.teamSlug)

	resp, err := c.doServerRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("orchestration metrics failed (%d): %s", resp.StatusCode, readErrorBody(resp.Body))
	}

	var result OrchestrationMetricsResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}
