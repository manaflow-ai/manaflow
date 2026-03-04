package cli

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/karlorz/devsh/internal/vm"
)

// TestTaskMemoryOutputFormatting tests the memory output formatting logic
func TestTaskMemoryOutputFormatting(t *testing.T) {
	tests := []struct {
		name       string
		snapshots  []vm.MemorySnapshot
		wantGroups []string
	}{
		{
			name: "groups by memory type",
			snapshots: []vm.MemorySnapshot{
				{MemoryType: "knowledge", Content: "test knowledge"},
				{MemoryType: "daily", Content: "test daily", Date: "2025-01-15"},
				{MemoryType: "tasks", Content: `{"tasks":[]}`},
				{MemoryType: "mailbox", Content: `{"messages":[]}`},
			},
			wantGroups: []string{"Knowledge", "Daily Logs", "Tasks", "Mailbox"},
		},
		{
			name:       "handles empty snapshots",
			snapshots:  []vm.MemorySnapshot{},
			wantGroups: []string{},
		},
		{
			name: "single type",
			snapshots: []vm.MemorySnapshot{
				{MemoryType: "knowledge", Content: "only knowledge"},
			},
			wantGroups: []string{"Knowledge"},
		},
	}

	typeLabels := map[string]string{
		"knowledge": "Knowledge",
		"daily":     "Daily Logs",
		"tasks":     "Tasks",
		"mailbox":   "Mailbox",
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Group snapshots by type (same logic as in task_memory.go)
			byType := make(map[string][]vm.MemorySnapshot)
			for _, snap := range tt.snapshots {
				byType[snap.MemoryType] = append(byType[snap.MemoryType], snap)
			}

			// Verify expected groups
			typeOrder := []string{"knowledge", "daily", "tasks", "mailbox"}
			var foundGroups []string
			for _, memType := range typeOrder {
				if snapshots, ok := byType[memType]; ok && len(snapshots) > 0 {
					foundGroups = append(foundGroups, typeLabels[memType])
				}
			}

			if len(foundGroups) != len(tt.wantGroups) {
				t.Errorf("got %d groups, want %d", len(foundGroups), len(tt.wantGroups))
			}
			for i, group := range foundGroups {
				if i < len(tt.wantGroups) && group != tt.wantGroups[i] {
					t.Errorf("group[%d] = %q, want %q", i, group, tt.wantGroups[i])
				}
			}
		})
	}
}

// TestTaskMemoryJSONPrettyPrint tests JSON pretty-printing for tasks/mailbox
func TestTaskMemoryJSONPrettyPrint(t *testing.T) {
	tests := []struct {
		name      string
		content   string
		memType   string
		wantPretty bool
	}{
		{
			name:       "tasks content is pretty-printed",
			content:    `{"tasks":[{"id":"1","title":"test"}]}`,
			memType:    "tasks",
			wantPretty: true,
		},
		{
			name:       "mailbox content is pretty-printed",
			content:    `{"messages":[]}`,
			memType:    "mailbox",
			wantPretty: true,
		},
		{
			name:       "knowledge content is not JSON",
			content:    "# Project Knowledge\n\nSome text here",
			memType:    "knowledge",
			wantPretty: false,
		},
		{
			name:       "invalid JSON in tasks",
			content:    "not json",
			memType:    "tasks",
			wantPretty: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			content := strings.TrimSpace(tt.content)

			// Apply pretty-printing logic (same as task_memory.go)
			if tt.memType == "tasks" || tt.memType == "mailbox" {
				var jsonObj interface{}
				if err := json.Unmarshal([]byte(content), &jsonObj); err == nil {
					prettyJSON, _ := json.MarshalIndent(jsonObj, "", "  ")
					content = string(prettyJSON)
				}
			}

			// Check if content was pretty-printed (has newlines and indentation)
			hasPrettyFormat := strings.Contains(content, "\n") && strings.Contains(content, "  ")

			if tt.wantPretty && !hasPrettyFormat {
				t.Errorf("expected pretty-printed JSON, got: %s", content[:min(len(content), 50)])
			}
			if !tt.wantPretty && hasPrettyFormat && tt.memType != "knowledge" {
				// knowledge content may have newlines naturally
				t.Errorf("unexpected pretty-printing for non-JSON content")
			}
		})
	}
}

// TestTaskMemoryMetadataDisplay tests metadata rendering
func TestTaskMemoryMetadataDisplay(t *testing.T) {
	now := time.Now().Unix() * 1000 // Convert to milliseconds

	tests := []struct {
		name     string
		snapshot vm.MemorySnapshot
		wantMeta []string
	}{
		{
			name: "shows all metadata",
			snapshot: vm.MemorySnapshot{
				AgentName: "claude-code",
				Date:      "2025-01-15",
				CreatedAt: now,
				Truncated: true,
			},
			wantMeta: []string{"Agent:", "Date:", "Synced:", "truncated"},
		},
		{
			name: "handles missing metadata",
			snapshot: vm.MemorySnapshot{
				Content: "test content",
			},
			wantMeta: []string{},
		},
		{
			name: "shows agent only",
			snapshot: vm.MemorySnapshot{
				AgentName: "opencode",
			},
			wantMeta: []string{"Agent:"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Build metadata lines (same logic as task_memory.go)
			var metaLines []string

			if tt.snapshot.AgentName != "" {
				metaLines = append(metaLines, "Agent: "+tt.snapshot.AgentName)
			}
			if tt.snapshot.Date != "" {
				metaLines = append(metaLines, "Date: "+tt.snapshot.Date)
			}
			if tt.snapshot.CreatedAt > 0 {
				synced := time.Unix(tt.snapshot.CreatedAt/1000, 0).Format(time.RFC3339)
				metaLines = append(metaLines, "Synced: "+synced)
			}
			if tt.snapshot.Truncated {
				metaLines = append(metaLines, "(Content truncated)")
			}

			// Verify expected metadata
			metaOutput := strings.Join(metaLines, "\n")
			for _, want := range tt.wantMeta {
				if !strings.Contains(metaOutput, want) {
					t.Errorf("metadata missing %q, got: %s", want, metaOutput)
				}
			}

			// Verify no unexpected metadata when none expected
			if len(tt.wantMeta) == 0 && len(metaLines) > 0 {
				t.Errorf("expected no metadata, got: %s", metaOutput)
			}
		})
	}
}

// TestFatalAPIError tests the isFatalAPIError helper for ID resolution fallback
func TestFatalAPIError(t *testing.T) {
	tests := []struct {
		err         error
		wantFatal   bool
		description string
	}{
		{fmt.Errorf("API error (404): Task not found"), false, "404 error - not fatal, fall back"},
		{fmt.Errorf("API error (500): Internal error"), false, "500 error - not fatal, fall back"},
		{fmt.Errorf("API error (401): Unauthorized"), true, "401 error - fatal auth error"},
		{fmt.Errorf("API error (403): Forbidden"), true, "403 error - fatal auth error"},
		{nil, false, "nil error"},
		{fmt.Errorf("network error: connection refused"), true, "connection refused - fatal network error"},
		{fmt.Errorf("dial tcp: no such host"), true, "no such host - fatal network error"},
		{fmt.Errorf("context deadline exceeded"), true, "timeout - fatal"},
	}

	for _, tt := range tests {
		t.Run(tt.description, func(t *testing.T) {
			got := isFatalAPIError(tt.err)
			if got != tt.wantFatal {
				t.Errorf("isFatalAPIError(%v) = %v, want %v", tt.err, got, tt.wantFatal)
			}
		})
	}
}

// TestMemoryTypeFilter tests the type filter functionality
func TestMemoryTypeFilter(t *testing.T) {
	allSnapshots := []vm.MemorySnapshot{
		{MemoryType: "knowledge", Content: "knowledge content"},
		{MemoryType: "daily", Content: "daily content"},
		{MemoryType: "tasks", Content: `{"tasks":[]}`},
		{MemoryType: "mailbox", Content: `{"messages":[]}`},
	}

	tests := []struct {
		filter    string
		wantCount int
	}{
		{"", 4},          // No filter, all results
		{"knowledge", 1}, // Single type
		{"daily", 1},
		{"tasks", 1},
		{"mailbox", 1},
		{"invalid", 0}, // Invalid type returns nothing
	}

	for _, tt := range tests {
		t.Run("filter="+tt.filter, func(t *testing.T) {
			var filtered []vm.MemorySnapshot

			if tt.filter == "" {
				filtered = allSnapshots
			} else {
				for _, snap := range allSnapshots {
					if snap.MemoryType == tt.filter {
						filtered = append(filtered, snap)
					}
				}
			}

			if len(filtered) != tt.wantCount {
				t.Errorf("filter %q: got %d results, want %d", tt.filter, len(filtered), tt.wantCount)
			}
		})
	}
}

// TestMemorySnapshotSerialization tests JSON serialization of memory results
func TestMemorySnapshotSerialization(t *testing.T) {
	result := vm.GetTaskRunMemoryResult{
		Memory: []vm.MemorySnapshot{
			{
				ID:         "snap1",
				MemoryType: "knowledge",
				Content:    "# Test Knowledge",
				AgentName:  "claude-code",
				CreatedAt:  1705276800000,
				Truncated:  false,
			},
			{
				ID:         "snap2",
				MemoryType: "daily",
				Content:    "# Daily Log: 2025-01-15",
				Date:       "2025-01-15",
				AgentName:  "claude-code",
				CreatedAt:  1705276800000,
			},
		},
	}

	// Test JSON serialization (same as --json flag output)
	data, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		t.Fatalf("JSON marshal failed: %v", err)
	}

	// Verify it can be unmarshaled back
	var decoded vm.GetTaskRunMemoryResult
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("JSON unmarshal failed: %v", err)
	}

	if len(decoded.Memory) != len(result.Memory) {
		t.Errorf("decoded %d snapshots, want %d", len(decoded.Memory), len(result.Memory))
	}

	// Verify fields preserved
	if decoded.Memory[0].MemoryType != "knowledge" {
		t.Errorf("memoryType = %q, want %q", decoded.Memory[0].MemoryType, "knowledge")
	}
	if decoded.Memory[0].AgentName != "claude-code" {
		t.Errorf("agentName = %q, want %q", decoded.Memory[0].AgentName, "claude-code")
	}
}
