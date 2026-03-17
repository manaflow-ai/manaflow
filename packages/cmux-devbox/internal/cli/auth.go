// internal/cli/auth.go
package cli

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"

	"github.com/cmux-cli/cmux-devbox/internal/auth"
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Manage authentication",
	Long:  `Login, logout, and check authentication status.`,
}

var authLoginCmd = &cobra.Command{
	Use:   "login",
	Short: "Login via browser",
	Long: `Authenticate with cmux via your browser.

This opens your default browser to complete the authentication flow.
Once authenticated, your credentials are stored securely and shared
with the cmux CLI.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := auth.Login(); err != nil {
			return err
		}

		if flagJSON {
			output := map[string]interface{}{
				"success": true,
				"message": "Authentication successful",
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		}

		return nil
	},
}

var authLogoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Logout and clear credentials",
	Long:  `Remove stored authentication credentials.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if err := auth.Logout(); err != nil {
			return err
		}

		if flagJSON {
			output := map[string]interface{}{
				"success": true,
				"message": "Logged out successfully",
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		}

		return nil
	},
}

var authStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Show authentication status",
	Long:  `Check if you are logged in and show user information.`,
	RunE: func(cmd *cobra.Command, args []string) error {
		if !auth.IsLoggedIn() {
			if flagJSON {
				output := map[string]interface{}{
					"logged_in": false,
				}
				data, _ := json.MarshalIndent(output, "", "  ")
				fmt.Println(string(data))
			} else {
				fmt.Println("Not logged in. Run 'cmux auth login' to authenticate.")
			}
			return nil
		}

		// Try to get user profile (includes team info)
		profile, err := auth.GetUserProfile()
		if err != nil {
			if flagJSON {
				output := map[string]interface{}{
					"logged_in": true,
					"error":     err.Error(),
				}
				data, _ := json.MarshalIndent(output, "", "  ")
				fmt.Println(string(data))
			} else {
				fmt.Printf("Logged in (unable to fetch user info: %v)\n", err)
			}
			return nil
		}

		if flagJSON {
			output := map[string]interface{}{
				"logged_in": true,
				"user": map[string]interface{}{
					"id":    profile.UserID,
					"email": profile.Email,
					"name":  profile.Name,
				},
				"team": map[string]interface{}{
					"id":           profile.TeamID,
					"slug":         profile.TeamSlug,
					"display_name": profile.TeamDisplayName,
				},
			}
			data, _ := json.MarshalIndent(output, "", "  ")
			fmt.Println(string(data))
		} else {
			fmt.Println("✓ Logged in")
			if profile.Email != "" {
				fmt.Printf("  Email: %s\n", profile.Email)
			}
			if profile.Name != "" {
				fmt.Printf("  Name: %s\n", profile.Name)
			}
			if profile.TeamDisplayName != "" {
				fmt.Printf("  Team: %s\n", profile.TeamDisplayName)
			} else if profile.TeamSlug != "" {
				fmt.Printf("  Team: %s\n", profile.TeamSlug)
			}
		}

		return nil
	},
}

var authWhoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show current user",
	Long:  `Display the currently authenticated user.`,
	RunE:  authStatusCmd.RunE, // Alias for status
}

// Root-level shorthand commands (aliases for auth subcommands)
var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Login via browser (shorthand for 'cmux auth login')",
	Long: `Authenticate with cmux via your browser.

This opens your default browser to complete the authentication flow.
Once authenticated, your credentials are stored securely and shared
with the cmux CLI.

This is a shorthand for 'cmux auth login'.`,
	RunE: authLoginCmd.RunE,
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Logout and clear credentials (shorthand for 'cmux auth logout')",
	Long: `Remove stored authentication credentials.

This is a shorthand for 'cmux auth logout'.`,
	RunE: authLogoutCmd.RunE,
}

var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show current user (shorthand for 'cmux auth whoami')",
	Long: `Display the currently authenticated user.

This is a shorthand for 'cmux auth whoami'.`,
	RunE: authStatusCmd.RunE,
}

func init() {
	authCmd.AddCommand(authLoginCmd)
	authCmd.AddCommand(authLogoutCmd)
	authCmd.AddCommand(authStatusCmd)
	authCmd.AddCommand(authWhoamiCmd)
}
