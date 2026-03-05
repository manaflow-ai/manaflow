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
	projectItemsProjectID      string
	projectItemsInstallationID int
	projectItemsFirst          int
	projectItemsAfter          string
	projectItemsStatus         string
	projectItemsNoLinkedTask   bool
)

var projectItemsCmd = &cobra.Command{
	Use:   "items --project-id <id> --installation-id <id>",
	Short: "List items in a GitHub Project",
	Long: `List items (issues, PRs, draft issues) in a GitHub Project.

Examples:
  devsh project items --project-id PVT_xxx --installation-id 12345
  devsh project items --project-id PVT_xxx --installation-id 12345 --first 20
  devsh project items --project-id PVT_xxx --installation-id 12345 --status "Backlog"
  devsh project items --project-id PVT_xxx --installation-id 12345 --status Backlog --no-linked-task
  devsh project items --project-id PVT_xxx --installation-id 12345 --json`,
	RunE: runProjectItems,
}

func runProjectItems(cmd *cobra.Command, args []string) error {
	if projectItemsProjectID == "" {
		return fmt.Errorf("--project-id flag is required")
	}
	if projectItemsInstallationID <= 0 {
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

	result, err := client.GetProjectItems(ctx, vm.GetProjectItemsOptions{
		ProjectID:      projectItemsProjectID,
		InstallationID: projectItemsInstallationID,
		First:          projectItemsFirst,
		After:          projectItemsAfter,
		Status:         projectItemsStatus,
		NoLinkedTask:   projectItemsNoLinkedTask,
	})
	if err != nil {
		return fmt.Errorf("failed to get project items: %w", err)
	}

	// Build set of linked project item IDs if --no-linked-task is set
	var linkedItemIds map[string]bool
	if projectItemsNoLinkedTask {
		linkedItemIds = make(map[string]bool)
		// Fetch tasks to get their githubProjectItemId values
		tasksResult, err := client.ListTasks(ctx, false)
		if err != nil {
			return fmt.Errorf("failed to list tasks for linked-task filter: %w", err)
		}
		for _, task := range tasksResult.Tasks {
			if task.GithubProjectItemId != "" {
				linkedItemIds[task.GithubProjectItemId] = true
			}
		}
	}

	// Apply filters
	var filteredItems []vm.ProjectItem
	for _, item := range result.Items {
		// --status filter: case-insensitive match on Status field
		if projectItemsStatus != "" {
			itemStatus := ""
			if sv, ok := item.FieldValues["Status"]; ok {
				if s, ok := sv.(string); ok {
					itemStatus = s
				}
			}
			if !strings.EqualFold(itemStatus, projectItemsStatus) {
				continue
			}
		}

		// --no-linked-task filter: exclude items that have a linked cmux task
		if projectItemsNoLinkedTask && linkedItemIds[item.ID] {
			continue
		}

		filteredItems = append(filteredItems, item)
	}

	// For JSON output, return filtered items
	if flagJSON {
		output := struct {
			Items    []vm.ProjectItem `json:"items"`
			PageInfo struct {
				HasNextPage bool    `json:"hasNextPage"`
				EndCursor   *string `json:"endCursor"`
			} `json:"pageInfo"`
		}{
			Items: filteredItems,
		}
		output.PageInfo.HasNextPage = result.PageInfo.HasNextPage
		output.PageInfo.EndCursor = result.PageInfo.EndCursor
		data, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(data))
		return nil
	}

	if len(filteredItems) == 0 {
		fmt.Println("No items found.")
		return nil
	}

	fmt.Printf("%-28s %-10s %-60s %-14s %s\n", "ID", "TYPE", "TITLE", "STATUS", "URL")
	fmt.Println("----------------------------", "----------", "------------------------------------------------------------", "--------------", "------------------------------------------------------------")

	for _, item := range filteredItems {
		itemType := "Draft"
		title := "(untitled)"
		url := "-"
		status := "-"

		if item.Content != nil {
			title = item.Content.Title
			if item.Content.URL != nil {
				url = *item.Content.URL
			}
			if item.Content.State != nil {
				// Determine type from URL
				if item.Content.URL != nil && len(*item.Content.URL) > 0 {
					itemType = "Issue"
					for i := len(*item.Content.URL) - 1; i >= 0; i-- {
						if (*item.Content.URL)[i] == '/' {
							break
						}
					}
					// Check if URL path contains /pull/
					urlStr := *item.Content.URL
					for i := 0; i < len(urlStr)-5; i++ {
						if urlStr[i:i+6] == "/pull/" {
							itemType = "PR"
							break
						}
					}
				}
			} else {
				itemType = "Draft"
			}
		}

		if len(title) > 60 {
			title = title[:57] + "..."
		}

		if len(url) > 60 {
			url = url[:57] + "..."
		}

		// Get status from field values
		if sv, ok := item.FieldValues["Status"]; ok {
			if s, ok := sv.(string); ok {
				status = s
			}
		}

		if len(status) > 14 {
			status = status[:11] + "..."
		}

		id := item.ID
		if len(id) > 28 {
			id = id[:25] + "..."
		}

		fmt.Printf("%-28s %-10s %-60s %-14s %s\n", id, itemType, title, status, url)
	}

	if result.PageInfo.HasNextPage && result.PageInfo.EndCursor != nil {
		fmt.Printf("\nMore items available. Use --after %s to load next page.\n", *result.PageInfo.EndCursor)
	}

	return nil
}

func init() {
	projectItemsCmd.Flags().StringVar(&projectItemsProjectID, "project-id", "", "GitHub Project node ID (required)")
	projectItemsCmd.Flags().IntVar(&projectItemsInstallationID, "installation-id", 0, "GitHub App installation ID (required)")
	projectItemsCmd.Flags().IntVar(&projectItemsFirst, "first", 50, "Number of items to fetch (default 50)")
	projectItemsCmd.Flags().StringVar(&projectItemsAfter, "after", "", "Pagination cursor")
	projectItemsCmd.Flags().StringVar(&projectItemsStatus, "status", "", "Filter by status field (e.g., Backlog, In Progress, Done)")
	projectItemsCmd.Flags().BoolVar(&projectItemsNoLinkedTask, "no-linked-task", false, "Exclude items that already have a linked cmux task")
	projectCmd.AddCommand(projectItemsCmd)
}
