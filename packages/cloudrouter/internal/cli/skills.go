package cli

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/spf13/cobra"
)

const (
	skillsBaseURL = "https://raw.githubusercontent.com/manaflow-ai/manaflow/main/skills"
)

var skillsCmd = &cobra.Command{
	Use:   "skills",
	Short: "Manage Claude Code skills for cloudrouter",
	Long:  `Manage Claude Code skills that help AI assistants use cloudrouter effectively.`,
}

var skillsUpdateCmd = &cobra.Command{
	Use:   "update",
	Short: "Update cloudrouter skills from remote",
	Long: `Update the cloudrouter SKILL.md file from the official repository.

This downloads the latest skill documentation and installs it to:
  ~/.claude/skills/cloudrouter/SKILL.md

The skill provides Claude Code and other AI assistants with
documentation on how to use cloudrouter commands effectively.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return updateSkills()
	},
}

var skillsInstallCmd = &cobra.Command{
	Use:   "install",
	Short: "Install cloudrouter skills locally",
	Long: `Install the cloudrouter SKILL.md file to the Claude Code skills directory.

This is equivalent to 'skills update' but with a clearer intent for first-time setup.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		return updateSkills()
	},
}

func init() {
	skillsCmd.AddCommand(skillsUpdateCmd)
	skillsCmd.AddCommand(skillsInstallCmd)
}

func getSkillsDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %w", err)
	}
	return filepath.Join(home, ".claude", "skills", "cloudrouter"), nil
}

func updateSkills() error {
	skillsDir, err := getSkillsDir()
	if err != nil {
		return err
	}

	// Create skills directory if it doesn't exist
	if err := os.MkdirAll(skillsDir, 0755); err != nil {
		return fmt.Errorf("failed to create skills directory: %w", err)
	}

	// Download SKILL.md from GitHub
	skillURL := skillsBaseURL + "/cloudrouter/SKILL.md"
	fmt.Printf("Downloading skill from %s...\n", skillURL)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(skillURL)
	if err != nil {
		return fmt.Errorf("failed to download skill: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download skill: HTTP %d", resp.StatusCode)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read skill content: %w", err)
	}

	// Write to local file
	skillPath := filepath.Join(skillsDir, "SKILL.md")
	if err := os.WriteFile(skillPath, content, 0644); err != nil {
		return fmt.Errorf("failed to write skill file: %w", err)
	}

	fmt.Printf("✓ Skill updated: %s\n", skillPath)
	fmt.Println("\nThe cloudrouter skill is now available to Claude Code and other AI assistants.")
	return nil
}

// AutoUpdateSkillsIfNeeded checks if skills should be auto-updated and does so if needed.
// This is called from version check when an update is available.
func AutoUpdateSkillsIfNeeded() error {
	skillsDir, err := getSkillsDir()
	if err != nil {
		return err
	}

	skillPath := filepath.Join(skillsDir, "SKILL.md")

	// Check if skill file exists
	info, err := os.Stat(skillPath)
	if os.IsNotExist(err) {
		// Skills not installed, skip auto-update
		return nil
	}
	if err != nil {
		return err
	}

	// Only auto-update if file is older than 24 hours
	if time.Since(info.ModTime()) < 24*time.Hour {
		return nil
	}

	// Silently update skills
	return updateSkillsSilent()
}

func updateSkillsSilent() error {
	skillsDir, err := getSkillsDir()
	if err != nil {
		return err
	}

	skillURL := skillsBaseURL + "/cloudrouter/SKILL.md"
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(skillURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	content, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}

	skillPath := filepath.Join(skillsDir, "SKILL.md")
	return os.WriteFile(skillPath, content, 0644)
}
