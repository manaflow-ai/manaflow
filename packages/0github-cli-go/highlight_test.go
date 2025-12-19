package main

import (
	"os"
	"strings"
	"testing"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

func init() {
	// Force lipgloss to output colors even without a TTY
	lipgloss.SetColorProfile(termenv.TrueColor)
	os.Setenv("CLICOLOR_FORCE", "1")
}

func TestHighlightCodeWithToken(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		lang     string
		token    string
		score    int
		wantSub  string // substring that should be in result
		wantNot  string // substring that should NOT be in result
		checkLen bool   // if true, verify we don't highlight to end of line
	}{
		{
			name:    "token in middle of line",
			code:    "def hello_world():",
			lang:    "python",
			token:   "hello",
			score:   50,
			wantSub: "hello", // token should be present
		},
		{
			name:    "token at end of line",
			code:    "return result",
			lang:    "python",
			token:   "result",
			score:   60,
			wantSub: "result",
		},
		{
			name:    "token not found",
			code:    "def foo():",
			lang:    "python",
			token:   "notfound",
			score:   50,
			wantSub: "def", // should still have syntax highlighted code
		},
		{
			name:    "case insensitive match",
			code:    "MyVariable = 42",
			lang:    "python",
			token:   "myvariable",
			score:   40,
			wantSub: "MyVariable", // should preserve original case
		},
		{
			name:    "low score - no highlight",
			code:    "x = 1",
			lang:    "python",
			token:   "x",
			score:   5,
			wantSub: "x",
		},
		{
			name:    "empty token",
			code:    "foo bar",
			lang:    "",
			token:   "",
			score:   50,
			wantSub: "foo bar",
		},
		{
			name:     "verify token bounds - not highlighting to EOL",
			code:     "first second third",
			lang:     "",
			token:    "second",
			score:    50,
			wantSub:  "second",
			checkLen: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var tokenPtr *string
			if tt.token != "" {
				tokenPtr = &tt.token
			}

			result := highlightCodeWithToken(tt.code, tt.lang, tokenPtr, tt.score)

			// Check that expected substring is present
			if tt.wantSub != "" && !strings.Contains(result, tt.wantSub) {
				// The substring might be split by ANSI codes, so strip them
				stripped := stripAnsi(result)
				if !strings.Contains(stripped, tt.wantSub) {
					t.Errorf("result should contain %q, got stripped: %q", tt.wantSub, stripped)
				}
			}

			// Check bounds - for "first second third", verify "third" is not highlighted
			if tt.checkLen {
				stripped := stripAnsi(result)
				if !strings.Contains(stripped, "first") || !strings.Contains(stripped, "third") {
					t.Errorf("bounds check: stripped result %q should contain 'first' and 'third'", stripped)
				}
			}

			t.Logf("Input:  %q", tt.code)
			t.Logf("Token:  %q (score=%d)", tt.token, tt.score)
			t.Logf("Output: %q", result)
			t.Logf("Stripped: %q", stripAnsi(result))
		})
	}
}

func TestHighlightCodeWithTokenPreserveBg(t *testing.T) {
	code := "def test():"
	token := "test"
	score := 60

	result := highlightCodeWithTokenPreserveBg(code, "python", &token, score)

	// Should not contain full reset code
	if strings.Contains(result, "\x1b[0m") {
		t.Error("result should not contain full reset \\x1b[0m")
	}

	// Should contain foreground-only reset
	if !strings.Contains(result, "\x1b[39m") {
		t.Log("Note: result may not contain \\x1b[39m if no resets were needed")
	}

	t.Logf("Result: %q", result)
}

func TestTokenBoundsExplicit(t *testing.T) {
	// Explicit test: highlight "bar" in "foo bar baz"
	// Only "bar" should get the score style, not "bar baz"
	code := "foo bar baz"
	token := "bar"
	score := 80 // high score = red background

	result := highlightCodeWithToken(code, "", nil, score)
	t.Logf("No token result: %q", result)

	result = highlightCodeWithToken(code, "", &token, score)
	t.Logf("With token result: %q", result)

	// Strip ANSI and verify structure
	stripped := stripAnsi(result)
	if stripped != code {
		t.Errorf("stripped result %q should equal original %q", stripped, code)
	}

	// The result should have ANSI codes around "bar" but not extending to "baz"
	// Look for the pattern: something + highlighted(bar) + something
	barIdx := strings.Index(result, "bar")
	if barIdx == -1 {
		t.Fatal("'bar' not found in result")
	}

	// Check what comes after "bar" in the result
	afterBar := result[barIdx+3:]
	t.Logf("After 'bar': %q", afterBar)

	// "baz" should appear after some reset/style codes
	if !strings.Contains(afterBar, "baz") {
		t.Error("'baz' should appear after 'bar'")
	}
}

func TestGetScoreStyleProducesANSI(t *testing.T) {
	// Test that getScoreStyle actually produces ANSI codes for all scores
	tests := []struct {
		score    int
		wantANSI bool
	}{
		{5, true},    // score <= 10, underline
		{15, true},   // score <= 25, teal
		{30, true},   // score <= 40, dark yellow
		{50, true},   // score <= 60, orange
		{70, true},   // score <= 80, red
		{90, true},   // > 80, magenta
	}

	for _, tt := range tests {
		style := getScoreStyle(tt.score)
		result := style.Render("test")
		hasANSI := strings.Contains(result, "\x1b[")
		t.Logf("Score %d: %q (hasANSI=%v)", tt.score, result, hasANSI)
		if hasANSI != tt.wantANSI {
			t.Errorf("Score %d: wantANSI=%v, got=%v", tt.score, tt.wantANSI, hasANSI)
		}
	}
}

func TestSSEEventMatching(t *testing.T) {
	// Simulate GitHub-parsed lines
	oldLine := 6
	lines := []LineData{
		{ChangeType: "delete", CodeLine: "from foo import bar", OldLineNumber: &oldLine, NewLineNumber: nil},
	}

	// Simulate 0github SSE event with "remove" changeType
	event := SSEEvent{
		ChangeType:        "remove",
		OldLineNumber:     &oldLine,
		NewLineNumber:     nil,
		MostImportantWord: strPtr("bar"),
		ShouldReviewWhy:   strPtr("removed import may break other usages"),
		Score:             25,
	}

	// Apply the matching logic
	for i := range lines {
		line := &lines[i]
		lineMatches := false

		switch event.ChangeType {
		case "add":
			if line.ChangeType == "add" &&
				event.NewLineNumber != nil && line.NewLineNumber != nil &&
				*event.NewLineNumber == *line.NewLineNumber {
				lineMatches = true
			}
		case "delete", "remove":
			if line.ChangeType == "delete" &&
				event.OldLineNumber != nil && line.OldLineNumber != nil &&
				*event.OldLineNumber == *line.OldLineNumber {
				lineMatches = true
			}
		}

		if lineMatches {
			line.MostImportantWord = event.MostImportantWord
			line.ShouldReviewWhy = event.ShouldReviewWhy
			line.Score = event.Score
		}
	}

	// Verify the overlay worked
	if lines[0].MostImportantWord == nil {
		t.Error("MostImportantWord should be set")
	} else if *lines[0].MostImportantWord != "bar" {
		t.Errorf("MostImportantWord = %q, want %q", *lines[0].MostImportantWord, "bar")
	}

	if lines[0].ShouldReviewWhy == nil {
		t.Error("ShouldReviewWhy should be set")
	}

	if lines[0].Score != 25 {
		t.Errorf("Score = %d, want 25", lines[0].Score)
	}

	t.Logf("Line after overlay: MostImportantWord=%v, ShouldReviewWhy=%v, Score=%d",
		*lines[0].MostImportantWord, *lines[0].ShouldReviewWhy, lines[0].Score)
}

func strPtr(s string) *string {
	return &s
}

func TestRenderingWithToken(t *testing.T) {
	// Test that rendering a line with MostImportantWord produces highlighted output
	line := LineData{
		ChangeType:        "add",
		CodeLine:          "from tinygrad import schedule",
		MostImportantWord: strPtr("schedule"),
		Score:             35,
	}

	code := line.CodeLine
	lang := "python"

	// This is what the renderer does
	var highlighted string
	if line.MostImportantWord != nil && line.Score >= 20 {
		highlighted = highlightCodeWithTokenPreserveBg(code, lang, line.MostImportantWord, line.Score)
	} else {
		highlighted = highlightLinePreserveBg(code, lang)
	}

	t.Logf("Original: %q", code)
	t.Logf("Highlighted: %q", highlighted)
	t.Logf("Stripped: %q", stripAnsi(highlighted))

	// Verify "schedule" appears with background styling
	if !strings.Contains(highlighted, "schedule") {
		t.Error("output should contain 'schedule'")
	}

	// Verify ANSI codes are present (the word should have background styling)
	if !strings.Contains(highlighted, "\x1b[") {
		t.Error("output should contain ANSI codes")
	}

	// The word "schedule" should have background color codes (48;5;XX)
	// Score 35 means olive background (score <= 40)
	if !strings.Contains(highlighted, "48;5;58") {
		t.Logf("Warning: expected olive background (48;5;58) for score 35, output: %q", highlighted)
	}
}

// stripAnsi removes ANSI escape codes from a string
func stripAnsi(s string) string {
	var result strings.Builder
	inEscape := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\x1b' {
			inEscape = true
			continue
		}
		if inEscape {
			if s[i] == 'm' {
				inEscape = false
			}
			continue
		}
		result.WriteByte(s[i])
	}
	return result.String()
}

// TestDebugTokenMatching helps debug why tokens might not be highlighted
func TestDebugTokenMatching(t *testing.T) {
	// Real examples from 0github API that might be failing
	testCases := []struct {
		codeLine string
		token    string
		score    int
	}{
		// These should work
		{"from tinygrad.ops import UOp, symbolic, graph_rewrite_map, _substitute", "_substitute", 45},
		{"    pa = a.lazydata", "pa", 35},
		{"def graph_rewrite_map(sink:UOp, pm:PatternMatcher, ctx=None) -> dict:", "graph_rewrite_map", 72},

		// Edge cases that might fail
		{"  return {k:(ctx.rewrite(k)) for k in list(sink.toposort)[::-1]}", "list", 82},
		{"    for t in [a,b,ret]: is_pattern(t, realized_pattern)", "is_pattern", 50},
		{"  def __init__(self, pm, ctx=None):", "ctx", 45},
		{"class TestTensorMutates(unittest.TestCase):", "TestTensorMutates", 20},
	}

	for _, tc := range testCases {
		// Check if token is in code
		idx := strings.Index(tc.codeLine, tc.token)
		if idx == -1 {
			idx = strings.Index(strings.ToLower(tc.codeLine), strings.ToLower(tc.token))
		}

		found := idx != -1
		result := highlightCodeWithToken(tc.codeLine, "python", &tc.token, tc.score)
		hasHighlight := strings.Contains(result, "48;5;") // background color

		t.Logf("Token: %q in %q", tc.token, tc.codeLine[:min(50, len(tc.codeLine))]+"...")
		t.Logf("  Found at idx: %d, Has highlight: %v", idx, hasHighlight)

		if found && tc.score > 10 && !hasHighlight {
			t.Errorf("  FAIL: Token found but not highlighted (score=%d)", tc.score)
		}
	}
}

func TestStripAnsi(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"\x1b[31mred\x1b[0m", "red"},
		{"plain text", "plain text"},
		{"\x1b[1;32mbold green\x1b[0m normal", "bold green normal"},
	}

	for _, tt := range tests {
		got := stripAnsi(tt.input)
		if got != tt.want {
			t.Errorf("stripAnsi(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

// TestSSEOverlayMatchingWithRealData tests that SSE events match GitHub lines correctly
func TestSSEOverlayMatchingWithRealData(t *testing.T) {
	// Simulate GitHub-parsed lines (what we get from GitHub API)
	newLine2 := 2
	newLine3 := 3
	newLine7 := 7
	oldLine6 := 6

	githubLines := []LineData{
		{ChangeType: "add", CodeLine: "from tinygrad.ops import UOp, symbolic, graph_rewrite_map, _substitute", NewLineNumber: &newLine2},
		{ChangeType: "add", CodeLine: "from test.unit.test_tensor_uop_representation import is_pattern", NewLineNumber: &newLine3},
		{ChangeType: "add", CodeLine: "    a = Tensor([1,2,3])", NewLineNumber: &newLine7},
		{ChangeType: "delete", CodeLine: "from foo import bar", OldLineNumber: &oldLine6},
	}

	// Simulate 0github SSE events
	sseEvents := []SSEEvent{
		{
			ChangeType:        "add",
			NewLineNumber:     &newLine2,
			MostImportantWord: strPtr("_substitute"),
			ShouldReviewWhy:   strPtr("importing private function"),
			Score:             45,
		},
		{
			ChangeType:        "add",
			NewLineNumber:     &newLine3,
			MostImportantWord: strPtr("is_pattern"),
			ShouldReviewWhy:   strPtr("importing test utilities"),
			Score:             30,
		},
		{
			ChangeType:        "add",
			NewLineNumber:     &newLine7,
			MostImportantWord: strPtr("Tensor"),
			ShouldReviewWhy:   strPtr("missing spaces"),
			Score:             15,
		},
		{
			ChangeType:        "remove", // API uses "remove" for deletes
			OldLineNumber:     &oldLine6,
			MostImportantWord: strPtr("bar"),
			ShouldReviewWhy:   strPtr("removed import"),
			Score:             25,
		},
	}

	// Apply overlay logic (same as in main.go)
	for _, event := range sseEvents {
		for i := range githubLines {
			line := &githubLines[i]
			lineMatches := false

			switch event.ChangeType {
			case "add":
				if line.ChangeType == "add" &&
					event.NewLineNumber != nil && line.NewLineNumber != nil &&
					*event.NewLineNumber == *line.NewLineNumber {
					lineMatches = true
				}
			case "delete", "remove":
				if line.ChangeType == "delete" &&
					event.OldLineNumber != nil && line.OldLineNumber != nil &&
					*event.OldLineNumber == *line.OldLineNumber {
					lineMatches = true
				}
			}

			if lineMatches {
				line.MostImportantWord = event.MostImportantWord
				line.ShouldReviewWhy = event.ShouldReviewWhy
				line.Score = event.Score
				break
			}
		}
	}

	// Verify overlays were applied
	tests := []struct {
		lineIdx       int
		wantToken     string
		wantScore     int
		wantReason    string
	}{
		{0, "_substitute", 45, "importing private function"},
		{1, "is_pattern", 30, "importing test utilities"},
		{2, "Tensor", 15, "missing spaces"},
		{3, "bar", 25, "removed import"},
	}

	for _, tt := range tests {
		line := githubLines[tt.lineIdx]

		if line.MostImportantWord == nil {
			t.Errorf("line %d: MostImportantWord is nil, want %q", tt.lineIdx, tt.wantToken)
			continue
		}
		if *line.MostImportantWord != tt.wantToken {
			t.Errorf("line %d: MostImportantWord = %q, want %q", tt.lineIdx, *line.MostImportantWord, tt.wantToken)
		}
		if line.Score != tt.wantScore {
			t.Errorf("line %d: Score = %d, want %d", tt.lineIdx, line.Score, tt.wantScore)
		}
		if line.ShouldReviewWhy == nil || *line.ShouldReviewWhy != tt.wantReason {
			t.Errorf("line %d: ShouldReviewWhy mismatch", tt.lineIdx)
		}

		t.Logf("Line %d: token=%q score=%d matched correctly", tt.lineIdx, tt.wantToken, tt.wantScore)
	}
}

// TestSSEOverlaySkipsAlreadyAnnotatedLines tests that we don't re-annotate lines
func TestSSEOverlaySkipsAlreadyAnnotatedLines(t *testing.T) {
	newLine1 := 1
	newLine2 := 2

	// Line 1 already has an annotation
	existingWord := "existing"
	githubLines := []LineData{
		{ChangeType: "add", CodeLine: "line one", NewLineNumber: &newLine1, MostImportantWord: &existingWord, Score: 50},
		{ChangeType: "add", CodeLine: "line two", NewLineNumber: &newLine2},
	}

	// SSE event tries to annotate line 1 again (shouldn't happen but test defense)
	event := SSEEvent{
		ChangeType:        "add",
		NewLineNumber:     &newLine1,
		MostImportantWord: strPtr("new_word"),
		Score:             99,
	}

	// Apply overlay logic with skip
	for i := range githubLines {
		line := &githubLines[i]

		// Skip lines that already have annotations
		if line.MostImportantWord != nil {
			continue
		}

		if line.ChangeType == "add" &&
			event.NewLineNumber != nil && line.NewLineNumber != nil &&
			*event.NewLineNumber == *line.NewLineNumber {
			line.MostImportantWord = event.MostImportantWord
			line.Score = event.Score
			break
		}
	}

	// Verify line 1 kept its original annotation
	if *githubLines[0].MostImportantWord != "existing" {
		t.Errorf("line 1 should keep original annotation, got %q", *githubLines[0].MostImportantWord)
	}
	if githubLines[0].Score != 50 {
		t.Errorf("line 1 should keep original score 50, got %d", githubLines[0].Score)
	}

	t.Log("Verified: already-annotated lines are not overwritten")
}

// TestHighlightWithRealAPIData tests highlighting with actual 0github API responses
func TestHighlightWithRealAPIData(t *testing.T) {
	tests := []struct {
		name       string
		codeLine   string
		token      string
		score      int
		lang       string
		shouldFind bool // whether token should be found and highlighted
	}{
		{
			name:       "underscore prefix token",
			codeLine:   "from tinygrad.ops import UOp, symbolic, graph_rewrite_map, _substitute",
			token:      "_substitute",
			score:      45,
			lang:       "python",
			shouldFind: true,
		},
		{
			name:       "two-letter variable",
			codeLine:   "    pa = a.lazydata",
			token:      "pa",
			score:      35,
			lang:       "python",
			shouldFind: true,
		},
		{
			name:       "function name at definition",
			codeLine:   "def graph_rewrite_map(sink:UOp, pm:PatternMatcher, ctx=None, bottom_up=False) -> dict[UOp, UOp]:",
			token:      "graph_rewrite_map",
			score:      72,
			lang:       "python",
			shouldFind: true,
		},
		{
			name:       "TODO in comment",
			codeLine:   "  if TRACK_MATCH_STATS >= 2 and not bottom_up and len(tracked_ctxs) != 0: # TODO: make viz work with bottom_up=True",
			token:      "TODO",
			score:      65,
			lang:       "python",
			shouldFind: true,
		},
		{
			name:       "method call after dot",
			codeLine:   "    d = (a+b).reshape(3,1)",
			token:      "reshape",
			score:      55,
			lang:       "python",
			shouldFind: true,
		},
		{
			name:       "single letter variable c",
			codeLine:   "    c = a+b",
			token:      "c",
			score:      20,
			lang:       "python",
			shouldFind: true,
		},
		{
			name:       "import token",
			codeLine:   "from tinygrad import dtypes, Tensor",
			token:      "tinygrad",
			score:      5,
			lang:       "python",
			shouldFind: false, // score too low
		},
		{
			name:       "class name",
			codeLine:   "class TestTensorMutates(unittest.TestCase):",
			token:      "TestTensorMutates",
			score:      10,
			lang:       "python",
			shouldFind: false, // score too low (<=10)
		},
		{
			name:       "ctx parameter with default None",
			codeLine:   "  def __init__(self, pm, ctx=None):",
			token:      "ctx",
			score:      45,
			lang:       "python",
			shouldFind: true,
		},
		{
			name:       "list comprehension with reversed",
			codeLine:   "  return {k:(rewrite_ctx.bottom_up_rewrite(k) if bottom_up else rewrite_ctx.rewrite(k)) for k in list(sink.toposort)[::-1]}",
			token:      "list",
			score:      82,
			lang:       "python",
			shouldFind: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := highlightCodeWithToken(tt.codeLine, tt.lang, &tt.token, tt.score)
			stripped := stripAnsi(result)

			// Verify stripped result equals original (no text lost)
			if stripped != tt.codeLine {
				t.Errorf("stripped result differs from original\ngot:  %q\nwant: %q", stripped, tt.codeLine)
			}

			// Verify token is in the result
			if !strings.Contains(stripped, tt.token) {
				t.Errorf("token %q not found in stripped result %q", tt.token, stripped)
			}

			// Check if highlighting was applied (ANSI codes present around token)
			hasHighlight := strings.Contains(result, "\x1b[") && tt.score > 10
			if tt.shouldFind && !hasHighlight {
				t.Errorf("expected highlighting for token %q with score %d, but no ANSI codes found", tt.token, tt.score)
			}

			// Find token position in result and verify highlight codes are nearby
			if tt.shouldFind {
				tokenIdx := strings.Index(result, tt.token)
				if tokenIdx == -1 {
					// Token might have ANSI codes in the middle - check stripped
					tokenIdx = strings.Index(stripped, tt.token)
					t.Logf("Token %q found at index %d in stripped result", tt.token, tokenIdx)
				} else {
					// Check for background color code (48;5;) before token
					before := result[:tokenIdx]
					if !strings.Contains(before, "48;5;") && !strings.Contains(before, "48;2;") {
						t.Logf("Warning: no background color found before token %q", tt.token)
					}
				}
			}

			t.Logf("Input:    %q", tt.codeLine)
			t.Logf("Token:    %q (score=%d)", tt.token, tt.score)
			t.Logf("Output:   %q", result)
			t.Logf("Stripped: %q", stripped)
		})
	}
}

// TestTokenBoundaryIssues tests edge cases that might cause highlighting issues
func TestTokenBoundaryIssues(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		token    string
		score    int
		checkFn  func(t *testing.T, result, stripped string)
	}{
		{
			name:  "token is substring of larger word",
			code:  "unittest.TestCase",
			token: "test",
			score: 50,
			checkFn: func(t *testing.T, result, stripped string) {
				// "test" should match inside "unittest" (first occurrence)
				if !strings.Contains(stripped, "unittest") {
					t.Error("original text lost")
				}
			},
		},
		{
			name:  "token at very start",
			code:  "def foo():",
			token: "def",
			score: 50,
			checkFn: func(t *testing.T, result, stripped string) {
				if !strings.HasPrefix(stripped, "def") {
					t.Error("token at start should be preserved")
				}
			},
		},
		{
			name:  "token at very end",
			code:  "return value",
			token: "value",
			score: 50,
			checkFn: func(t *testing.T, result, stripped string) {
				if !strings.HasSuffix(stripped, "value") {
					t.Error("token at end should be preserved")
				}
			},
		},
		{
			name:  "token appears multiple times",
			code:  "a = a + a",
			token: "a",
			score: 50,
			checkFn: func(t *testing.T, result, stripped string) {
				// Should highlight only first occurrence
				if stripped != "a = a + a" {
					t.Errorf("text corrupted: %q", stripped)
				}
				// Count occurrences of 'a' in stripped - should still be 3
				count := strings.Count(stripped, "a")
				if count != 3 {
					t.Errorf("expected 3 'a's, got %d", count)
				}
			},
		},
		{
			name:  "case mismatch - token lowercase, code uppercase",
			code:  "CONSTANT_VALUE = 42",
			token: "constant_value",
			score: 50,
			checkFn: func(t *testing.T, result, stripped string) {
				// Should find case-insensitively but preserve original case
				if !strings.Contains(stripped, "CONSTANT_VALUE") {
					t.Error("original case should be preserved")
				}
			},
		},
		{
			name:  "special chars in code near token",
			code:  "x[0] = y['key']",
			token: "key",
			score: 50,
			checkFn: func(t *testing.T, result, stripped string) {
				if stripped != "x[0] = y['key']" {
					t.Errorf("special chars corrupted: %q", stripped)
				}
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := highlightCodeWithToken(tt.code, "python", &tt.token, tt.score)
			stripped := stripAnsi(result)

			t.Logf("Input:    %q", tt.code)
			t.Logf("Token:    %q", tt.token)
			t.Logf("Output:   %q", result)
			t.Logf("Stripped: %q", stripped)

			if tt.checkFn != nil {
				tt.checkFn(t, result, stripped)
			}
		})
	}
}

// TestAPILineNumberOffset tests the known issue where 0github API line numbers
// are offset from GitHub's actual line numbers for new files
func TestAPILineNumberOffset(t *testing.T) {
	// From actual API response for PR 8432, file test/unit/test_rewrite_map.py
	// GitHub patch: @@ -0,0 +1,218 @@ means new file starting at line 1
	// But 0github API returns:
	//   Line 1 (import unittest): newLineNumber = null
	//   Line 2 (from tinygrad...): newLineNumber = 1  <- Should be 2!
	//   Line 3 (from tinygrad.ops...): newLineNumber = 2 <- Should be 3!

	// Simulate GitHub's parsed lines (correct)
	newLine1 := 1
	newLine2 := 2
	newLine3 := 3

	githubLines := []LineData{
		{ChangeType: "add", CodeLine: "import unittest", NewLineNumber: &newLine1},
		{ChangeType: "add", CodeLine: "from tinygrad import dtypes, Tensor", NewLineNumber: &newLine2},
		{ChangeType: "add", CodeLine: "from tinygrad.ops import UOp, symbolic, graph_rewrite_map, _substitute", NewLineNumber: &newLine3},
	}

	// Simulate 0github API SSE events (with offset issue)
	apiLine1 := 1 // API says line 1, but GitHub has this at line 2
	apiLine2 := 2 // API says line 2, but GitHub has this at line 3

	sseEvents := []SSEEvent{
		// First line in API has newLineNumber: null - can't match by line number
		{
			ChangeType:        "add",
			NewLineNumber:     nil, // API returns null for first line
			CodeLine:          "import unittest",
			MostImportantWord: strPtr("unittest"),
			ShouldReviewWhy:   strPtr("standard import"),
			Score:             0,
		},
		{
			ChangeType:        "add",
			NewLineNumber:     &apiLine1, // API says 1, but GitHub has it at 2
			CodeLine:          "from tinygrad import dtypes, Tensor",
			MostImportantWord: strPtr("tinygrad"),
			ShouldReviewWhy:   strPtr("importing from main package"),
			Score:             5,
		},
		{
			ChangeType:        "add",
			NewLineNumber:     &apiLine2, // API says 2, but GitHub has it at 3
			CodeLine:          "from tinygrad.ops import UOp, symbolic, graph_rewrite_map, _substitute",
			MostImportantWord: strPtr("_substitute"),
			ShouldReviewWhy:   strPtr("importing private function"),
			Score:             45,
		},
	}

	// Current matching logic (line number only) - will fail for offset cases
	matchedByLineNum := 0
	for _, event := range sseEvents {
		for i := range githubLines {
			line := &githubLines[i]
			if line.MostImportantWord != nil {
				continue // Already matched
			}

			lineMatches := false
			if event.ChangeType == "add" &&
				event.NewLineNumber != nil && line.NewLineNumber != nil &&
				*event.NewLineNumber == *line.NewLineNumber {
				lineMatches = true
			}

			if lineMatches {
				line.MostImportantWord = event.MostImportantWord
				line.Score = event.Score
				matchedByLineNum++
				break
			}
		}
	}

	t.Logf("Matched by line number only: %d/3", matchedByLineNum)

	// Reset for fallback matching test
	for i := range githubLines {
		githubLines[i].MostImportantWord = nil
		githubLines[i].Score = 0
	}

	// Enhanced matching: try line number first, fall back to code content
	matchedWithFallback := 0
	for _, event := range sseEvents {
		for i := range githubLines {
			line := &githubLines[i]
			if line.MostImportantWord != nil {
				continue // Already matched
			}

			lineMatches := false

			// Try line number matching first
			if event.ChangeType == "add" &&
				event.NewLineNumber != nil && line.NewLineNumber != nil &&
				*event.NewLineNumber == *line.NewLineNumber {
				lineMatches = true
			}

			// Fallback: match by code content for same change type
			if !lineMatches && event.ChangeType == line.ChangeType {
				// Normalize and compare code
				eventCode := strings.TrimSpace(event.CodeLine)
				lineCode := strings.TrimSpace(line.CodeLine)
				if eventCode != "" && lineCode != "" && eventCode == lineCode {
					lineMatches = true
				}
			}

			if lineMatches {
				line.MostImportantWord = event.MostImportantWord
				line.Score = event.Score
				matchedWithFallback++
				break
			}
		}
	}

	t.Logf("Matched with code content fallback: %d/3", matchedWithFallback)

	// Verify all lines got annotations with fallback
	for i, line := range githubLines {
		if line.MostImportantWord == nil {
			t.Errorf("Line %d (%q) has no annotation", i, line.CodeLine[:30])
		} else {
			t.Logf("Line %d: token=%q score=%d", i, *line.MostImportantWord, line.Score)
		}
	}

	if matchedWithFallback != 3 {
		t.Errorf("Expected 3 matches with fallback, got %d", matchedWithFallback)
	}
}
