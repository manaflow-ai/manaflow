// Package api provides the sandbox API client (E2B + Modal)
package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/manaflow-ai/cloudrouter/internal/auth"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient() *Client {
	cfg := auth.GetConfig()
	return &Client{
		baseURL:    cfg.ConvexSiteURL,
		httpClient: &http.Client{Timeout: 600 * time.Second},
	}
}

func (c *Client) doRequest(method, path string, body interface{}) ([]byte, error) {
	token, err := auth.GetAccessToken()
	if err != nil {
		return nil, err
	}

	var reqBody io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reqBody = bytes.NewReader(data)
	}

	req, err := http.NewRequest(method, c.baseURL+path, reqBody)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("API error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// Instance represents a sandbox instance
type Instance struct {
	ID         string `json:"id"`
	Name       string `json:"name,omitempty"`
	Status     string `json:"status"`
	Provider   string `json:"provider,omitempty"`
	Template   string `json:"templateId,omitempty"`
	GPU        string `json:"gpu,omitempty"`
	CreatedAt  int64  `json:"createdAt,omitempty"`
	JupyterURL string `json:"jupyterUrl,omitempty"`
	VSCodeURL  string `json:"vscodeUrl,omitempty"`
	VNCURL     string `json:"vncUrl,omitempty"`
	WorkerURL  string `json:"workerUrl,omitempty"`
}

type CreateInstanceRequest struct {
	TeamSlugOrID string            `json:"teamSlugOrId"`
	Provider     string            `json:"provider,omitempty"`
	TemplateID   string            `json:"templateId,omitempty"`
	Name         string            `json:"name,omitempty"`
	GPU          string            `json:"gpu,omitempty"`
	CPU          float64           `json:"cpu,omitempty"`
	MemoryMiB    int               `json:"memoryMiB,omitempty"`
	Image        string            `json:"image,omitempty"`
	TTLSeconds   int               `json:"ttlSeconds,omitempty"`
	Envs         map[string]string `json:"envs,omitempty"`
}

type CreateInstanceResponse struct {
	DevboxID   string `json:"id"`
	Provider   string `json:"provider,omitempty"`
	Status     string `json:"status"`
	Template   string `json:"templateId,omitempty"`
	GPU        string `json:"gpu,omitempty"`
	JupyterURL string `json:"jupyterUrl,omitempty"`
	VSCodeURL  string `json:"vscodeUrl,omitempty"`
	WorkerURL  string `json:"workerUrl,omitempty"`
	VNCURL     string `json:"vncUrl,omitempty"`
}

func (c *Client) CreateInstance(req CreateInstanceRequest) (*CreateInstanceResponse, error) {
	respBody, err := c.doRequest("POST", "/api/v2/devbox/instances", req)
	if err != nil {
		return nil, err
	}

	var resp CreateInstanceResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, fmt.Errorf("failed to parse response: %w (body: %s)", err, string(respBody))
	}

	return &resp, nil
}

type ListInstancesResponse struct {
	Instances []Instance `json:"instances"`
}

func (c *Client) ListInstances(teamSlug, provider string) ([]Instance, error) {
	path := fmt.Sprintf("/api/v2/devbox/instances?teamSlugOrId=%s", teamSlug)
	if provider != "" {
		path += "&provider=" + provider
	}
	respBody, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var resp ListInstancesResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, err
	}
	return resp.Instances, nil
}

func (c *Client) GetInstance(teamSlug, id string) (*Instance, error) {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s?teamSlugOrId=%s", id, teamSlug)
	respBody, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var inst Instance
	if err := json.Unmarshal(respBody, &inst); err != nil {
		return nil, err
	}
	return &inst, nil
}

func (c *Client) StopInstance(teamSlug, id string) error {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s/stop", id)
	_, err := c.doRequest("POST", path, map[string]string{"teamSlugOrId": teamSlug})
	return err
}

// PauseInstance pauses a sandbox (preserves state)
func (c *Client) PauseInstance(teamSlug, id string) error {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s/pause", id)
	_, err := c.doRequest("POST", path, map[string]string{"teamSlugOrId": teamSlug})
	return err
}

// ResumeInstance resumes a paused sandbox
func (c *Client) ResumeInstance(teamSlug, id string) error {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s/resume", id)
	_, err := c.doRequest("POST", path, map[string]string{"teamSlugOrId": teamSlug})
	return err
}

// DeleteInstance terminates a sandbox and removes its record
func (c *Client) DeleteInstance(teamSlug, id string) error {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s/delete", id)
	_, err := c.doRequest("POST", path, map[string]string{"teamSlugOrId": teamSlug})
	return err
}

// ExtendTimeout extends the sandbox timeout
func (c *Client) ExtendTimeout(teamSlug, id string, timeoutMs int) error {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s/extend", id)
	body := map[string]interface{}{
		"teamSlugOrId": teamSlug,
		"timeoutMs":    timeoutMs,
	}
	_, err := c.doRequest("POST", path, body)
	return err
}

type ExecRequest struct {
	TeamSlugOrID string `json:"teamSlugOrId"`
	Command      string `json:"command"`
	Timeout      int    `json:"timeout,omitempty"`
}

type ExecResponse struct {
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	ExitCode int    `json:"exitCode"`
}

func (c *Client) Exec(teamSlug, id, command string, timeout int) (*ExecResponse, error) {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s/exec", id)
	body := ExecRequest{
		TeamSlugOrID: teamSlug,
		Command:      command,
		Timeout:      timeout,
	}

	respBody, err := c.doRequest("POST", path, body)
	if err != nil {
		return nil, err
	}

	var resp ExecResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

type Template struct {
	ID             string `json:"templateId"`
	PresetID       string `json:"presetId,omitempty"`
	Provider       string `json:"provider,omitempty"`
	Name           string `json:"name"`
	Description    string `json:"description,omitempty"`
	CPU            string `json:"cpu,omitempty"`
	Memory         string `json:"memory,omitempty"`
	Disk           string `json:"disk,omitempty"`
	GPU            string `json:"gpu,omitempty"`
	Image          string `json:"image,omitempty"`
	SupportsDocker bool   `json:"supportsDocker,omitempty"`
	Gated          bool   `json:"gated,omitempty"`
}

type ListTemplatesResponse struct {
	Templates []Template `json:"templates"`
}

func (c *Client) ListTemplates(teamSlug, provider string) ([]Template, error) {
	path := fmt.Sprintf("/api/v2/devbox/templates?teamSlugOrId=%s", teamSlug)
	if provider != "" {
		path += "&provider=" + provider
	}
	respBody, err := c.doRequest("GET", path, nil)
	if err != nil {
		return nil, err
	}

	var resp ListTemplatesResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, err
	}
	return resp.Templates, nil
}

type AuthTokenResponse struct {
	Token string `json:"token"`
}

// GetAuthToken fetches the auth token from the sandbox
func (c *Client) GetAuthToken(teamSlug, id string) (string, error) {
	path := fmt.Sprintf("/api/v2/devbox/instances/%s/token", id)
	body := map[string]string{"teamSlugOrId": teamSlug}

	respBody, err := c.doRequest("POST", path, body)
	if err != nil {
		return "", err
	}

	var resp AuthTokenResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return "", err
	}
	return resp.Token, nil
}

// ConfigResponse from GET /api/v2/devbox/config
type ConfigResponse struct {
	Providers       []string       `json:"providers"`
	DefaultProvider string         `json:"defaultProvider"`
	Modal           *ModalConfig   `json:"modal,omitempty"`
}

type ModalConfig struct {
	DefaultTemplateID string   `json:"defaultTemplateId"`
	GPUOptions        []string `json:"gpuOptions"`
}

// GetConfig fetches the devbox configuration (available providers, GPU options, etc.)
func (c *Client) GetConfig() (*ConfigResponse, error) {
	respBody, err := c.doRequest("GET", "/api/v2/devbox/config", nil)
	if err != nil {
		return nil, err
	}

	var resp ConfigResponse
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return nil, err
	}
	return &resp, nil
}

// UploadEnvToWorker sends environment variable content to the worker's /env endpoint.
// Content is base64-encoded for safe transport so secrets are not exposed as plaintext in request bodies.
func UploadEnvToWorker(workerURL, token, envContent string) error {
	encoded := base64.StdEncoding.EncodeToString([]byte(envContent))
	body, err := json.Marshal(map[string]string{
		"content":  encoded,
		"encoding": "base64",
	})
	if err != nil {
		return fmt.Errorf("failed to marshal env content: %w", err)
	}
	_, err = DoWorkerRequest(workerURL, "/env", token, body)
	return err
}

// DownloadEnvFromWorker reads environment variable content from the worker's /env endpoint
func DownloadEnvFromWorker(workerURL, token string) (string, error) {
	respBody, err := DoWorkerGetRequest(workerURL, "/env", token)
	if err != nil {
		return "", err
	}

	var resp struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(respBody, &resp); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}
	return resp.Content, nil
}

// DoWorkerGetRequest makes a GET request to the worker daemon
func DoWorkerGetRequest(workerURL, path, token string) ([]byte, error) {
	client := &http.Client{Timeout: 60 * time.Second}

	req, err := http.NewRequest("GET", workerURL+path, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("worker error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// DoWorkerRequest makes a direct request to the worker daemon
func DoWorkerRequest(workerURL, path, token string, body []byte) ([]byte, error) {
	return DoWorkerRequestWithTimeout(workerURL, path, token, body, 60)
}

// DoWorkerRequestWithTimeout makes a direct request to the worker daemon with custom timeout
func DoWorkerRequestWithTimeout(workerURL, path, token string, body []byte, timeoutSecs int) ([]byte, error) {
	client := &http.Client{Timeout: time.Duration(timeoutSecs) * time.Second}

	req, err := http.NewRequest("POST", workerURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("worker error (%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}
