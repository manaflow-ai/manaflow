package cli

import (
	"fmt"

	"github.com/manaflow-ai/cloudrouter/internal/auth"
	"github.com/spf13/cobra"
)

var authCmd = &cobra.Command{
	Use:   "auth",
	Short: "Authentication commands",
}

var loginCmd = &cobra.Command{
	Use:   "login",
	Short: "Login to cloudrouter (opens browser)",
	RunE: func(cmd *cobra.Command, args []string) error {
		return auth.Login()
	},
}

var logoutCmd = &cobra.Command{
	Use:   "logout",
	Short: "Logout and clear credentials",
	RunE: func(cmd *cobra.Command, args []string) error {
		return auth.Logout()
	},
}

var whoamiCmd = &cobra.Command{
	Use:   "whoami",
	Short: "Show current user and team",
	RunE: func(cmd *cobra.Command, args []string) error {
		if !auth.IsLoggedIn() {
			fmt.Println("Not logged in. Run 'cloudrouter login' to authenticate.")
			return nil
		}

		profile, err := auth.FetchUserProfile()
		if err != nil {
			fmt.Println("Logged in (could not fetch profile)")
			return nil
		}

		if profile.Email != "" {
			fmt.Printf("User: %s\n", profile.Email)
		} else if profile.Name != "" {
			fmt.Printf("User: %s\n", profile.Name)
		}
		if profile.TeamDisplayName != "" {
			fmt.Printf("Team: %s\n", profile.TeamDisplayName)
		} else if profile.TeamSlug != "" {
			fmt.Printf("Team: %s\n", profile.TeamSlug)
		}
		return nil
	},
}

func init() {
	authCmd.AddCommand(&cobra.Command{
		Use:   "login",
		Short: "Login to cloudrouter",
		RunE:  loginCmd.RunE,
	})
	authCmd.AddCommand(&cobra.Command{
		Use:   "logout",
		Short: "Logout",
		RunE:  logoutCmd.RunE,
	})
	authCmd.AddCommand(&cobra.Command{
		Use:   "whoami",
		Short: "Show current user",
		RunE:  whoamiCmd.RunE,
	})
}
