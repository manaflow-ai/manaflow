// Package auth provides authentication for the cmux E2B CLI via Stack Auth.
// Credentials are shared with cmux-devbox CLI (same keychain/config).
package auth

import (
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

const (
	KeychainService = "cloudrouter"
	ConfigDirName   = "cloudrouter"
	StackAuthAPIURL = "https://api.stack-auth.com"

	// Dev defaults
	DevProjectID      = "1467bed0-8522-45ee-a8d8-055de324118c"
	DevPublishableKey = "pck_pt4nwry6sdskews2pxk4g2fbe861ak2zvaf3mqendspa0"
	DevCmuxURL        = "http://localhost:9779"
	DevConvexSiteURL  = "https://famous-camel-162.convex.site"
)

// Prod defaults (set via ldflags) - must be var not const for ldflags to work
var (
	ProdProjectID      = ""
	ProdPublishableKey = ""
	ProdCmuxURL        = ""
	ProdConvexSiteURL  = ""
)

// Build-time variables (set via ldflags)
var (
	ProjectID      = ""
	PublishableKey = ""
	CmuxURL        = ""
	ConvexSiteURL  = ""
)

var buildMode = "prod"

func SetBuildMode(mode string) {
	if mode == "dev" || mode == "prod" {
		buildMode = mode
	}
}

func GetBuildMode() string {
	return buildMode
}

// CLI flag overrides
var (
	cliProjectID      string
	cliPublishableKey string
	cliCmuxURL        string
	cliConvexSiteURL  string
)

func SetConfigOverrides(projectID, publishableKey, cmuxURL, convexSiteURL string) {
	cliProjectID = projectID
	cliPublishableKey = publishableKey
	cliCmuxURL = cmuxURL
	cliConvexSiteURL = convexSiteURL
}

func getDefaultsForMode() (projectID, publishableKey, cmuxURL, convexSiteURL string) {
	if buildMode == "dev" {
		return DevProjectID, DevPublishableKey, DevCmuxURL, DevConvexSiteURL
	}
	return ProdProjectID, ProdPublishableKey, ProdCmuxURL, ProdConvexSiteURL
}

type Config struct {
	ProjectID      string
	PublishableKey string
	CmuxURL        string
	ConvexSiteURL  string
	StackAuthURL   string
	IsDev          bool
}

func GetConfig() Config {
	defaultProjectID, defaultPublishableKey, defaultCmuxURL, defaultConvexSiteURL := getDefaultsForMode()

	resolve := func(cliVal, envKey, buildVal, defaultVal string) string {
		if cliVal != "" {
			return cliVal
		}
		if envVal := os.Getenv(envKey); envVal != "" {
			return envVal
		}
		if buildVal != "" {
			return buildVal
		}
		return defaultVal
	}

	projectID := resolve(cliProjectID, "STACK_PROJECT_ID", ProjectID, defaultProjectID)
	publishableKey := resolve(cliPublishableKey, "STACK_PUBLISHABLE_CLIENT_KEY", PublishableKey, defaultPublishableKey)
	cmuxURL := resolve(cliCmuxURL, "CMUX_API_URL", CmuxURL, defaultCmuxURL)
	convexSiteURL := resolve(cliConvexSiteURL, "CONVEX_SITE_URL", ConvexSiteURL, defaultConvexSiteURL)

	stackAuthURL := os.Getenv("AUTH_API_URL")
	if stackAuthURL == "" {
		stackAuthURL = StackAuthAPIURL
	}

	isDev := os.Getenv("CMUX_E2B_DEV") == "1" || os.Getenv("CMUX_E2B_DEV") == "true"

	return Config{
		ProjectID:      projectID,
		PublishableKey: publishableKey,
		CmuxURL:        cmuxURL,
		ConvexSiteURL:  convexSiteURL,
		StackAuthURL:   stackAuthURL,
		IsDev:          isDev,
	}
}

func getConfigDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(home, ".config", ConfigDirName), nil
}

func getCredentialsPath() (string, error) {
	configDir, err := getConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(configDir, "credentials.json"), nil
}

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

type Credentials struct {
	StackRefreshToken string `json:"stack_refresh_token,omitempty"`
}

func StoreRefreshToken(token string) error {
	if runtime.GOOS == "darwin" {
		return storeInKeychain(token)
	}
	return storeInFile(token)
}

func GetRefreshToken() (string, error) {
	if runtime.GOOS == "darwin" {
		return getFromKeychain()
	}
	return getFromFile()
}

func DeleteRefreshToken() error {
	if runtime.GOOS == "darwin" {
		return deleteFromKeychain()
	}
	return deleteFromFile()
}

func storeInKeychain(token string) error {
	cfg := GetConfig()
	account := fmt.Sprintf("STACK_REFRESH_TOKEN_%s", cfg.ProjectID)
	_ = exec.Command("security", "delete-generic-password", "-s", KeychainService, "-a", account).Run()
	cmd := exec.Command("security", "add-generic-password", "-s", KeychainService, "-a", account, "-w", token)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to store token in keychain: %w", err)
	}
	return nil
}

func getFromKeychain() (string, error) {
	cfg := GetConfig()
	account := fmt.Sprintf("STACK_REFRESH_TOKEN_%s", cfg.ProjectID)
	cmd := exec.Command("security", "find-generic-password", "-s", KeychainService, "-a", account, "-w")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("token not found in keychain")
	}
	return strings.TrimSpace(string(output)), nil
}

func deleteFromKeychain() error {
	cfg := GetConfig()
	account := fmt.Sprintf("STACK_REFRESH_TOKEN_%s", cfg.ProjectID)
	_ = exec.Command("security", "delete-generic-password", "-s", KeychainService, "-a", account).Run()
	return nil
}

func storeInFile(token string) error {
	path, err := getCredentialsPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return fmt.Errorf("failed to create config dir: %w", err)
	}
	creds := Credentials{}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &creds)
	}
	creds.StackRefreshToken = token
	data, err := json.MarshalIndent(creds, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal credentials: %w", err)
	}
	return os.WriteFile(path, data, 0600)
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
		return nil
	}
	var creds Credentials
	if err := json.Unmarshal(data, &creds); err != nil {
		return nil
	}
	creds.StackRefreshToken = ""
	newData, _ := json.MarshalIndent(creds, "", "  ")
	return os.WriteFile(path, newData, 0600)
}

type AccessToken struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
}

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
	if cached.ExpiresAt-time.Now().Unix() > minValiditySecs {
		return cached.Token, nil
	}
	return "", fmt.Errorf("cached token expired")
}

func CacheAccessToken(token string, expiresAt int64) error {
	path, err := getAccessTokenCachePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	cached := AccessToken{Token: token, ExpiresAt: expiresAt}
	data, _ := json.Marshal(cached)
	return os.WriteFile(path, data, 0600)
}

func ClearCachedAccessToken() error {
	path, err := getAccessTokenCachePath()
	if err != nil {
		return err
	}
	_ = os.Remove(path)
	return nil
}

func IsLoggedIn() bool {
	_, err := GetRefreshToken()
	return err == nil
}

type CliAuthInitResponse struct {
	PollingCode string `json:"polling_code"`
	LoginCode   string `json:"login_code"`
}

type CliAuthPollResponse struct {
	Status       string `json:"status"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

type RefreshTokenResponse struct {
	AccessToken string `json:"access_token"`
}

func Login() error {
	cfg := GetConfig()
	if IsLoggedIn() {
		fmt.Println("Already logged in. Run 'cloudrouter logout' first to re-authenticate.")
		return nil
	}

	fmt.Println("Starting authentication...")
	client := &http.Client{Timeout: 30 * time.Second}

	initURL := fmt.Sprintf("%s/api/v1/auth/cli", cfg.StackAuthURL)
	initBody := strings.NewReader(`{"expires_in_millis": 600000}`)
	req, _ := http.NewRequest("POST", initURL, initBody)
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
	json.NewDecoder(resp.Body).Decode(&initResp)

	authURL := fmt.Sprintf("%s/handler/cli-auth-confirm?login_code=%s", cfg.CmuxURL, initResp.LoginCode)
	fmt.Println("\nOpening browser to complete authentication...")
	fmt.Printf("If browser doesn't open, visit:\n  %s\n\n", authURL)
	_ = openBrowser(authURL)

	fmt.Println("Waiting for authentication... (press Ctrl+C to cancel)")
	pollURL := fmt.Sprintf("%s/api/v1/auth/cli/poll", cfg.StackAuthURL)

	for attempt := 0; attempt < 120; attempt++ {
		time.Sleep(5 * time.Second)
		pollBody := fmt.Sprintf(`{"polling_code": "%s"}`, initResp.PollingCode)
		req, _ := http.NewRequest("POST", pollURL, strings.NewReader(pollBody))
		req.Header.Set("x-stack-project-id", cfg.ProjectID)
		req.Header.Set("x-stack-publishable-client-key", cfg.PublishableKey)
		req.Header.Set("x-stack-access-type", "client")
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			fmt.Print(".")
			continue
		}

		var pollResp CliAuthPollResponse
		json.NewDecoder(resp.Body).Decode(&pollResp)
		resp.Body.Close()

		if pollResp.Status == "success" && pollResp.RefreshToken != "" {
			if err := StoreRefreshToken(pollResp.RefreshToken); err != nil {
				return fmt.Errorf("failed to store token: %w", err)
			}
			fmt.Println("\n\n✓ Authentication successful!")
			return nil
		} else if pollResp.Status == "expired" {
			return fmt.Errorf("authentication expired. Please try again")
		}
		fmt.Print(".")
	}
	return fmt.Errorf("authentication timed out")
}

func Logout() error {
	_ = DeleteRefreshToken()
	_ = ClearCachedAccessToken()
	fmt.Println("✓ Logged out successfully")
	return nil
}

func GetAccessToken() (string, error) {
	if token, err := GetCachedAccessToken(60); err == nil {
		return token, nil
	}

	refreshToken, err := GetRefreshToken()
	if err != nil {
		return "", fmt.Errorf("not logged in. Run 'cloudrouter login' first")
	}

	cfg := GetConfig()
	client := &http.Client{Timeout: 30 * time.Second}
	refreshURL := fmt.Sprintf("%s/api/v1/auth/sessions/current/refresh", cfg.StackAuthURL)
	req, _ := http.NewRequest("POST", refreshURL, nil)
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
		return "", fmt.Errorf("failed to refresh token: status %d", resp.StatusCode)
	}

	var refreshResp RefreshTokenResponse
	json.NewDecoder(resp.Body).Decode(&refreshResp)
	expiresAt := time.Now().Add(1 * time.Hour).Unix()
	_ = CacheAccessToken(refreshResp.AccessToken, expiresAt)
	return refreshResp.AccessToken, nil
}

type UserProfile struct {
	UserID          string `json:"userId"`
	Email           string `json:"email,omitempty"`
	Name            string `json:"name,omitempty"`
	TeamID          string `json:"teamId,omitempty"`
	TeamSlug        string `json:"teamSlug,omitempty"`
	TeamDisplayName string `json:"teamDisplayName,omitempty"`
}

func FetchUserProfile() (*UserProfile, error) {
	accessToken, err := GetAccessToken()
	if err != nil {
		return nil, err
	}

	cfg := GetConfig()
	client := &http.Client{Timeout: 30 * time.Second}
	profileURL := fmt.Sprintf("%s/api/v2/devbox/me", cfg.ConvexSiteURL)
	req, _ := http.NewRequest("GET", profileURL, nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("failed to fetch profile: %s", string(body))
	}

	var profile UserProfile
	json.NewDecoder(resp.Body).Decode(&profile)
	return &profile, nil
}

func GetTeamSlug() (string, error) {
	profile, err := FetchUserProfile()
	if err != nil {
		return "", err
	}
	if profile.TeamSlug != "" {
		return profile.TeamSlug, nil
	}
	if profile.TeamID != "" {
		return profile.TeamID, nil
	}
	return "", fmt.Errorf("no team found")
}

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
