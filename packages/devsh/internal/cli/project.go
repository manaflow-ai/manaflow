package cli

import "github.com/spf13/cobra"

var projectCmd = &cobra.Command{
	Use:   "project",
	Short: "Manage GitHub Projects imports",
	Long: `Manage GitHub Projects workflow helpers.

Examples:
  devsh project list --installation-id 12345 --owner my-org --owner-type organization
  devsh project show --project-id PVT_xxx --installation-id 12345
  devsh project import ./plan.md --project-id PVT_xxx --installation-id 12345
  devsh project import ./plan.md --project-id PVT_xxx --installation-id 12345 --dry-run`,
}

func init() {
	rootCmd.AddCommand(projectCmd)
}
