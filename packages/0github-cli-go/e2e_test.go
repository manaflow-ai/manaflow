package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func init() {
	lipgloss.SetColorProfile(termenv.TrueColor)
	os.Setenv("CLICOLOR_FORCE", "1")
}

// TestE2ERenderWithRealAPI fetches real data from 0github API and renders it
// This test outputs the rendered lines so you can visually verify highlighting
func TestE2ERenderWithRealAPI(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping e2e test in short mode")
	}

	// Fetch GitHub diff first
	owner := "tinygrad"
	repo := "tinygrad"
	prNumber := 8432

	ghFiles, err := fetchGitHubPRFiles(owner, repo, prNumber)
	if err != nil {
		t.Fatalf("Failed to fetch GitHub files: %v", err)
	}

	// Parse GitHub diff into our data structure
	files := make(map[string]*FileData)
	for _, ghFile := range ghFiles {
		lines := parseDiffPatch(ghFile.Patch, ghFile.Filename)
		files[ghFile.Filename] = &FileData{
			FilePath:  ghFile.Filename,
			Status:    "pending",
			Lines:     lines,
			Additions: ghFile.Additions,
			Deletions: ghFile.Deletions,
		}
	}

	t.Logf("Fetched %d files from GitHub", len(files))
	for path, file := range files {
		t.Logf("  %s: %d lines", path, len(file.Lines))
	}

	// Fetch 0github SSE events
	url := fmt.Sprintf("%s/api/pr-review/simple?repoFullName=%s/%s&prNumber=%d",
		apiBaseURL, owner, repo, prNumber)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		t.Fatalf("Failed to create request: %v", err)
	}
	req.Header.Set("Accept", "text/event-stream")

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("Failed to fetch SSE: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		t.Fatalf("SSE returned status %d", resp.StatusCode)
	}

	// Parse SSE events and overlay onto GitHub data
	scanner := bufio.NewScanner(resp.Body)
	eventCount := 0
	matchedCount := 0

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		var event SSEEvent
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		if event.Type != "line" {
			continue
		}
		eventCount++

		// Apply overlay with fallback matching
		if file, exists := files[event.FilePath]; exists {
			for i := range file.Lines {
				fileLine := &file.Lines[i]
				if fileLine.MostImportantWord != nil {
					continue
				}

				lineMatches := false

				// Line number matching
				switch event.ChangeType {
				case "add":
					if fileLine.ChangeType == "add" &&
						event.NewLineNumber != nil && fileLine.NewLineNumber != nil &&
						*event.NewLineNumber == *fileLine.NewLineNumber {
						lineMatches = true
					}
				case "delete", "remove":
					if fileLine.ChangeType == "delete" &&
						event.OldLineNumber != nil && fileLine.OldLineNumber != nil &&
						*event.OldLineNumber == *fileLine.OldLineNumber {
						lineMatches = true
					}
				}

				// Fallback: match by code content
				if !lineMatches && event.CodeLine != "" {
					eventChangeType := event.ChangeType
					if eventChangeType == "remove" {
						eventChangeType = "delete"
					}
					if fileLine.ChangeType == eventChangeType {
						eventCode := strings.TrimSpace(event.CodeLine)
						lineCode := strings.TrimSpace(fileLine.CodeLine)
						if eventCode != "" && lineCode != "" && eventCode == lineCode {
							lineMatches = true
						}
					}
				}

				if lineMatches {
					// Verify token exists in line before setting annotation
					if event.MostImportantWord != nil && *event.MostImportantWord != "" {
						token := *event.MostImportantWord
						lineCode := fileLine.CodeLine
						if lineCode == "" {
							lineCode = fileLine.DiffLine
						}
						if !strings.Contains(strings.ToLower(lineCode), strings.ToLower(token)) {
							continue // Token not in this line, try next
						}
					}

					fileLine.MostImportantWord = event.MostImportantWord
					fileLine.ShouldReviewWhy = event.ShouldReviewWhy
					fileLine.Score = event.Score
					matchedCount++
					break
				}
			}
		}
	}

	t.Logf("Processed %d line events, matched %d", eventCount, matchedCount)

	// Now render the output with visible highlighting markers
	t.Log("\n" + strings.Repeat("=", 80))
	t.Log("RENDERED OUTPUT WITH HIGHLIGHTING")
	t.Log(strings.Repeat("=", 80))

	for filePath, file := range files {
		t.Logf("\n--- FILE: %s ---", filePath)

		for i, line := range file.Lines {
			if line.ChangeType == "hunk" {
				t.Logf("%3d | [HUNK] %s", i, line.CodeLine)
				continue
			}

			// Render with highlighting
			lang := "python"
			var rendered string
			if line.MostImportantWord != nil {
				rendered = highlightCodeWithToken(line.CodeLine, lang, line.MostImportantWord, line.Score)
			} else {
				rendered = highlightLine(line.CodeLine, lang)
			}

			// Create a visual representation of what's highlighted
			changeMarker := " "
			switch line.ChangeType {
			case "add":
				changeMarker = "+"
			case "delete":
				changeMarker = "-"
			}

			lineNum := ""
			if line.NewLineNumber != nil {
				lineNum = fmt.Sprintf("%3d", *line.NewLineNumber)
			} else if line.OldLineNumber != nil {
				lineNum = fmt.Sprintf("%3d", *line.OldLineNumber)
			} else {
				lineNum = "   "
			}

			// Show annotation info
			annotation := ""
			if line.MostImportantWord != nil {
				annotation = fmt.Sprintf(" [TOKEN:%q SCORE:%d]", *line.MostImportantWord, line.Score)
			}

			// Log with raw ANSI codes visible
			t.Logf("%s %s %s %s%s", lineNum, changeMarker, describeHighlight(rendered, line.CodeLine), line.CodeLine, annotation)

			// Also show the actual rendered output (will show colors in terminal)
			if line.MostImportantWord != nil && line.Score > 10 {
				t.Logf("        VISUAL: %s", rendered)
			}
		}
	}

	// Summary stats
	t.Log("\n" + strings.Repeat("=", 80))
	t.Log("HIGHLIGHTING SUMMARY")
	t.Log(strings.Repeat("=", 80))

	for filePath, file := range files {
		withToken := 0
		withBg := 0
		withUnderline := 0
		for _, line := range file.Lines {
			if line.MostImportantWord != nil {
				withToken++
				rendered := highlightCodeWithToken(line.CodeLine, "python", line.MostImportantWord, line.Score)
				if strings.Contains(rendered, "48;5;") || strings.Contains(rendered, "48;2;") {
					withBg++
				}
				if strings.Contains(rendered, ";4m") || strings.Contains(rendered, "\x1b[4") {
					withUnderline++
				}
			}
		}
		t.Logf("%s: %d lines with tokens, %d with background, %d with underline",
			filePath, withToken, withBg, withUnderline)
	}

	// Verify we got some matches
	if matchedCount == 0 {
		t.Error("No SSE events matched GitHub lines - check matching logic")
	}
}

// describeHighlight returns a description of what highlighting was applied
func describeHighlight(rendered, original string) string {
	if !strings.Contains(rendered, "\x1b[") {
		return "[NO-ANSI]"
	}

	var parts []string

	if strings.Contains(rendered, "48;5;239") {
		parts = append(parts, "BG:gray")
	} else if strings.Contains(rendered, "48;5;23") {
		parts = append(parts, "BG:teal")
	} else if strings.Contains(rendered, "48;5;136") {
		parts = append(parts, "BG:yellow")
	} else if strings.Contains(rendered, "48;5;208") {
		parts = append(parts, "BG:orange")
	} else if strings.Contains(rendered, "48;5;196") {
		parts = append(parts, "BG:red")
	} else if strings.Contains(rendered, "48;5;201") {
		parts = append(parts, "BG:magenta")
	}

	if len(parts) == 0 {
		return "[SYNTAX-ONLY]"
	}
	return "[" + strings.Join(parts, ",") + "]"
}

// TestRenderSampleLines renders specific sample lines to verify highlighting visually
func TestRenderSampleLines(t *testing.T) {
	lipgloss.SetColorProfile(termenv.TrueColor)

	// Sample lines from the actual API response
	samples := []struct {
		codeLine string
		token    string
		score    int
		desc     string
	}{
		{"def graph_rewrite_map(sink:UOp, pm:PatternMatcher, ctx=None, bottom_up=False) -> dict[UOp, UOp]:", "graph_rewrite_map", 72, "high score - red bg"},
		{"  if TRACK_MATCH_STATS >= 2 and not bottom_up and len(tracked_ctxs) != 0: # TODO: make viz work", "TODO", 65, "TODO comment - orange bg"},
		{"    pa = a.lazydata", "pa", 35, "cryptic var - yellow bg"},
		{"    ret.schedule()", "schedule", 25, "method call - teal bg"},
		{"class TestTensorMutates(unittest.TestCase):", "TestTensorMutates", 10, "low score - underline"},
		{"  def test_mutate_add(self):", "test_mutate_add", 5, "very low score - underline"},
		{"import unittest", "unittest", 0, "zero score - underline"},
	}

	t.Log("\n" + strings.Repeat("=", 80))
	t.Log("SAMPLE LINE RENDERING")
	t.Log(strings.Repeat("=", 80))

	for _, s := range samples {
		rendered := highlightCodeWithToken(s.codeLine, "python", &s.token, s.score)
		highlight := describeHighlight(rendered, s.codeLine)

		t.Logf("\n%s (score=%d)", s.desc, s.score)
		t.Logf("  Token: %q", s.token)
		t.Logf("  Highlight: %s", highlight)
		t.Logf("  Raw ANSI: %q", rendered[:min(150, len(rendered))])
		t.Logf("  Visual: %s", rendered)

		// Verify expected highlighting
		switch {
		case s.score <= 10:
			if !strings.Contains(rendered, "48;5;239") {
				t.Errorf("Score %d should have gray background (48;5;239)", s.score)
			}
		case s.score <= 25:
			if !strings.Contains(rendered, "48;5;23") {
				t.Errorf("Score %d should have teal background (48;5;23)", s.score)
			}
		case s.score <= 40:
			if !strings.Contains(rendered, "48;5;136") {
				t.Errorf("Score %d should have yellow background (48;5;136)", s.score)
			}
		case s.score <= 60:
			if !strings.Contains(rendered, "48;5;208") {
				t.Errorf("Score %d should have orange background (48;5;208)", s.score)
			}
		case s.score <= 80:
			if !strings.Contains(rendered, "48;5;196") {
				t.Errorf("Score %d should have red background (48;5;196)", s.score)
			}
		}
	}
}
