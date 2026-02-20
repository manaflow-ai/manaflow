package cli

import (
	"fmt"

	"github.com/manaflow-ai/cloudrouter/internal/api"
	"github.com/spf13/cobra"
)

var (
	listFlagProvider      string
	templatesFlagProvider string
)

var listCmd = &cobra.Command{
	Use:     "list",
	Aliases: []string{"ls"},
	Short:   "List sandboxes",
	Long: `List sandboxes. Optionally filter by type.

Examples:
  cloudrouter list                        # List all sandboxes
  cloudrouter list --provider e2b         # List only Docker sandboxes
  cloudrouter list --provider modal       # List only GPU sandboxes`,
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		instances, err := client.ListInstances(teamSlug, listFlagProvider)
		if err != nil {
			return err
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
			typeLabel := "Docker"
			if inst.Provider == "modal" {
				if inst.GPU != "" {
					typeLabel = fmt.Sprintf("GPU (%s)", inst.GPU)
				} else {
					typeLabel = "GPU"
				}
			}
			fmt.Printf("  %s - %s (%s) [%s]\n", inst.ID, inst.Status, name, typeLabel)
		}
		return nil
	},
}

var templatesCmd = &cobra.Command{
	Use:   "templates",
	Short: "List available templates",
	Long: `List available templates. Optionally filter by type.

Examples:
  cloudrouter templates                   # List all templates
  cloudrouter templates --provider e2b    # List only Docker templates
  cloudrouter templates --provider modal  # List only GPU templates`,
	RunE: func(cmd *cobra.Command, args []string) error {
		teamSlug, err := getTeamSlug()
		if err != nil {
			return fmt.Errorf("failed to get team: %w", err)
		}

		client := api.NewClient()
		templates, err := client.ListTemplates(teamSlug, templatesFlagProvider)
		if err != nil {
			return err
		}

		if len(templates) == 0 {
			fmt.Println("No templates found")
			return nil
		}

		fmt.Println("Templates:")
		for _, t := range templates {
			typeLabel := "Docker"
			if t.Provider == "modal" {
				if t.GPU != "" {
					typeLabel = fmt.Sprintf("GPU (%s)", t.GPU)
				} else {
					typeLabel = "GPU"
				}
			}
			fmt.Printf("  %s - %s [%s]\n", t.ID, t.Name, typeLabel)
		}
		return nil
	},
}

func init() {
	listCmd.Flags().StringVarP(&listFlagProvider, "provider", "p", "", "Filter by provider: e2b, modal")
	templatesCmd.Flags().StringVarP(&templatesFlagProvider, "provider", "p", "", "Filter by provider: e2b, modal")
}
