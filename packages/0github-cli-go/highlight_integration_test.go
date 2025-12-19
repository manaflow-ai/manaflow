package main

import (
	"strings"
	"testing"
)

// TestHighlightingFromScreenshot tests highlighting with exact data from user's screenshot
// The comments ARE showing but tokens aren't highlighted
func TestHighlightingFromScreenshot(t *testing.T) {
	// These are the exact lines from the user's screenshot of test_tensor_uop_representation.py
	// Comments are visible but tokens should also be highlighted
	testLines := []struct {
		codeLine          string
		mostImportantWord string
		shouldReviewWhy   string
		score             int
		newLineNumber     int
	}{
		{
			codeLine:          "def is_pattern_uop(u:UOp, pat:UPat): assert pat.match(u, {}), f\"{u}\\nis not\\n{pat}\"",
			mostImportantWord: "is_pattern_uop",
			shouldReviewWhy:   "function redefined to delegate to new helper",
			score:             25,
			newLineNumber:     8,
		},
		{
			codeLine:          "def is_pattern(ten:Tensor, pat:UPat): is_pattern_uop(ten.lazydata, pat)",
			mostImportantWord: "is_pattern",
			shouldReviewWhy:   "function redefined to delegate to new helper",
			score:             25,
			newLineNumber:     9,
		},
		{
			codeLine:          "class TestTensorMutates(unittest.TestCase):",
			mostImportantWord: "TestTensorMutates",
			shouldReviewWhy:   "new test class for mutation behavior",
			score:             20,
			newLineNumber:     11,
		},
		{
			codeLine:          "  @unittest.expectedFailure",
			mostImportantWord: "expectedFailure",
			shouldReviewWhy:   "test expected to fail may hide issues",
			score:             40,
			newLineNumber:     13,
		},
		{
			codeLine:          "  def test_mutate_add(self):",
			mostImportantWord: "test_mutate_add",
			shouldReviewWhy:   "magic numbers in test data",
			score:             10,
			newLineNumber:     14,
		},
		{
			codeLine:          "    a = Tensor([1,2,3])",
			mostImportantWord: "Tensor",
			shouldReviewWhy:   "magic numbers in test data",
			score:             10,
			newLineNumber:     15,
		},
		{
			codeLine:          "    b = Tensor([4,5,6])",
			mostImportantWord: "Tensor",
			shouldReviewWhy:   "variable naming could be clearer",
			score:             15,
			newLineNumber:     16,
		},
		{
			codeLine:          "    ret = a+b",
			mostImportantWord: "ret",
			shouldReviewWhy:   "cryptic variable name for lazydata reference",
			score:             30,
			newLineNumber:     17,
		},
		{
			codeLine:          "    pa = a.lazydata",
			mostImportantWord: "pa",
			shouldReviewWhy:   "cryptic variable name for lazydata reference",
			score:             35,
			newLineNumber:     18,
		},
		{
			codeLine:          "    pb = b.lazydata",
			mostImportantWord: "pb",
			shouldReviewWhy:   "cryptic variable name for lazydata reference",
			score:             35,
			newLineNumber:     19,
		},
		{
			codeLine:          "    pr = ret.lazydata",
			mostImportantWord: "pr",
			shouldReviewWhy:   "schedule called without realize may be intentional",
			score:             35,
			newLineNumber:     20,
		},
		{
			codeLine:          "    ret.schedule()",
			mostImportantWord: "schedule",
			shouldReviewWhy:   "checking identity mutation behavior",
			score:             25,
			newLineNumber:     21,
		},
		{
			codeLine:          "    self.assertIsNot(pa, a.lazydata)",
			mostImportantWord: "assertIsNot",
			shouldReviewWhy:   "checking identity mutation behavior",
			score:             15,
			newLineNumber:     22,
		},
		{
			codeLine:          "    for t in [a,b,ret]: is_pattern(t, realized_pattern)",
			mostImportantWord: "is_pattern",
			shouldReviewWhy:   "inline loop with assertion may hide failures",
			score:             50,
			newLineNumber:     25,
		},
		{
			codeLine:          "    d = (a+b).reshape(3,1)",
			mostImportantWord: "reshape",
			shouldReviewWhy:   "only d realized but c checked too",
			score:             55,
			newLineNumber:     31,
		},
		{
			codeLine:          "    is_pattern_uop(d.lazydata.base, realized_pattern)",
			mostImportantWord: "base",
			shouldReviewWhy:   "c not realized but expected to match pattern",
			score:             60,
			newLineNumber:     33,
		},
	}

	lang := "python"

	for _, line := range testLines {
		t.Run(line.mostImportantWord, func(t *testing.T) {
			// Check if token exists in code
			tokenIdx := strings.Index(line.codeLine, line.mostImportantWord)
			if tokenIdx == -1 {
				tokenIdx = strings.Index(strings.ToLower(line.codeLine), strings.ToLower(line.mostImportantWord))
			}

			if tokenIdx == -1 {
				t.Errorf("TOKEN NOT FOUND: %q not in %q", line.mostImportantWord, line.codeLine)
				return
			}

			// Apply highlighting
			result := highlightCodeWithToken(line.codeLine, lang, &line.mostImportantWord, line.score)
			stripped := stripAnsi(result)

			// Check stripped text matches original
			if stripped != line.codeLine {
				t.Errorf("Text corrupted:\n  got:  %q\n  want: %q", stripped, line.codeLine)
			}

			// Check for ANSI codes (highlighting applied)
			hasANSI := strings.Contains(result, "\x1b[")
			hasBackground := strings.Contains(result, "48;5;") || strings.Contains(result, "48;2;")
			hasUnderline := strings.Contains(result, ";4m") || strings.Contains(result, "\x1b[4")

			t.Logf("Line %d: token=%q score=%d", line.newLineNumber, line.mostImportantWord, line.score)
			t.Logf("  Code: %.60s...", line.codeLine)
			t.Logf("  Token found at idx: %d", tokenIdx)
			t.Logf("  Has ANSI: %v, Has BG: %v, Has Underline: %v", hasANSI, hasBackground, hasUnderline)

			if !hasANSI {
				t.Errorf("NO HIGHLIGHTING: score=%d should have ANSI codes", line.score)
			}

			// For score > 10, should have background color
			if line.score > 10 && !hasBackground {
				t.Logf("  Warning: score %d should have background color", line.score)
			}

			// Log the actual output for debugging
			t.Logf("  Raw output: %q", result[:min(200, len(result))])
		})
	}
}

// TestTokenFoundInCode verifies all tokens can be found in their code lines
func TestTokenFoundInCode(t *testing.T) {
	// Problematic cases from screenshot
	cases := []struct {
		code  string
		token string
	}{
		{"def is_pattern_uop(u:UOp, pat:UPat): assert pat.match(u, {})", "is_pattern_uop"},
		{"class TestTensorMutates(unittest.TestCase):", "TestTensorMutates"},
		{"  @unittest.expectedFailure", "expectedFailure"},
		{"    a = Tensor([1,2,3])", "Tensor"},
		{"    ret = a+b", "ret"},
		{"    pa = a.lazydata", "pa"},
		{"    ret.schedule()", "schedule"},
		{"    self.assertIsNot(pa, a.lazydata)", "assertIsNot"},
		{"    for t in [a,b,ret]: is_pattern(t, realized_pattern)", "is_pattern"},
		{"    d = (a+b).reshape(3,1)", "reshape"},
		{"    is_pattern_uop(d.lazydata.base, realized_pattern)", "base"},
	}

	for _, c := range cases {
		idx := strings.Index(c.code, c.token)
		if idx == -1 {
			idx = strings.Index(strings.ToLower(c.code), strings.ToLower(c.token))
		}

		if idx == -1 {
			t.Errorf("Token %q NOT FOUND in %q", c.token, c.code)
		} else {
			t.Logf("Token %q found at idx %d in %q", c.token, idx, c.code)
		}
	}
}
