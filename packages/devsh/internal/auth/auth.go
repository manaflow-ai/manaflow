// Package auth provides authentication for the devsh CLI via Stack Auth.
// Credentials are stored in a location compatible with the cmux Rust CLI,
// allowing users to log in once and use both tools.
package auth

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// envLoaded tracks whether we've already loaded .env file
var envLoaded bool

// LoadEnvFile loads environment variables from a .env file if it exists.
// Only loads once per process. Walks up from current directory to find .env file.
// Variables already set in the environment are not overwritten.
// Call this early in main() for dev builds so all packages can read .env values.
func LoadEnvFile() {
	if envLoaded {
		return
	}
	envLoaded = true

	// Find .env file by walking up directories
	dir, err := os.Getwd()
	if err != nil {
		return
	}

	var envPath string
	for {
		candidate := filepath.Join(dir, ".env")
		if _, err := os.Stat(candidate); err == nil {
			envPath = candidate
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	if envPath == "" {
		return
	}

	file, err := os.Open(envPath)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		// Skip empty lines and comments
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Parse KEY=value
		idx := strings.Index(line, "=")
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		value := strings.TrimSpace(line[idx+1:])
		// Remove surrounding quotes if present
		if len(value) >= 2 {
			if (value[0] == '"' && value[len(value)-1] == '"') ||
				(value[0] == '\'' && value[len(value)-1] == '\'') {
				value = value[1 : len(value)-1]
			}
		}
		// Only set if not already set in environment
		if os.Getenv(key) == "" {
			os.Setenv(key, value)
		}
	}
}

// Shared constants - must match cmux Rust CLI for credential sharing
const (
	KeychainService = "cmux"
	ConfigDirName   = "cmux"

	// Stack Auth API
	StackAuthAPIURL = "https://api.stack-auth.com"

	// ==========================================================================
	// Production defaults - intentionally empty
	// Production values MUST be injected at build time via -ldflags
	// This prevents accidental hardcoding of production credentials in source
	// ==========================================================================
	ProdProjectID      = ""
	ProdPublishableKey = ""
	ProdCmuxURL        = ""
	ProdConvexSiteURL  = ""

	// ==========================================================================
	// Development defaults - used when Mode="dev" and no other values provided
	// These point to local development servers for convenience
	// ==========================================================================
	DevProjectID      = "1467bed0-8522-45ee-a8d8-055de324118c"         // Dev Stack Auth project
	DevPublishableKey = "pck_pt4nwry6sdskews2pxk4g2fbe861ak2zvaf3mqendspa0" // Dev publishable key
	DevCmuxURL        = "http://localhost:9779"                         // Local dev server
	DevConvexSiteURL  = "https://famous-camel-162.convex.site"          // Dev Convex deployment
	DevServerURL      = "http://localhost:9776"                         // Local apps/server socket.io & HTTP API
)

// Build-time configuration variables
// Set via ldflags, e.g.: -ldflags "-X 'github.com/karlorz/devsh/internal/auth.ProjectID=...'"
var (
	ProjectID      = "" // Stack Auth project ID
	PublishableKey = "" // Stack Auth publishable client key
	CmuxURL        = "" // cmux web app URL (e.g., https://cmux-www.karldigi.dev)
	ConvexSiteURL  = "" // Convex HTTP site URL
	ServerURL      = "" // apps/server HTTP API URL
)

// buildMode determines which defaults to use ("dev" or "prod")
// Set via SetBuildMode() from main.go based on Mode ldflags value
var buildMode = "prod" // Default to prod for safety

// SetBuildMode sets the build mode which determines default values.
// Should be called from main() before any auth operations.
func SetBuildMode(mode string) {
	if mode == "dev" || mode == "prod" {
		buildMode = mode
	}
}

// GetBuildMode returns the current build mode
func GetBuildMode() string {
	return buildMode
}

// CLI flag overrides (highest priority)
// Set via SetConfigOverrides() from CLI flags
var (
	cliProjectID      string
	cliPublishableKey string
	cliCmuxURL        string
	cliConvexSiteURL  string
	cliServerURL      string
)

// SetConfigOverrides sets CLI flag overrides for configuration values.
// These take highest priority over env vars and build-time values.
// Pass empty string for any value you don't want to override.
func SetConfigOverrides(projectID, publishableKey, cmuxURL, convexSiteURL string) {
	cliProjectID = projectID
	cliPublishableKey = publishableKey
	cliCmuxURL = cmuxURL
	cliConvexSiteURL = convexSiteURL
}

// SetServerURLOverride sets the CLI flag override for server URL.
// Kept separate from SetConfigOverrides for backward compatibility.
func SetServerURLOverride(serverURL string) {
	cliServerURL = serverURL
}

// getDefaultsForMode returns the appropriate default values based on build mode
func getDefaultsForMode() (projectID, publishableKey, cmuxURL, convexSiteURL, serverURL string) {
	if buildMode == "dev" {
		return DevProjectID, DevPublishableKey, DevCmuxURL, DevConvexSiteURL, DevServerURL
	}
	// Production server URL - empty means must be set via ldflags or env
	return ProdProjectID, ProdPublishableKey, ProdCmuxURL, ProdConvexSiteURL, ""
}

// Config holds auth configuration
type Config struct {
	ProjectID      string
	PublishableKey string
	CmuxURL        string
	ConvexSiteURL  string
	ServerURL      string // apps/server HTTP API URL for agent spawning
	StackAuthURL   string
	IsDev          bool
}

// Validate checks if the config has all required values.
// Returns an error if any required value is missing.
func (c Config) Validate() error {
	var missing []string
	if c.ProjectID == "" {
		missing = append(missing, "STACK_PROJECT_ID")
	}
	if c.PublishableKey == "" {
		missing = append(missing, "STACK_PUBLISHABLE_CLIENT_KEY")
	}
	if c.CmuxURL == "" {
		missing = append(missing, "CMUX_API_URL")
	}
	if c.ConvexSiteURL == "" {
		missing = append(missing, "CONVEX_SITE_URL")
	}
	// ServerURL is optional - only required for agent spawning via CLI
	// If not set, CLI task create will fail with a clear error message
	if len(missing) > 0 {
		return fmt.Errorf("missing required configuration: %v. For production builds, these must be set via -ldflags or environment variables", missing)
	}
	return nil
}

// GetConfig returns auth configuration using the following priority (highest to lowest):
// 1. CLI flags (set via SetConfigOverrides)
// 2. Environment variables (including .env file loaded in dev mode)
// 3. Build-time values (set via -ldflags)
// 4. Mode-specific defaults (dev defaults for Mode=dev, prod defaults for Mode=prod)
func GetConfig() Config {
	// In dev mode, load .env file to populate environment variables
	if buildMode == "dev" {
		LoadEnvFile()
	}

	// Get mode-specific defaults
	defaultProjectID, defaultPublishableKey, defaultCmuxURL, defaultConvexSiteURL, defaultServerURL := getDefaultsForMode()

	// Helper to resolve value with priority: CLI > env > build-time > default
	// Supports multiple env key names (first match wins)
	resolve := func(cliVal string, envKeys []string, buildVal, defaultVal string) string {
		if cliVal != "" {
			return cliVal
		}
		for _, envKey := range envKeys {
			if envVal := os.Getenv(envKey); envVal != "" {
				return envVal
			}
		}
		if buildVal != "" {
			return buildVal
		}
		return defaultVal
	}

	// Support both STACK_* and NEXT_PUBLIC_STACK_* env var names
	projectID := resolve(cliProjectID, []string{"STACK_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID"}, ProjectID, defaultProjectID)
	publishableKey := resolve(cliPublishableKey, []string{"STACK_PUBLISHABLE_CLIENT_KEY", "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"}, PublishableKey, defaultPublishableKey)
	cmuxURL := resolve(cliCmuxURL, []string{"CMUX_API_URL"}, CmuxURL, defaultCmuxURL)
	convexSiteURL := resolve(cliConvexSiteURL, []string{"CONVEX_SITE_URL"}, ConvexSiteURL, defaultConvexSiteURL)
	serverURL := resolve(cliServerURL, []string{"CMUX_SERVER_URL"}, ServerURL, defaultServerURL)

	// Stack Auth URL only has env override and hardcoded default
	stackAuthURL := os.Getenv("AUTH_API_URL")
	if stackAuthURL == "" {
		stackAuthURL = StackAuthAPIURL
	}

	// Determine dev mode using same logic as cli.IsDev():
	// DEVSH_DEV/DEVSH_PROD take precedence, then legacy CMUX_DEVBOX_DEV/CMUX_DEVBOX_PROD, then build mode
	isDev := buildMode == "dev"
	if env := os.Getenv("DEVSH_DEV"); env == "1" || env == "true" {
		isDev = true
	} else if env := os.Getenv("DEVSH_PROD"); env == "1" || env == "true" {
		isDev = false
	} else if env := os.Getenv("CMUX_DEVBOX_DEV"); env == "1" || env == "true" {
		isDev = true
	} else if env := os.Getenv("CMUX_DEVBOX_PROD"); env == "1" || env == "true" {
		isDev = false
	}

	return Config{
		ProjectID:      projectID,
		PublishableKey: publishableKey,
		CmuxURL:        cmuxURL,
		ConvexSiteURL:  convexSiteURL,
		ServerURL:      serverURL,
		StackAuthURL:   stackAuthURL,
		IsDev:          isDev,
	}
}

// getConfigDir returns the config directory path
func getConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(home, ".config", ConfigDirName), nil
}

// getCredentialsPath returns the path to the credentials file
func getCredentialsPath() (string, error) {
	configDir, err := getConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "credentials.json"), nil
}

// getAccessTokenCachePath returns the path to the access token cache file
func getAccessTokenCachePath() (string, error) {
	configDir, err := getConfigDir()
	if err != nil {
		return "", err
	}

	cfg := GetConfig()
	filename := "access_token_cache_prod.json"
	if cfg.IsDev {
		filename = "access_token_cache_dev.json"
	}

	return filepath.Join(configDir, filename), nil
}

// Credentials holds stored auth tokens
type Credentials struct {
	StackRefreshToken string `json:"stack_refresh_token,omitempty"`
	MorphAPIKey       string `json:"morph_api_key,omitempty"`
}

// StoreRefreshToken stores the Stack Auth refresh token
func StoreRefreshToken(token string) error {
	if runtime.GOOS == "darwin" {
		return storeInKeychain(token)
	}
	return storeInFile(token)
}

// GetRefreshToken retrieves the Stack Auth refresh token.
// In dev mode, it first checks for DEVSH_REFRESH_TOKEN environment variable
// to allow bypassing the browser-based auth flow.
func GetRefreshToken() (string, error) {
	// Dev mode bypass: check environment variable first
	// Support both new (DEVSH_) and legacy (DEVBOX_) env var names
	if devToken := os.Getenv("DEVSH_REFRESH_TOKEN"); devToken != "" {
		return devToken, nil
	}
	if devToken := os.Getenv("DEVBOX_REFRESH_TOKEN"); devToken != "" {
		return devToken, nil
	}

	if runtime.GOOS == "darwin" {
		return getFromKeychain()
	}
	return getFromFile()
}

// DeleteRefreshToken removes the stored refresh token
func DeleteRefreshToken() error {
	if runtime.GOOS == "darwin" {
		return deleteFromKeychain()
	}
	return deleteFromFile()
}

// macOS Keychain operations
func storeInKeychain(token string) error {
	cfg := GetConfig()
	account := fmt.Sprintf("STACK_REFRESH_TOKEN_%s", cfg.ProjectID)

	// Delete existing entry (ignore errors)
	_ = exec.Command("security", "delete-generic-password",
		"-s", KeychainService,
		"-a", account,
	).Run()

	// Add new entry
	// Note: We use -T "" to allow only this app to access the item (not -A which allows any app)
	// However, the user will be prompted once to allow access. For CLI tools this is acceptable.
	cmd := exec.Command("security", "add-generic-password",
		"-s", KeychainService,
		"-a", account,
		"-w", token,
	)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to store token in keychain: %w", err)
	}
	return nil
}

func getFromKeychain() (string, error) {
	cfg := GetConfig()
	account := fmt.Sprintf("STACK_REFRESH_TOKEN_%s", cfg.ProjectID)

	cmd := exec.Command("security", "find-generic-password",
		"-s", KeychainService,
		"-a", account,
		"-w",
	)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("token not found in keychain")
	}
	return strings.TrimSpace(string(output)), nil
}

func deleteFromKeychain() error {
	cfg := GetConfig()
	account := fmt.Sprintf("STACK_REFRESH_TOKEN_%s", cfg.ProjectID)

	cmd := exec.Command("security", "delete-generic-password",
		"-s", KeychainService,
		"-a", account,
	)
	_ = cmd.Run() // Ignore errors (may not exist)
	return nil
}

// File-based storage for Linux
func storeInFile(token string) error {
	path, err := getCredentialsPath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}

	// Read existing credentials
	creds := Credentials{}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &creds)
	}

	creds.StackRefreshToken = token

	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal credentials: %w", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("failed to write credentials: %w", err)
	}

	return nil
}

func getFromFile() (string, error) {
	path, err := getCredentialsPath()
	if err != nil {
		return "", err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("credentials file not found")
	}

	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return "", fmt.Errorf("failed to parse credentials: %w", err)
	}

	if creds.StackRefreshToken == "" {
		return "", fmt.Errorf("no refresh token stored")
	}

	return creds.StackRefreshToken, nil
}

func deleteFromFile() error {
	path, err := getCredentialsPath()
	if err != nil {
		return err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil // File doesn't exist, nothing to delete
	}

	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil
	}

	creds.StackRefreshToken = ""

	newData, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, newData, 0600)
}

// AccessToken represents a cached access token
type AccessToken struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
}

// GetCachedAccessToken returns a valid cached access token if available
func GetCachedAccessToken(minValiditySecs int64) (string, error) {
	path, err := getAccessTokenCachePath()
	if err != nil {
		return "", err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("no cached access token")
	}

	var cached AccessToken
	if err := json.Unmarshal(data, &cached); err != nil {
		return "", fmt.Errorf("failed to parse cached token: %w", err)
	}

	now := time.Now().Unix()
	if cached.ExpiresAt-now > minValiditySecs {
		return cached.Token, nil
	}

	return "", fmt.Errorf("cached token expired")
}

// CacheAccessToken stores an access token with its expiry
func CacheAccessToken(token string, expiresAt int64) error {
	path, err := getAccessTokenCachePath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	cached := AccessToken{
		Token:     token,
		ExpiresAt: expiresAt,
	}

	data, err := json.Marshal(cached)
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

// ClearCachedAccessToken removes the cached access token
func ClearCachedAccessToken() error {
	path, err := getAccessTokenCachePath()
	if err != nil {
		return err
	}
	_ = os.Remove(path)
	return nil
}

// IsLoggedIn checks if the user has stored credentials
func IsLoggedIn() bool {
	_, err := GetRefreshToken()
	return err == nil
}

// CliAuthInitResponse is the response from /api/v1/auth/cli
type CliAuthInitResponse struct {
	PollingCode string `json:"polling_code"`
	LoginCode   string `json:"login_code"`
}

// CliAuthPollResponse is the response from /api/v1/auth/cli/poll
type CliAuthPollResponse struct {
	Status       string `json:"status"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

// RefreshTokenResponse is the response from the refresh token endpoint
type RefreshTokenResponse struct {
	AccessToken string `json:"access_token"`
}

// UserInfo holds basic user information
type UserInfo struct {
	ID           string `json:"id"`
	PrimaryEmail string `json:"primary_email,omitempty"`
	DisplayName  string `json:"display_name,omitempty"`
}

// Login performs the browser-based Stack Auth login flow
func Login() error {
	cfg := GetConfig()

	// Check if already logged in
	if IsLoggedIn() {
		fmt.Println("Already logged in. Run 'devsh auth logout' first to re-authenticate.")
		return nil
	}

	fmt.Println("Starting authentication...")

	client := &http.Client{Timeout: 30 * time.Second}

	// Step 1: Initiate CLI auth flow
	initURL := fmt.Sprintf("%s/api/v1/auth/cli", cfg.StackAuthURL)
	initBody := strings.NewReader(`{"expires_in_millis": 600000}`)

	req, err := http.NewRequest("POST", initURL, initBody)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	req.Header.Set("x-stack-project-id", cfg.ProjectID)
	req.Header.Set("x-stack-publishable-client-key", cfg.PublishableKey)
	req.Header.Set("x-stack-access-type", "client")
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to initiate auth: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to initiate auth: status %d", resp.StatusCode)
	}

	var initResp CliAuthInitResponse
	if err := json.NewDecoder(resp.Body).Decode(&initResp); err != nil {
		return fmt.Errorf("failed to decode init response: %w", err)
	}

	// Step 2: Open browser
	authURL := fmt.Sprintf("%s/handler/cli-auth-confirm?login_code=%s",
		cfg.CmuxURL, initResp.LoginCode)

	fmt.Println("\nOpening browser to complete authentication...")
	fmt.Printf("If browser doesn't open, visit:\n  %s\n\n", authURL)

	if err := openBrowser(authURL); err != nil {
		fmt.Printf("Failed to open browser: %v\n", err)
		fmt.Println("Please open the URL manually.")
	}

	// Step 3: Poll for completion
	fmt.Println("Waiting for authentication... (press Ctrl+C to cancel)")

	pollURL := fmt.Sprintf("%s/api/v1/auth/cli/poll", cfg.StackAuthURL)
	maxAttempts := 120 // 10 minutes at 5 second intervals

	for attempt := 0; attempt < maxAttempts; attempt++ {
		time.Sleep(5 * time.Second)

		pollBody := fmt.Sprintf(`{"polling_code": "%s"}`, initResp.PollingCode)
		req, err := http.NewRequest("POST", pollURL, strings.NewReader(pollBody))
		if err != nil {
			continue
		}

		req.Header.Set("x-stack-project-id", cfg.ProjectID)
		req.Header.Set("x-stack-publishable-client-key", cfg.PublishableKey)
		req.Header.Set("x-stack-access-type", "client")
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			fmt.Print(".")
			continue
		}

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
			resp.Body.Close()
			fmt.Print(".")
			continue
		}

		var pollResp CliAuthPollResponse
		if err := json.NewDecoder(resp.Body).Decode(&pollResp); err != nil {
			resp.Body.Close()
			continue
		}
		resp.Body.Close()

		switch pollResp.Status {
		case "success":
			if pollResp.RefreshToken == "" {
				return fmt.Errorf("authentication succeeded but no refresh token returned")
			}

			// Store the refresh token
			if err := StoreRefreshToken(pollResp.RefreshToken); err != nil {
				return fmt.Errorf("failed to store token: %w", err)
			}

			fmt.Println("\n\n✓ Authentication successful!")
			fmt.Println("  Refresh token stored securely.")

			// Fetch and cache user profile (includes team info)
			if profile, err := FetchUserProfile(); err == nil {
				if profile.Email != "" {
					fmt.Printf("  Logged in as: %s\n", profile.Email)
				} else if profile.Name != "" {
					fmt.Printf("  Logged in as: %s\n", profile.Name)
				}
				if profile.TeamDisplayName != "" {
					fmt.Printf("  Team: %s\n", profile.TeamDisplayName)
				} else if profile.TeamSlug != "" {
					fmt.Printf("  Team: %s\n", profile.TeamSlug)
				}
			} else {
				// Fallback to basic user info from Stack Auth
				if userInfo, err := GetUserInfo(); err == nil {
					if userInfo.PrimaryEmail != "" {
						fmt.Printf("  Logged in as: %s\n", userInfo.PrimaryEmail)
					} else if userInfo.DisplayName != "" {
						fmt.Printf("  Logged in as: %s\n", userInfo.DisplayName)
					}
				}
			}

			return nil

		case "expired":
			return fmt.Errorf("authentication expired. Please try again")

		default:
			fmt.Print(".")
		}
	}

	return fmt.Errorf("authentication timed out")
}

// Logout clears stored credentials
func Logout() error {
	if err := DeleteRefreshToken(); err != nil {
		return err
	}
	if err := ClearCachedAccessToken(); err != nil {
		return err
	}
	if err := ClearCachedUserProfile(); err != nil {
		return err
	}
	fmt.Println("✓ Logged out successfully")
	return nil
}

// GetAccessToken returns a valid access token, refreshing if necessary
func GetAccessToken() (string, error) {
	// Try cached token first (with 60 second buffer)
	if token, err := GetCachedAccessToken(60); err == nil {
		return token, nil
	}

	// Need to refresh
	refreshToken, err := GetRefreshToken()
	if err != nil {
		return "", fmt.Errorf("not logged in. Run 'devsh auth login' first")
	}

	cfg := GetConfig()
	client := &http.Client{Timeout: 30 * time.Second}

	// Refresh the token
	refreshURL := fmt.Sprintf("%s/api/v1/auth/sessions/current/refresh", cfg.StackAuthURL)
	req, err := http.NewRequest("POST", refreshURL, nil)
	if err != nil {
		return "", err
	}

	req.Header.Set("x-stack-project-id", cfg.ProjectID)
	req.Header.Set("x-stack-publishable-client-key", cfg.PublishableKey)
	req.Header.Set("x-stack-access-type", "client")
	req.Header.Set("x-stack-refresh-token", refreshToken)

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("failed to refresh token: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to refresh token: status %d. Try 'devsh auth login' to re-authenticate", resp.StatusCode)
	}

	var refreshResp RefreshTokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&refreshResp); err != nil {
		return "", fmt.Errorf("failed to decode refresh response: %w", err)
	}

	// Parse JWT to get expiry (simple extraction, no verification needed)
	expiresAt := time.Now().Add(1 * time.Hour).Unix() // Default 1 hour
	if parts := strings.Split(refreshResp.AccessToken, "."); len(parts) == 3 {
		// Try to parse payload for actual expiry
		// This is best-effort; we'll use default if it fails
	}

	// Cache the new access token
	_ = CacheAccessToken(refreshResp.AccessToken, expiresAt)

	return refreshResp.AccessToken, nil
}

// GetUserInfo retrieves the current user's information
func GetUserInfo() (*UserInfo, error) {
	accessToken, err := GetAccessToken()
	if err != nil {
		return nil, err
	}

	cfg := GetConfig()
	client := &http.Client{Timeout: 30 * time.Second}

	userURL := fmt.Sprintf("%s/api/v1/users/me", cfg.StackAuthURL)
	req, err := http.NewRequest("GET", userURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("x-stack-project-id", cfg.ProjectID)
	req.Header.Set("x-stack-publishable-client-key", cfg.PublishableKey)
	req.Header.Set("x-stack-access-type", "client")
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to get user info: status %d", resp.StatusCode)
	}

	var userInfo UserInfo
	if err := json.NewDecoder(resp.Body).Decode(&userInfo); err != nil {
		return nil, err
	}

	return &userInfo, nil
}

// openBrowser opens the given URL in the default browser
func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "linux":
		cmd = exec.Command("xdg-open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default:
		return fmt.Errorf("unsupported platform")
	}
	return cmd.Start()
}

// Note: Morph API key is now managed server-side via Convex.
// The cmux CLI no longer needs to fetch or cache the API key locally.
// All Morph operations are proxied through Convex HTTP endpoints.

// UserProfile holds cached user profile information including team
type UserProfile struct {
	UserID          string `json:"userId"`
	Email           string `json:"email,omitempty"`
	Name            string `json:"name,omitempty"`
	TeamID          string `json:"teamId,omitempty"`
	TeamSlug        string `json:"teamSlug,omitempty"`
	TeamDisplayName string `json:"teamDisplayName,omitempty"`
	FetchedAt       int64  `json:"fetchedAt"`
}

// getUserProfileCachePath returns the path to the user profile cache file
func getUserProfileCachePath() (string, error) {
	configDir, err := getConfigDir()
	if err != nil {
		return "", err
	}

	cfg := GetConfig()
	filename := "user_profile_prod.json"
	if cfg.IsDev {
		filename = "user_profile_dev.json"
	}

	return filepath.Join(configDir, filename), nil
}

// GetCachedUserProfile returns the cached user profile if valid
func GetCachedUserProfile() (*UserProfile, error) {
	path, err := getUserProfileCachePath()
	if err != nil {
		return nil, err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("no cached user profile")
	}

	var profile UserProfile
	if err := json.Unmarshal(data, &profile); err != nil {
		return nil, fmt.Errorf("failed to parse cached profile: %w", err)
	}

	// Cache is valid for 24 hours
	if time.Now().Unix()-profile.FetchedAt > 24*60*60 {
		return nil, fmt.Errorf("cached profile expired")
	}

	return &profile, nil
}

// CacheUserProfile stores the user profile locally
func CacheUserProfile(profile *UserProfile) error {
	path, err := getUserProfileCachePath()
	if err != nil {
		return err
	}

	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}

	profile.FetchedAt = time.Now().Unix()

	data, err := json.MarshalIndent(profile, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0600)
}

// ClearCachedUserProfile removes the cached user profile
func ClearCachedUserProfile() error {
	path, err := getUserProfileCachePath()
	if err != nil {
		return err
	}
	_ = os.Remove(path)
	return nil
}

// ClearUserProfileCache is an alias for ClearCachedUserProfile
func ClearUserProfileCache() error {
	return ClearCachedUserProfile()
}

// FetchUserProfile fetches the user profile from the server and caches it
func FetchUserProfile() (*UserProfile, error) {
	accessToken, err := GetAccessToken()
	if err != nil {
		return nil, fmt.Errorf("not logged in: %w", err)
	}

	cfg := GetConfig()
	client := &http.Client{Timeout: 30 * time.Second}

	profileURL := fmt.Sprintf("%s/api/v1/cmux/me", cfg.ConvexSiteURL)
	req, err := http.NewRequest("GET", profileURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch profile: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to fetch profile: status %d: %s", resp.StatusCode, string(body))
	}

	var profile UserProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		return nil, fmt.Errorf("failed to decode profile: %w", err)
	}

	// Cache the profile
	if err := CacheUserProfile(&profile); err != nil {
		// Log but don't fail if caching fails
		fmt.Fprintf(os.Stderr, "Warning: failed to cache user profile: %v\n", err)
	}

	return &profile, nil
}

// GetUserProfile returns the user profile, using cache if available
func GetUserProfile() (*UserProfile, error) {
	// Try cache first
	if profile, err := GetCachedUserProfile(); err == nil {
		return profile, nil
	}

	// Fetch from server
	return FetchUserProfile()
}

// GetTeamSlug returns the team slug for API calls.
// Priority: DEVSH_TEAM env var > user profile team slug > team ID
func GetTeamSlug() (string, error) {
	// Check for team override from environment (dev mode / CI)
	// Support both new (DEVSH_) and legacy (DEVBOX_) env var names
	if teamOverride := os.Getenv("DEVSH_TEAM"); teamOverride != "" {
		return teamOverride, nil
	}
	if teamOverride := os.Getenv("DEVBOX_TEAM"); teamOverride != "" {
		return teamOverride, nil
	}

	profile, err := GetUserProfile()
	if err != nil {
		return "", err
	}

	if profile.TeamSlug != "" {
		return profile.TeamSlug, nil
	}
	if profile.TeamID != "" {
		return profile.TeamID, nil
	}

	return "", fmt.Errorf("no team found for user. Please select a team at %s", GetConfig().CmuxURL)
}
