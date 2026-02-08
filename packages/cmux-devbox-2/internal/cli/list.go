package cli

import (
	"encoding/json"
	"fmt"

	"github.com/cmux-cli/cmux-devbox-2/internal/api"
	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List sandboxes",
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		instances, err := client.ListInstances(teamSlug)
		if err != nil {
			return err
		}

		if flagJSON {
			data, _ := json.MarshalIndent(instances, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(instances) == 0 {
			fmt.Println("No sandboxes found")
			return nil
		}

		fmt.Println("Sandboxes:")
		for _, inst := range instances {
			name := inst.Name
			if name == "" {
				name = "(unnamed)"
			}
			fmt.Printf("  %s - %s (%s)\n", inst.ID, inst.Status, name)
		}
		return nil
	},
}

var templatesCmd = &cobra.Command{
	Use:   "templates",
	Short: "List available templates",
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		templates, err := client.ListTemplates(teamSlug)
		if err != nil {
			return err
		}

		if flagJSON {
			data, _ := json.MarshalIndent(templates, "", "  ")
			fmt.Println(string(data))
			return nil
		}

		if len(templates) == 0 {
			fmt.Println("No templates found")
			return nil
		}

		fmt.Println("Templates:")
		for _, t := range templates {
			fmt.Printf("  %s - %s\n", t.ID, t.Name)
		}
		return nil
	},
}
