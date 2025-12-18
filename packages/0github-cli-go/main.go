package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/alecthomas/chroma/v2/formatters"
	"github.com/alecthomas/chroma/v2/lexers"
	"github.com/alecthomas/chroma/v2/styles"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const (
	apiBaseURL      = "https://0github.com"
	minSidebarWidth = 42
)

// Styles
var (
	focusedBorderStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(lipgloss.Color("6")) // cyan

	unfocusedBorderStyle = lipgloss.NewStyle().
				Border(lipgloss.RoundedBorder()).
				BorderForeground(lipgloss.Color("8")) // gray

	selectedStyle = lipgloss.NewStyle().
			Background(lipgloss.Color("4")). // blue
			Foreground(lipgloss.Color("15")) // white

	selectedUnfocusedStyle = lipgloss.NewStyle().
				Background(lipgloss.Color("8")). // gray
				Foreground(lipgloss.Color("15")) // white

	headerStyle = lipgloss.NewStyle().
			Bold(true).
			Foreground(lipgloss.Color("6")) // cyan

	dimStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("8"))

	addStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("2")).
			Bold(true)

	removeStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("1")).
			Bold(true)

	// Delta-style line backgrounds
	addLineBg = lipgloss.NewStyle().
			Background(lipgloss.Color("22")). // dark green
			Foreground(lipgloss.Color("15"))

	removeLineBg = lipgloss.NewStyle().
			Background(lipgloss.Color("52")). // dark red
			Foreground(lipgloss.Color("15"))

	statusBarStyle = lipgloss.NewStyle().
			Foreground(lipgloss.Color("7"))
)

func getScoreStyle(score int) lipgloss.Style {
	switch {
	case score <= 10:
		return lipgloss.NewStyle()
	case score <= 25:
		return lipgloss.NewStyle().Background(lipgloss.Color("22")).Foreground(lipgloss.Color("15")) // dark green
	case score <= 40:
		return lipgloss.NewStyle().Background(lipgloss.Color("58")).Foreground(lipgloss.Color("15")) // olive/yellow
	case score <= 60:
		return lipgloss.NewStyle().Background(lipgloss.Color("208")).Foreground(lipgloss.Color("0")) // orange
	case score <= 80:
		return lipgloss.NewStyle().Background(lipgloss.Color("196")).Foreground(lipgloss.Color("15")) // red
	default:
		return lipgloss.NewStyle().Background(lipgloss.Color("201")).Foreground(lipgloss.Color("15")).Bold(true) // magenta
	}
}

// highlightCodeWithToken applies syntax highlighting and highlights a specific token
func highlightCodeWithToken(code string, lang string, token *string, score int) string {
	// If no token to highlight or low score, just do syntax highlighting
	if token == nil || *token == "" || score <= 10 {
		if lang != "" {
			return highlightLine(code, lang)
		}
		return code
	}

	// Find the token position in raw code
	idx := strings.Index(code, *token)
	if idx == -1 {
		// Try case-insensitive
		lowerCode := strings.ToLower(code)
		lowerToken := strings.ToLower(*token)
		idx = strings.Index(lowerCode, lowerToken)
	}

	if idx == -1 {
		// Token not found, just syntax highlight
		if lang != "" {
			return highlightLine(code, lang)
		}
		return code
	}

	// Split code into parts
	before := code[:idx]
	tokenText := code[idx : idx+len(*token)]
	after := code[idx+len(*token):]

	// Syntax highlight each part
	if lang != "" {
		before = highlightLine(before, lang)
		after = highlightLine(after, lang)
	}

	// Apply score-based highlight to token (on top of any syntax highlighting)
	style := getScoreStyle(score)
	highlightedToken := style.Render(tokenText)

	return before + highlightedToken + after
}

func getStatusColor(status string, maxScore int) lipgloss.Color {
	switch status {
	case "streaming":
		return lipgloss.Color("4") // blue
	case "complete":
		if maxScore > 60 {
			return lipgloss.Color("1") // red
		} else if maxScore > 30 {
			return lipgloss.Color("3") // yellow
		}
		return lipgloss.Color("2") // green
	case "skipped":
		return lipgloss.Color("8") // gray
	case "error":
		return lipgloss.Color("1") // red
	default:
		return lipgloss.Color("8") // gray
	}
}

// Data types
type LineData struct {
	ChangeType        string  `json:"changeType"`
	DiffLine          string  `json:"diffLine"`
	CodeLine          string  `json:"codeLine"`
	MostImportantWord *string `json:"mostImportantWord"`
	ShouldReviewWhy   *string `json:"shouldReviewWhy"`
	Score             int     `json:"score"`
	ScoreNormalized   float64 `json:"scoreNormalized"`
	OldLineNumber     *int    `json:"oldLineNumber"`
	NewLineNumber     *int    `json:"newLineNumber"`
}

type FileData struct {
	FilePath   string
	Status     string // pending, streaming, complete, skipped, error
	SkipReason string
	Lines      []LineData
	MaxScore   int
	Additions  int
	Deletions  int
}

// SSE Event
type SSEEvent struct {
	Type     string          `json:"type"`
	FilePath string          `json:"filePath,omitempty"`
	Reason   string          `json:"reason,omitempty"`
	Status   string          `json:"status,omitempty"`
	Message  string          `json:"message,omitempty"`
	Line     json.RawMessage `json:"line,omitempty"`
	// Line fields directly on event
	ChangeType        string  `json:"changeType,omitempty"`
	DiffLine          string  `json:"diffLine,omitempty"`
	CodeLine          string  `json:"codeLine,omitempty"`
	MostImportantWord *string `json:"mostImportantWord,omitempty"`
	ShouldReviewWhy   *string `json:"shouldReviewWhy,omitempty"`
	Score             int     `json:"score,omitempty"`
	ScoreNormalized   float64 `json:"scoreNormalized,omitempty"`
	OldLineNumber     *int    `json:"oldLineNumber,omitempty"`
	NewLineNumber     *int    `json:"newLineNumber,omitempty"`
}

// Messages
type sseEventMsg SSEEvent
type sseErrorMsg struct{ err error }
type sseDoneMsg struct{}
type githubFilesMsg struct {
	files []GitHubFile
}
type githubErrorMsg struct{ err error }

// Model
type model struct {
	owner          string
	repo           string
	prNumber       int
	files          map[string]*FileData
	fileOrder      []string
	isComplete     bool
	err            error
	width          int
	height         int
	activePane     string // "files" or "diff"
	fileIndex      int
	diffScroll     int
	showTooltip    bool
	githubLoaded   bool   // true when GitHub diff is loaded
	aiAnnotating   bool   // true when 0github is streaming
	sideBySide     bool   // true for side-by-side view, false for unified
}

func initialModel(owner, repo string, prNumber int) model {
	return model{
		owner:       owner,
		repo:        repo,
		prNumber:    prNumber,
		files:       make(map[string]*FileData),
		fileOrder:   []string{},
		activePane:  "files",
		showTooltip: true,
	}
}

func (m model) Init() tea.Cmd {
	// First fetch GitHub files, then start 0github SSE for AI annotations
	return m.fetchGitHubFiles()
}

func (m model) fetchGitHubFiles() tea.Cmd {
	return func() tea.Msg {
		files, err := fetchGitHubPRFiles(m.owner, m.repo, m.prNumber)
		if err != nil {
			return githubErrorMsg{err}
		}
		return githubFilesMsg{files}
	}
}

func (m model) startSSE() tea.Cmd {
	return func() tea.Msg {
		url := fmt.Sprintf("%s/api/pr-review/simple?repoFullName=%s/%s&prNumber=%d",
			apiBaseURL, m.owner, m.repo, m.prNumber)

		resp, err := http.Get(url)
		if err != nil {
			return sseErrorMsg{err}
		}

		go func() {
			defer resp.Body.Close()
			scanner := bufio.NewScanner(resp.Body)
			// Increase buffer size for long lines
			buf := make([]byte, 0, 64*1024)
			scanner.Buffer(buf, 1024*1024)

			for scanner.Scan() {
				line := scanner.Text()
				if !strings.HasPrefix(line, "data:") {
					continue
				}
				data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
				if data == "" {
					continue
				}

				var event SSEEvent
				if err := json.Unmarshal([]byte(data), &event); err != nil {
					continue
				}

				// Send to program - we'll need a channel for this
				// For now, we'll process inline
			}
		}()

		return nil
	}
}

// Streaming command that processes SSE events
func streamSSE(owner, repo string, prNumber int) tea.Cmd {
	return func() tea.Msg {
		url := fmt.Sprintf("%s/api/pr-review/simple?repoFullName=%s/%s&prNumber=%d",
			apiBaseURL, owner, repo, prNumber)

		resp, err := http.Get(url)
		if err != nil {
			return sseErrorMsg{err}
		}
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "" {
				continue
			}

			var event SSEEvent
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				continue
			}

			return sseEventMsg(event)
		}

		return sseDoneMsg{}
	}
}

// Batch stream events
func batchStreamSSE(owner, repo string, prNumber int, eventChan chan<- SSEEvent) tea.Cmd {
	return func() tea.Msg {
		url := fmt.Sprintf("%s/api/pr-review/simple?repoFullName=%s/%s&prNumber=%d",
			apiBaseURL, owner, repo, prNumber)

		resp, err := http.Get(url)
		if err != nil {
			return sseErrorMsg{err}
		}
		defer resp.Body.Close()

		scanner := bufio.NewScanner(resp.Body)
		buf := make([]byte, 0, 64*1024)
		scanner.Buffer(buf, 1024*1024)

		for scanner.Scan() {
			line := scanner.Text()
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "" {
				continue
			}

			var event SSEEvent
			if err := json.Unmarshal([]byte(data), &event); err != nil {
				continue
			}

			eventChan <- event
		}
		close(eventChan)
		return sseDoneMsg{}
	}
}

// Listen for SSE events from channel
func listenSSE(eventChan <-chan SSEEvent) tea.Cmd {
	return func() tea.Msg {
		event, ok := <-eventChan
		if !ok {
			return sseDoneMsg{}
		}
		return sseEventMsg(event)
	}
}

// Globals for SSE channel (simple approach)
var sseEventChan chan SSEEvent

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c":
			return m, tea.Quit
		case "tab":
			if m.activePane == "files" {
				m.activePane = "diff"
			} else {
				m.activePane = "files"
			}
		case "t":
			m.showTooltip = !m.showTooltip
		case "s":
			m.sideBySide = !m.sideBySide
			m.diffScroll = 0
		case "j", "down":
			if m.activePane == "files" {
				if m.fileIndex < len(m.fileOrder)-1 {
					m.fileIndex++
					m.diffScroll = 0
				}
			} else {
				m.diffScroll++
			}
		case "k", "up":
			if m.activePane == "files" {
				if m.fileIndex > 0 {
					m.fileIndex--
					m.diffScroll = 0
				}
			} else {
				if m.diffScroll > 0 {
					m.diffScroll--
				}
			}
		case "J", "pgdown":
			if m.activePane == "files" {
				m.fileIndex = min(m.fileIndex+10, len(m.fileOrder)-1)
				m.diffScroll = 0
			} else {
				m.diffScroll += m.height - 6
			}
		case "K", "pgup":
			if m.activePane == "files" {
				m.fileIndex = max(m.fileIndex-10, 0)
				m.diffScroll = 0
			} else {
				m.diffScroll = max(m.diffScroll-(m.height-6), 0)
			}
		case "g", "home":
			if m.activePane == "files" {
				m.fileIndex = 0
			}
			m.diffScroll = 0
		case "G", "end":
			if m.activePane == "files" {
				m.fileIndex = max(len(m.fileOrder)-1, 0)
			} else if len(m.fileOrder) > 0 {
				file := m.files[m.fileOrder[m.fileIndex]]
				if file != nil {
					m.diffScroll = max(len(file.Lines)-(m.height-6), 0)
				}
			}
		case "l", "right", "enter":
			if m.activePane == "files" {
				m.activePane = "diff"
			}
		case "h", "left":
			if m.activePane == "diff" {
				m.activePane = "files"
			}
		case "]":
			if m.fileIndex < len(m.fileOrder)-1 {
				m.fileIndex++
				m.diffScroll = 0
			}
		case "[":
			if m.fileIndex > 0 {
				m.fileIndex--
				m.diffScroll = 0
			}
		}

	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height

	case githubFilesMsg:
		// Populate files from GitHub
		m.githubLoaded = true
		m.isComplete = true // Mark as complete since we're not using 0github for now
		for _, ghFile := range msg.files {
			lines := parseDiffPatch(ghFile.Patch, ghFile.Filename)
			m.fileOrder = append(m.fileOrder, ghFile.Filename)
			m.files[ghFile.Filename] = &FileData{
				FilePath:  ghFile.Filename,
				Status:    "complete",
				Lines:     lines,
				Additions: ghFile.Additions,
				Deletions: ghFile.Deletions,
			}
		}
		// TODO: Re-enable 0github AI annotations later
		// m.aiAnnotating = true
		// return m, listenSSE(sseEventChan)
		return m, nil

	case githubErrorMsg:
		m.err = msg.err
		return m, nil

	case sseEventMsg:
		event := SSEEvent(msg)
		switch event.Type {
		case "file":
			// Mark file as streaming (AI annotating) - only if file exists from GitHub
			if file, exists := m.files[event.FilePath]; exists {
				file.Status = "streaming"
			}
			// Don't create new files - GitHub is source of truth
		case "skip":
			// Mark file as skipped - only if file exists from GitHub
			if file, exists := m.files[event.FilePath]; exists {
				file.Status = "skipped"
				file.SkipReason = event.Reason
			}
			// Don't create new files - GitHub is source of truth
		case "line":
			// Overlay AI scores on existing GitHub lines (preserve GitHub order)
			if file, exists := m.files[event.FilePath]; exists {
				// Find matching line by line numbers and change type
				for i := range file.Lines {
					line := &file.Lines[i]
					lineMatches := false

					// Match based on change type and corresponding line number
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
					case "context":
						if line.ChangeType == "context" &&
							event.OldLineNumber != nil && line.OldLineNumber != nil &&
							*event.OldLineNumber == *line.OldLineNumber {
							lineMatches = true
						}
					}

					if lineMatches {
						// Overlay AI annotations onto existing GitHub line
						line.MostImportantWord = event.MostImportantWord
						line.ShouldReviewWhy = event.ShouldReviewWhy
						line.Score = event.Score
						line.ScoreNormalized = event.ScoreNormalized
						if event.Score > file.MaxScore {
							file.MaxScore = event.Score
						}
						break
					}
				}
				// Don't append unmatched lines - GitHub is source of truth for order
			}
		case "file-complete":
			if file, exists := m.files[event.FilePath]; exists {
				if event.Status == "error" {
					file.Status = "error"
				} else {
					file.Status = "complete"
				}
			}
		case "complete":
			m.isComplete = true
			m.aiAnnotating = false
			return m, nil
		case "error":
			m.err = fmt.Errorf("%s", event.Message)
			return m, nil
		}
		return m, listenSSE(sseEventChan)

	case sseErrorMsg:
		// Don't treat SSE errors as fatal - we still have GitHub data
		m.aiAnnotating = false
		m.isComplete = true
		return m, nil

	case sseDoneMsg:
		m.isComplete = true
		m.aiAnnotating = false
		return m, nil
	}

	return m, nil
}

func (m model) View() string {
	if m.width == 0 {
		return "Loading..."
	}
	if !m.githubLoaded && m.err == nil {
		return "Fetching PR from GitHub..."
	}

	// Calculate dimensions
	sidebarWidth := minSidebarWidth
	diffWidth := m.width - sidebarWidth - 4 // borders

	// Render file list
	fileList := m.renderFileList(sidebarWidth, m.height-3)

	// Render diff view
	diffView := m.renderDiffView(diffWidth, m.height-3)

	// Combine panes
	content := lipgloss.JoinHorizontal(lipgloss.Top, fileList, diffView)

	// Status bar
	statusBar := m.renderStatusBar()

	return lipgloss.JoinVertical(lipgloss.Left, content, statusBar)
}

func (m model) renderFileList(width, height int) string {
	var b strings.Builder

	isFocused := m.activePane == "files"
	borderStyle := unfocusedBorderStyle
	if isFocused {
		borderStyle = focusedBorderStyle
	}

	// Header
	arrow := "  "
	if isFocused {
		arrow = "▶ "
	}
	header := headerStyle.Render(fmt.Sprintf("%sFiles (%d)", arrow, len(m.fileOrder)))
	b.WriteString(header)
	b.WriteString("\n")

	// Calculate visible range
	visibleItems := height - 4
	scrollOffset := 0
	if m.fileIndex > visibleItems/2 {
		scrollOffset = min(m.fileIndex-visibleItems/2, max(0, len(m.fileOrder)-visibleItems))
	}

	// Render files
	for i := scrollOffset; i < min(scrollOffset+visibleItems, len(m.fileOrder)); i++ {
		filePath := m.fileOrder[i]
		file := m.files[filePath]
		if file == nil {
			continue
		}

		isSelected := i == m.fileIndex
		fileName := filepath.Base(filePath)

		// Status icon
		var icon string
		switch file.Status {
		case "streaming":
			icon = "◐"
		case "complete":
			icon = "●"
		case "skipped":
			icon = "⊘"
		case "error":
			icon = "✗"
		default:
			icon = "○"
		}

		iconStyle := lipgloss.NewStyle().Foreground(getStatusColor(file.Status, file.MaxScore))

		// Build additions/deletions string
		addDelStr := ""
		if file.Additions > 0 || file.Deletions > 0 {
			addStr := addStyle.Render(fmt.Sprintf("+%d", file.Additions))
			delStr := removeStyle.Render(fmt.Sprintf("-%d", file.Deletions))
			addDelStr = fmt.Sprintf("%s%s", addStr, delStr)
		}

		// Truncate filename - leave room for +X-Y
		maxNameLen := width - 20
		if len(fileName) > maxNameLen {
			fileName = fileName[:maxNameLen-1] + "…"
		}

		// Score
		scoreStr := ""
		if file.MaxScore > 0 {
			scoreStr = fmt.Sprintf("%3d", file.MaxScore)
		}

		line := fmt.Sprintf("%s %-*s %s %s", iconStyle.Render(icon), maxNameLen, fileName, addDelStr, scoreStr)

		if isSelected {
			if isFocused {
				line = selectedStyle.Render(line)
			} else {
				line = selectedUnfocusedStyle.Render(line)
			}
		}

		b.WriteString(line)
		b.WriteString("\n")
	}

	// Scroll indicator
	if len(m.fileOrder) > visibleItems {
		upArrow := " "
		downArrow := " "
		if scrollOffset > 0 {
			upArrow = "↑"
		}
		if scrollOffset+visibleItems < len(m.fileOrder) {
			downArrow = "↓"
		}
		b.WriteString(dimStyle.Render(fmt.Sprintf("%s%s %d-%d/%d",
			upArrow, downArrow,
			scrollOffset+1, min(scrollOffset+visibleItems, len(m.fileOrder)), len(m.fileOrder))))
	}

	return borderStyle.Width(width).Height(height).Render(b.String())
}

func (m model) renderDiffView(width, height int) string {
	var b strings.Builder

	isFocused := m.activePane == "diff"
	borderStyle := unfocusedBorderStyle
	if isFocused {
		borderStyle = focusedBorderStyle
	}

	if len(m.fileOrder) == 0 || m.fileIndex >= len(m.fileOrder) {
		return borderStyle.Width(width).Height(height).Render(dimStyle.Render("Select a file to view diff"))
	}

	file := m.files[m.fileOrder[m.fileIndex]]
	if file == nil {
		return borderStyle.Width(width).Height(height).Render(dimStyle.Render("Loading..."))
	}

	// Header
	arrow := "  "
	if isFocused {
		arrow = "▶ "
	}

	lang := getLanguageFromPath(file.FilePath)
	langTag := ""
	if lang != "" {
		langTag = fmt.Sprintf(" [%s]", lang)
	}

	viewMode := "unified"
	if m.sideBySide {
		viewMode = "side-by-side"
	}

	header := fmt.Sprintf("%s%s", arrow, file.FilePath)
	headerRight := fmt.Sprintf("%s | %d lines%s", viewMode, len(file.Lines), langTag)

	headerLine := lipgloss.JoinHorizontal(lipgloss.Top,
		headerStyle.Render(header),
		strings.Repeat(" ", max(0, width-len(header)-len(headerRight)-6)),
		dimStyle.Render(headerRight),
	)
	b.WriteString(headerLine)
	b.WriteString("\n")

	if file.Status == "skipped" {
		b.WriteString(dimStyle.Render(fmt.Sprintf("Skipped: %s", file.SkipReason)))
		return borderStyle.Width(width).Height(height).Render(b.String())
	}

	if file.Status == "pending" {
		b.WriteString(dimStyle.Render("Waiting..."))
		return borderStyle.Width(width).Height(height).Render(b.String())
	}

	if m.sideBySide {
		return m.renderSideBySide(&b, file, lang, width, height, isFocused, borderStyle)
	}
	return m.renderUnified(&b, file, lang, width, height, isFocused, borderStyle)
}

func (m model) renderUnified(b *strings.Builder, file *FileData, lang string, width, height int, isFocused bool, borderStyle lipgloss.Style) string {
	visibleLines := height - 5
	maxScroll := max(0, len(file.Lines)-visibleLines)
	if m.diffScroll > maxScroll {
		m.diffScroll = maxScroll
	}

	lineWidth := width - 4 // account for border

	for i := m.diffScroll; i < min(m.diffScroll+visibleLines, len(file.Lines)); i++ {
		line := file.Lines[i]

		// Handle hunk headers specially
		if line.ChangeType == "hunk" {
			hunkStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true).
				Background(lipgloss.Color("236"))
			hunkText := line.CodeLine
			hunkPadded := hunkText + strings.Repeat(" ", max(0, lineWidth-len(hunkText)))
			b.WriteString(hunkStyle.Render(hunkPadded))
			b.WriteString("\n")
			continue
		}

		// Line numbers
		oldNum := "    "
		newNum := "    "
		if line.OldLineNumber != nil {
			oldNum = fmt.Sprintf("%4d", *line.OldLineNumber)
		}
		if line.NewLineNumber != nil {
			newNum = fmt.Sprintf("%4d", *line.NewLineNumber)
		}

		// Code content with syntax highlighting
		code := line.CodeLine
		if code == "" {
			code = line.DiffLine
		}

		// Build the full line with background spanning entire width
		var lineStr string
		codeWidth := lineWidth - 12 // 4+1+4+1+1+1 = 12 for "NNNN NNNN X "

		// Pad/truncate code
		codePadded := code
		if len(code) < codeWidth {
			codePadded = code + strings.Repeat(" ", codeWidth-len(code))
		} else if len(code) > codeWidth {
			codePadded = code[:codeWidth-1] + "…"
		}

		switch line.ChangeType {
		case "add", "+":
			// Syntax highlight with preserved background
			highlighted := highlightLinePreserveBg(codePadded, lang)
			// Set background, then content, then padding
			prefix := fmt.Sprintf("%s %s + ", oldNum, newNum)
			// Calculate visible width for padding
			contentWidth := len(prefix) + lipgloss.Width(highlighted)
			padding := ""
			if contentWidth < lineWidth {
				padding = strings.Repeat(" ", lineWidth-contentWidth)
			}
			// Wrap entire line in background
			lineStr = addLineBg.Render(prefix + highlighted + padding)

		case "delete", "remove", "-":
			highlighted := highlightLinePreserveBg(codePadded, lang)
			prefix := fmt.Sprintf("%s %s - ", oldNum, newNum)
			contentWidth := len(prefix) + lipgloss.Width(highlighted)
			padding := ""
			if contentWidth < lineWidth {
				padding = strings.Repeat(" ", lineWidth-contentWidth)
			}
			lineStr = removeLineBg.Render(prefix + highlighted + padding)

		default: // context - normal syntax highlighting
			highlighted := highlightLine(codePadded, lang)
			lineStr = fmt.Sprintf("%s %s   %s",
				dimStyle.Render(oldNum),
				dimStyle.Render(newNum),
				highlighted,
			)
		}

		b.WriteString(lineStr)
		b.WriteString("\n")
	}

	// Scroll indicator
	if len(file.Lines) > visibleLines {
		m.renderScrollIndicator(b, visibleLines, len(file.Lines), isFocused)
	}

	return borderStyle.Width(width).Height(height).Render(b.String())
}

func (m model) renderSideBySide(b *strings.Builder, file *FileData, lang string, width, height int, isFocused bool, borderStyle lipgloss.Style) string {
	// Build paired lines for side-by-side view
	type sidePair struct {
		left  *LineData // old/deleted
		right *LineData // new/added
	}

	var pairs []sidePair
	var pendingDeletes []*LineData

	for i := range file.Lines {
		line := &file.Lines[i]

		if line.ChangeType == "hunk" {
			// Flush pending deletes
			for _, d := range pendingDeletes {
				pairs = append(pairs, sidePair{left: d, right: nil})
			}
			pendingDeletes = nil
			pairs = append(pairs, sidePair{left: line, right: line}) // hunk on both sides
		} else if line.ChangeType == "delete" {
			pendingDeletes = append(pendingDeletes, line)
		} else if line.ChangeType == "add" {
			if len(pendingDeletes) > 0 {
				// Pair with pending delete
				pairs = append(pairs, sidePair{left: pendingDeletes[0], right: line})
				pendingDeletes = pendingDeletes[1:]
			} else {
				pairs = append(pairs, sidePair{left: nil, right: line})
			}
		} else { // context
			// Flush pending deletes
			for _, d := range pendingDeletes {
				pairs = append(pairs, sidePair{left: d, right: nil})
			}
			pendingDeletes = nil
			pairs = append(pairs, sidePair{left: line, right: line})
		}
	}
	// Flush remaining deletes
	for _, d := range pendingDeletes {
		pairs = append(pairs, sidePair{left: d, right: nil})
	}

	visibleLines := height - 5
	maxScroll := max(0, len(pairs)-visibleLines)
	if m.diffScroll > maxScroll {
		m.diffScroll = maxScroll
	}

	halfWidth := (width - 3) / 2 // -3 for separator
	codeWidth := halfWidth - 6   // -6 for line number

	for i := m.diffScroll; i < min(m.diffScroll+visibleLines, len(pairs)); i++ {
		pair := pairs[i]

		// Handle hunk headers
		if pair.left != nil && pair.left.ChangeType == "hunk" {
			hunkStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("6")).Bold(true)
			hunkText := pair.left.CodeLine
			if len(hunkText) > width-4 {
				hunkText = hunkText[:width-5] + "…"
			}
			b.WriteString(hunkStyle.Render(hunkText))
			b.WriteString("\n")
			continue
		}

		// Left side (old)
		leftStr := m.renderSideLine(pair.left, lang, codeWidth, true)
		// Right side (new)
		rightStr := m.renderSideLine(pair.right, lang, codeWidth, false)

		b.WriteString(leftStr)
		b.WriteString(dimStyle.Render("│"))
		b.WriteString(rightStr)
		b.WriteString("\n")
	}

	// Scroll indicator
	if len(pairs) > visibleLines {
		m.renderScrollIndicator(b, visibleLines, len(pairs), isFocused)
	}

	return borderStyle.Width(width).Height(height).Render(b.String())
}

func (m model) renderSideLine(line *LineData, lang string, codeWidth int, isLeft bool) string {
	totalWidth := codeWidth + 5 // 4 for line number + 1 space

	if line == nil {
		// Empty side - fill with spaces
		return strings.Repeat(" ", totalWidth)
	}

	// Line number
	lineNum := "    "
	if isLeft && line.OldLineNumber != nil {
		lineNum = fmt.Sprintf("%4d", *line.OldLineNumber)
	} else if !isLeft && line.NewLineNumber != nil {
		lineNum = fmt.Sprintf("%4d", *line.NewLineNumber)
	}

	// Code content
	code := line.CodeLine
	if code == "" {
		code = line.DiffLine
	}

	// Pad/truncate code
	codePadded := code
	if len(code) < codeWidth {
		codePadded = code + strings.Repeat(" ", codeWidth-len(code))
	} else if len(code) > codeWidth {
		codePadded = code[:codeWidth-1] + "…"
	}

	switch line.ChangeType {
	case "add", "+":
		// Syntax highlight with preserved background
		highlighted := highlightLinePreserveBg(codePadded, lang)
		prefix := lineNum + " "
		contentWidth := len(prefix) + lipgloss.Width(highlighted)
		padding := ""
		if contentWidth < totalWidth {
			padding = strings.Repeat(" ", totalWidth-contentWidth)
		}
		return addLineBg.Render(prefix + highlighted + padding)

	case "delete", "remove", "-":
		highlighted := highlightLinePreserveBg(codePadded, lang)
		prefix := lineNum + " "
		contentWidth := len(prefix) + lipgloss.Width(highlighted)
		padding := ""
		if contentWidth < totalWidth {
			padding = strings.Repeat(" ", totalWidth-contentWidth)
		}
		return removeLineBg.Render(prefix + highlighted + padding)

	default:
		// Context lines get normal syntax highlighting
		highlighted := highlightLine(codePadded, lang)
		return dimStyle.Render(lineNum) + " " + highlighted
	}
}

func (m model) renderScrollIndicator(b *strings.Builder, visibleLines, totalLines int, isFocused bool) {
	upArrow := " "
	downArrow := " "
	if m.diffScroll > 0 {
		upArrow = "↑"
	}
	if m.diffScroll+visibleLines < totalLines {
		downArrow = "↓"
	}
	hint := ""
	if isFocused {
		hint = " (j/k scroll, s: toggle view)"
	}
	b.WriteString(dimStyle.Render(fmt.Sprintf("%s%s Lines %d-%d/%d%s",
		upArrow, downArrow,
		m.diffScroll+1, min(m.diffScroll+visibleLines, totalLines), totalLines,
		hint)))
}

func (m model) renderStatusBar() string {
	prUrl := fmt.Sprintf("%s/%s#%d", m.owner, m.repo, m.prNumber)
	paneIndicator := fmt.Sprintf("[%s]", strings.ToUpper(m.activePane))

	left := fmt.Sprintf("0github | %s | %s", prUrl, headerStyle.Render(paneIndicator))

	var status string
	if m.err != nil {
		status = lipgloss.NewStyle().Foreground(lipgloss.Color("1")).Render(fmt.Sprintf("Error: %v", m.err))
	} else if m.isComplete {
		totalLines := 0
		flagged := 0
		fileCount := 0
		for _, file := range m.files {
			if file.Status != "skipped" {
				fileCount++
				totalLines += len(file.Lines)
				for _, line := range file.Lines {
					if line.Score >= 50 {
						flagged++
					}
				}
			}
		}
		status = lipgloss.NewStyle().Foreground(lipgloss.Color("2")).Render(
			fmt.Sprintf("%d files | %d lines | %d flagged", fileCount, totalLines, flagged))
	} else if m.aiAnnotating {
		status = lipgloss.NewStyle().Foreground(lipgloss.Color("3")).Render("AI analyzing...")
	} else if m.githubLoaded {
		status = lipgloss.NewStyle().Foreground(lipgloss.Color("4")).Render("GitHub loaded, waiting for AI...")
	} else {
		status = lipgloss.NewStyle().Foreground(lipgloss.Color("3")).Render("Loading GitHub...")
	}

	controls := dimStyle.Render(" | Tab: switch | t: tooltips | q: quit")

	right := status + controls

	gap := max(0, m.width-lipgloss.Width(left)-lipgloss.Width(right)-2)
	return statusBarStyle.Render(left + strings.Repeat(" ", gap) + right)
}

// Language detection
func getLanguageFromPath(filePath string) string {
	ext := strings.ToLower(filepath.Ext(filePath))
	if ext != "" {
		ext = ext[1:] // remove dot
	}

	langMap := map[string]string{
		"ts": "typescript", "tsx": "typescript",
		"js": "javascript", "jsx": "javascript",
		"py": "python", "rb": "ruby", "rs": "rust",
		"go": "go", "java": "java", "c": "c",
		"cpp": "cpp", "h": "c", "hpp": "cpp",
		"cs": "csharp", "php": "php", "swift": "swift",
		"kt": "kotlin", "scala": "scala",
		"sh": "bash", "bash": "bash", "zsh": "bash",
		"yml": "yaml", "yaml": "yaml", "json": "json",
		"xml": "xml", "html": "html", "css": "css",
		"scss": "scss", "sql": "sql", "md": "markdown",
	}

	if lang, ok := langMap[ext]; ok {
		return lang
	}
	return ""
}

// Syntax highlighting
func highlightLine(code, lang string) string {
	lexer := lexers.Get(lang)
	if lexer == nil {
		return code
	}

	style := styles.Get("monokai")
	if style == nil {
		style = styles.Fallback
	}

	formatter := formatters.Get("terminal256")
	if formatter == nil {
		return code
	}

	iterator, err := lexer.Tokenise(nil, code)
	if err != nil {
		return code
	}

	var b strings.Builder
	err = formatter.Format(&b, style, iterator)
	if err != nil {
		return code
	}

	return b.String()
}

// highlightLinePreserveBg applies syntax highlighting but replaces reset codes
// to preserve background color. Use this when rendering on colored backgrounds.
func highlightLinePreserveBg(code, lang string) string {
	highlighted := highlightLine(code, lang)
	// Replace [0m (reset all) with [39m (reset foreground only)
	// This preserves the background color
	return strings.ReplaceAll(highlighted, "\x1b[0m", "\x1b[39m")
}

// Git helper functions

// getGitRemoteURL returns the origin remote URL
func getGitRemoteURL() (string, error) {
	cmd := exec.Command("git", "remote", "get-url", "origin")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("not a git repository or no origin remote: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}

// parseGitRemote extracts owner/repo from a git remote URL
func parseGitRemote(remoteURL string) (owner, repo string, err error) {
	// SSH format: git@github.com:owner/repo.git
	re := regexp.MustCompile(`git@github\.com[:/]([\w.-]+)/([\w.-]+?)(?:\.git)?$`)
	if matches := re.FindStringSubmatch(remoteURL); matches != nil {
		return matches[1], matches[2], nil
	}

	// HTTPS format: https://github.com/owner/repo.git
	re = regexp.MustCompile(`github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?$`)
	if matches := re.FindStringSubmatch(remoteURL); matches != nil {
		return matches[1], matches[2], nil
	}

	return "", "", fmt.Errorf("could not parse GitHub remote URL: %s", remoteURL)
}

// getCurrentBranch returns the current git branch name
func getCurrentBranch() (string, error) {
	cmd := exec.Command("git", "rev-parse", "--abbrev-ref", "HEAD")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("could not get current branch: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}

// GitHubPR represents a PR from the GitHub API
type GitHubPR struct {
	Number int    `json:"number"`
	Title  string `json:"title"`
	State  string `json:"state"`
	Head   struct {
		Ref string `json:"ref"`
	} `json:"head"`
}

// GitHubFile represents a file in a PR from the GitHub API
type GitHubFile struct {
	Filename  string `json:"filename"`
	Status    string `json:"status"` // added, removed, modified, renamed
	Additions int    `json:"additions"`
	Deletions int    `json:"deletions"`
	Patch     string `json:"patch"`
}

// fetchGitHubPRFiles fetches all files in a PR from GitHub API
func fetchGitHubPRFiles(owner, repo string, prNumber int) ([]GitHubFile, error) {
	var allFiles []GitHubFile
	page := 1
	perPage := 100

	for {
		url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls/%d/files?per_page=%d&page=%d",
			owner, repo, prNumber, perPage, page)

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Accept", "application/vnd.github.v3+json")

		if token := os.Getenv("GITHUB_TOKEN"); token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		} else if token := os.Getenv("GH_TOKEN"); token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}

		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to fetch PR files: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
		}

		var files []GitHubFile
		if err := json.NewDecoder(resp.Body).Decode(&files); err != nil {
			return nil, fmt.Errorf("failed to parse PR files: %w", err)
		}

		allFiles = append(allFiles, files...)

		if len(files) < perPage {
			break
		}
		page++
	}

	return allFiles, nil
}

// parseDiffPatch parses a unified diff patch into lines
func parseDiffPatch(patch, filePath string) []LineData {
	if patch == "" {
		return nil
	}

	var lines []LineData
	patchLines := strings.Split(patch, "\n")

	var oldLine, newLine int

	for _, line := range patchLines {
		if len(line) == 0 {
			continue
		}

		// Parse hunk header: @@ -start,count +start,count @@
		if strings.HasPrefix(line, "@@") {
			re := regexp.MustCompile(`@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@`)
			if matches := re.FindStringSubmatch(line); matches != nil {
				oldLine, _ = strconv.Atoi(matches[1])
				newLine, _ = strconv.Atoi(matches[2])
			}
			// Add hunk header as context
			lines = append(lines, LineData{
				ChangeType: "hunk",
				DiffLine:   line,
				CodeLine:   line,
			})
			continue
		}

		var changeType string
		var codeLine string
		var oldNum, newNum *int

		if strings.HasPrefix(line, "+") {
			changeType = "add"
			codeLine = line[1:]
			newNum = &newLine
			newLine++
		} else if strings.HasPrefix(line, "-") {
			changeType = "delete"
			codeLine = line[1:]
			oldNum = &oldLine
			oldLine++
		} else if strings.HasPrefix(line, " ") || len(line) > 0 {
			changeType = "context"
			if len(line) > 0 && line[0] == ' ' {
				codeLine = line[1:]
			} else {
				codeLine = line
			}
			oldNum = &oldLine
			newNum = &newLine
			oldLine++
			newLine++
		} else {
			continue
		}

		// Copy values to avoid pointer issues
		var oldNumCopy, newNumCopy *int
		if oldNum != nil {
			v := *oldNum
			oldNumCopy = &v
		}
		if newNum != nil {
			v := *newNum
			newNumCopy = &v
		}

		lines = append(lines, LineData{
			ChangeType:    changeType,
			DiffLine:      line,
			CodeLine:      codeLine,
			OldLineNumber: oldNumCopy,
			NewLineNumber: newNumCopy,
		})
	}

	return lines
}

// findPRForBranch finds the PR number for a given branch
func findPRForBranch(owner, repo, branch string) (int, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/%s/pulls?head=%s:%s&state=open",
		owner, repo, owner, branch)

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")

	// Try to use GITHUB_TOKEN if available
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	} else if token := os.Getenv("GH_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("failed to query GitHub API: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return 0, fmt.Errorf("GitHub API returned status %d", resp.StatusCode)
	}

	var prs []GitHubPR
	if err := json.NewDecoder(resp.Body).Decode(&prs); err != nil {
		return 0, fmt.Errorf("failed to parse GitHub response: %w", err)
	}

	if len(prs) == 0 {
		return 0, fmt.Errorf("no open PR found for branch '%s'", branch)
	}

	return prs[0].Number, nil
}

// detectPRFromCurrentDir detects the PR from the current git directory
func detectPRFromCurrentDir() (owner, repo string, prNumber int, err error) {
	remoteURL, err := getGitRemoteURL()
	if err != nil {
		return "", "", 0, err
	}

	owner, repo, err = parseGitRemote(remoteURL)
	if err != nil {
		return "", "", 0, err
	}

	branch, err := getCurrentBranch()
	if err != nil {
		return "", "", 0, err
	}

	if branch == "main" || branch == "master" {
		return "", "", 0, fmt.Errorf("cannot detect PR from main/master branch - please checkout a feature branch or specify PR URL")
	}

	prNumber, err = findPRForBranch(owner, repo, branch)
	if err != nil {
		return "", "", 0, err
	}

	return owner, repo, prNumber, nil
}

// Parse PR URL
func parsePRUrl(input string) (owner, repo string, prNumber int, err error) {
	// Support "." to auto-detect from current directory
	if input == "." {
		return detectPRFromCurrentDir()
	}

	// Full URL: https://github.com/owner/repo/pull/123
	re := regexp.MustCompile(`(?:github\.com|0github\.com)/([\w.-]+)/([\w.-]+)/pull/(\d+)`)
	if matches := re.FindStringSubmatch(input); matches != nil {
		prNumber, _ = strconv.Atoi(matches[3])
		return matches[1], matches[2], prNumber, nil
	}

	// Short format: owner/repo#123
	re = regexp.MustCompile(`^([\w.-]+)/([\w.-]+)#(\d+)$`)
	if matches := re.FindStringSubmatch(input); matches != nil {
		prNumber, _ = strconv.Atoi(matches[3])
		return matches[1], matches[2], prNumber, nil
	}

	return "", "", 0, fmt.Errorf("invalid PR URL format. Use: PR URL, owner/repo#123, or '.' to detect from current repo")
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: 0github <pr-url|.>")
		fmt.Println("  pr-url: https://github.com/owner/repo/pull/123 or owner/repo#123")
		fmt.Println("  .     : Auto-detect PR from current git branch")
		os.Exit(1)
	}

	if os.Args[1] == "--legend" || os.Args[1] == "-h" || os.Args[1] == "--help" {
		fmt.Println("\nUsage: 0github <pr-url|.>")
		fmt.Println("  pr-url: https://github.com/owner/repo/pull/123 or owner/repo#123")
		fmt.Println("  .     : Auto-detect PR from current git branch")
		fmt.Println("\nScore Legend:")
		fmt.Println("    0-10  - Minimal attention needed")
		fmt.Println("   11-25  - Low attention")
		fmt.Println("   26-40  - Moderate attention")
		fmt.Println("   41-60  - Notable concern")
		fmt.Println("   61-80  - High attention needed")
		fmt.Println("   81-100 - Critical review required")
		fmt.Println("\nControls:")
		fmt.Println("  j/k or ↑/↓  - Navigate")
		fmt.Println("  J/K         - Page up/down")
		fmt.Println("  Tab         - Switch between file list and diff")
		fmt.Println("  Enter/l/→   - Focus diff view")
		fmt.Println("  h/←         - Focus file list")
		fmt.Println("  [/]         - Prev/next file")
		fmt.Println("  s           - Toggle unified/side-by-side view")
		fmt.Println("  g/G         - Go to top/bottom")
		fmt.Println("  q           - Quit")
		return
	}

	owner, repo, prNumber, err := parsePRUrl(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Show detected PR info if using "."
	if os.Args[1] == "." {
		fmt.Fprintf(os.Stderr, "Detected PR: %s/%s#%d\n", owner, repo, prNumber)
	}

	m := initialModel(owner, repo, prNumber)

	p := tea.NewProgram(m, tea.WithAltScreen())

	// TODO: Re-enable 0github AI annotations later
	// sseEventChan = make(chan SSEEvent, 100)
	// go func() { ... }()

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
