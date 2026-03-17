// Package vm provides a client for managing devbox instances via v2 API (E2B).
package vm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/dba-cli/dba/internal/auth"
)

// V2Instance represents an E2B devbox instance
type V2Instance struct {
	ID        string `json:"id"`
	Provider  string `json:"provider"`
	Status    string `json:"status"`
	VSCodeURL string `json:"vscodeUrl"`
	VNCURL    string `json:"vncUrl"`
	WorkerURL string `json:"workerUrl"`
}

// V2Client is a client for the v2/devbox API (E2B)
type V2Client struct {
	httpClient *http.Client
	baseURL    string
	teamSlug   string
}

// NewV2Client creates a new v2 devbox client
func NewV2Client() (*V2Client, error) {
	cfg := auth.GetConfig()
	return &V2Client{
		httpClient: &http.Client{Timeout: 120 * time.Second},
		baseURL:    cfg.ConvexSiteURL,
	}, nil
}

// SetTeamSlug sets the team slug for API calls
func (c *V2Client) SetTeamSlug(teamSlug string) {
	c.teamSlug = teamSlug
}

// doRequest makes an authenticated request to the API
func (c *V2Client) doRequest(ctx context.Context, method, path string, body interface{}) (*http.Response, error) {
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

// V2CreateOptions for creating an E2B instance
type V2CreateOptions struct {
	TemplateID string
	Name       string
	TTLSeconds int
}

// CreateInstance creates a new E2B devbox instance
func (c *V2Client) CreateInstance(ctx context.Context, opts V2CreateOptions) (*V2Instance, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"provider":     "e2b",
	}
	if opts.TemplateID != "" {
		body["templateId"] = opts.TemplateID
	}
	if opts.Name != "" {
		body["name"] = opts.Name
	}
	if opts.TTLSeconds > 0 {
		body["ttlSeconds"] = opts.TTLSeconds
	}

	resp, err := c.doRequest(ctx, "POST", "/api/v2/devbox/instances", body)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var result V2Instance
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// GetInstance gets the status of an instance
func (c *V2Client) GetInstance(ctx context.Context, instanceID string) (*V2Instance, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v2/devbox/instances/%s?teamSlugOrId=%s", instanceID, c.teamSlug)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var result V2Instance
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// StopInstance stops an instance
func (c *V2Client) StopInstance(ctx context.Context, instanceID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v2/devbox/instances/%s/stop", instanceID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// PauseInstance pauses an instance (extends timeout for E2B)
func (c *V2Client) PauseInstance(ctx context.Context, instanceID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v2/devbox/instances/%s/pause", instanceID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// ResumeInstance resumes an instance
func (c *V2Client) ResumeInstance(ctx context.Context, instanceID string) error {
	if c.teamSlug == "" {
		return fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v2/devbox/instances/%s/resume", instanceID), body)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return nil
}

// ListInstances lists all instances for the team
func (c *V2Client) ListInstances(ctx context.Context) ([]V2Instance, error) {
	if c.teamSlug == "" {
		return nil, fmt.Errorf("team slug not set")
	}

	path := fmt.Sprintf("/api/v2/devbox/instances?teamSlugOrId=%s", c.teamSlug)
	resp, err := c.doRequest(ctx, "GET", path, nil)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Instances []V2Instance `json:"instances"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return result.Instances, nil
}

// ExecCommand executes a command in the instance
func (c *V2Client) ExecCommand(ctx context.Context, instanceID string, command string) (string, string, int, error) {
	if c.teamSlug == "" {
		return "", "", -1, fmt.Errorf("team slug not set")
	}

	body := map[string]interface{}{
		"teamSlugOrId": c.teamSlug,
		"command":      command,
		"timeout":      60,
	}

	resp, err := c.doRequest(ctx, "POST", fmt.Sprintf("/api/v2/devbox/instances/%s/exec", instanceID), body)
	if err != nil {
		return "", "", -1, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return "", "", -1, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
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

// WaitForReady waits for an instance to be ready
func (c *V2Client) WaitForReady(ctx context.Context, instanceID string, timeout time.Duration) (*V2Instance, error) {
	deadline := time.Now().Add(timeout)

	for time.Now().Before(deadline) {
		instance, err := c.GetInstance(ctx, instanceID)
		if err != nil {
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
