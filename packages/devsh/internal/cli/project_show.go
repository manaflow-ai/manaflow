package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/karlorz/devsh/internal/auth"
	"github.com/karlorz/devsh/internal/vm"
	"github.com/spf13/cobra"
)

var (
	projectShowProjectID      string
	projectShowInstallationID int
)

var projectShowCmd = &cobra.Command{
	Use:   "show --project-id <id> --installation-id <id>",
	Short: "Show GitHub Project fields",
	Long: `Show fields for a GitHub Project so you can inspect field names, types, and options.

Examples:
  devsh project show --project-id PVT_xxx --installation-id 12345
  devsh project show --project-id PVT_xxx --installation-id 12345 --json`,
	RunE: runProjectShow,
}

func runProjectShow(cmd *cobra.Command, args []string) error {
	if projectShowProjectID == "" {
		return fmt.Errorf("--project-id flag is required")
	}
	if projectShowInstallationID <= 0 {
		return fmt.Errorf("--installation-id flag is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	teamSlug, err := auth.GetTeamSlug()
	if err != nil {
		return fmt.Errorf("failed to get team: %w", err)
	}

	client, err := vm.NewClient()
	if err != nil {
		return fmt.Errorf("failed to create client: %w", err)
	}
	client.SetTeamSlug(teamSlug)

	result, err := client.GetProjectFields(ctx, vm.GetProjectFieldsOptions{
		ProjectID:      projectShowProjectID,
		InstallationID: projectShowInstallationID,
	})
	if err != nil {
		return fmt.Errorf("failed to get project fields: %w", err)
	}

	if flagJSON {
		data, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	if len(result.Fields) == 0 {
		fmt.Println("No fields found.")
		return nil
	}

	fmt.Printf("%-36s %-28s %s\n", "NAME", "TYPE", "OPTIONS")
	fmt.Println("------------------------------------", "----------------------------", "----------------------------------------")

	for _, field := range result.Fields {
		options := "-"
		if len(field.Options) > 0 {
			optionNames := make([]string, 0, len(field.Options))
			for _, option := range field.Options {
				optionNames = append(optionNames, option.Name)
			}
			options = strings.Join(optionNames, ", ")
			if len(options) > 40 {
				options = options[:37] + "..."
			}
		}

		name := field.Name
		if len(name) > 36 {
			name = name[:33] + "..."
		}

		fmt.Printf("%-36s %-28s %s\n", name, field.DataType, options)
	}

	return nil
}

func init() {
	projectShowCmd.Flags().StringVar(&projectShowProjectID, "project-id", "", "GitHub Project node ID (required)")
	projectShowCmd.Flags().IntVar(&projectShowInstallationID, "installation-id", 0, "GitHub App installation ID (required)")
	projectCmd.AddCommand(projectShowCmd)
}
