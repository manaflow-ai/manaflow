// Package version provides version checking functionality for the cmux CLI.
package version

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	npmRegistryURL     = "https://registry.npmjs.org/@manaflow-ai/cloudrouter"
	checkIntervalHours = 6 // Only check every 6 hours
	configDirName      = "cloudrouter"
)

var (
	currentVersion string
)

// SetCurrentVersion sets the current CLI version (called from main)
func SetCurrentVersion(v string) {
	currentVersion = v
}

// GetCurrentVersion returns the current CLI version
func GetCurrentVersion() string {
	return currentVersion
}

// VersionCache stores the cached version check result
type VersionCache struct {
	LatestVersion string `json:"latest_version"`
	CheckedAt     int64  `json:"checked_at"`
}

func getCachePath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".config", configDirName, "version_cache.json"), nil
}

func loadCache() (*VersionCache, error) {
	path, err := getCachePath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cache VersionCache
	if err := json.Unmarshal(data, &cache); err != nil {
		return nil, err
	}
	return &cache, nil
}

func saveCache(cache *VersionCache) error {
	path, err := getCachePath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.Marshal(cache)
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// NPMPackageInfo represents the npm registry response
type NPMPackageInfo struct {
	DistTags struct {
		Latest string `json:"latest"`
	} `json:"dist-tags"`
}

// fetchLatestVersion fetches the latest version from npm registry
func fetchLatestVersion() (string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(npmRegistryURL)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("npm registry returned status %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var info NPMPackageInfo
	if err := json.Unmarshal(body, &info); err != nil {
		return "", err
	}

	return info.DistTags.Latest, nil
}

// CheckResult contains the result of a version check
type CheckResult struct {
	CurrentVersion string
	LatestVersion  string
	IsOutdated     bool
	Error          error
}

// CheckForUpdates checks if there's a newer version available.
// It uses a cache to avoid checking too frequently.
func CheckForUpdates() *CheckResult {
	result := &CheckResult{
		CurrentVersion: currentVersion,
	}

	// Skip check for dev builds
	if currentVersion == "" || currentVersion == "dev" {
		return result
	}

	// Check cache first
	cache, err := loadCache()
	if err == nil && cache != nil {
		// Use cached result if checked recently
		if time.Now().Unix()-cache.CheckedAt < checkIntervalHours*3600 {
			result.LatestVersion = cache.LatestVersion
			result.IsOutdated = isNewer(cache.LatestVersion, currentVersion)
			return result
		}
	}

	// Fetch latest version from npm (non-blocking, with short timeout)
	latestVersion, err := fetchLatestVersion()
	if err != nil {
		result.Error = err
		return result
	}

	// Save to cache
	_ = saveCache(&VersionCache{
		LatestVersion: latestVersion,
		CheckedAt:     time.Now().Unix(),
	})

	result.LatestVersion = latestVersion
	result.IsOutdated = isNewer(latestVersion, currentVersion)
	return result
}

// isNewer returns true if latest is newer than current
// Supports semver-like versions (e.g., "0.7.6" vs "0.7.5")
func isNewer(latest, current string) bool {
	// Clean up versions (remove 'v' prefix if present)
	latest = strings.TrimPrefix(latest, "v")
	current = strings.TrimPrefix(current, "v")

	latestParts := strings.Split(latest, ".")
	currentParts := strings.Split(current, ".")

	for i := 0; i < len(latestParts) && i < len(currentParts); i++ {
		// Parse as integers for comparison
		var latestNum, currentNum int
		fmt.Sscanf(latestParts[i], "%d", &latestNum)
		fmt.Sscanf(currentParts[i], "%d", &currentNum)

		if latestNum > currentNum {
			return true
		}
		if latestNum < currentNum {
			return false
		}
	}

	// If all compared parts are equal, newer if latest has more parts
	return len(latestParts) > len(currentParts)
}

// PrintUpdateWarning prints a warning message if an update is available.
// Returns true if an update is available.
func PrintUpdateWarning(result *CheckResult) bool {
	if result == nil || !result.IsOutdated {
		return false
	}

	fmt.Fprintf(os.Stderr, "\n")
	fmt.Fprintf(os.Stderr, "╭─────────────────────────────────────────────────────────────╮\n")
	fmt.Fprintf(os.Stderr, "│  A new version of cloudrouter is available: %s → %s    │\n",
		padVersion(result.CurrentVersion), padVersion(result.LatestVersion))
	fmt.Fprintf(os.Stderr, "│                                                             │\n")
	fmt.Fprintf(os.Stderr, "│  To update: npm i -g @manaflow-ai/cloudrouter               │\n")
	fmt.Fprintf(os.Stderr, "╰─────────────────────────────────────────────────────────────╯\n")
	fmt.Fprintf(os.Stderr, "\n")

	return true
}

// padVersion pads a version string to a fixed width for alignment
func padVersion(v string) string {
	const width = 7
	if len(v) >= width {
		return v[:width]
	}
	return v + strings.Repeat(" ", width-len(v))
}

// IsLongRunningCommand returns true if the command is considered long-running
// and should trigger a version check.
func IsLongRunningCommand(cmdName string) bool {
	longRunningCmds := map[string]bool{
		"pty":   true,
		"sync":  true,
		"start": true,
	}
	return longRunningCmds[cmdName]
}
