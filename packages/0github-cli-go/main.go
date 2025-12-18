package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
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
	minSidebarWidth = 36
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

// highlightToken finds and highlights a specific token in the code
func highlightToken(code string, token *string, score int) string {
	if token == nil || *token == "" || score <= 10 {
		return code
	}

	style := getScoreStyle(score)

	// Find the token in the code (case-sensitive first, then case-insensitive)
	idx := strings.Index(code, *token)
	if idx == -1 {
		// Try case-insensitive
		lowerCode := strings.ToLower(code)
		lowerToken := strings.ToLower(*token)
		idx = strings.Index(lowerCode, lowerToken)
		if idx == -1 {
			return code
		}
	}

	// Highlight the token
	before := code[:idx]
	highlighted := style.Render(code[idx : idx+len(*token)])
	after := code[idx+len(*token):]

	return before + highlighted + after
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

// Model
type model struct {
	owner       string
	repo        string
	prNumber    int
	files       map[string]*FileData
	fileOrder   []string
	isComplete  bool
	err         error
	width       int
	height      int
	activePane  string // "files" or "diff"
	fileIndex   int
	diffScroll  int
	showTooltip bool
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
	return m.startSSE()
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

	case sseEventMsg:
		event := SSEEvent(msg)
		switch event.Type {
		case "file":
			if _, exists := m.files[event.FilePath]; !exists {
				m.fileOrder = append(m.fileOrder, event.FilePath)
				m.files[event.FilePath] = &FileData{
					FilePath: event.FilePath,
					Status:   "streaming",
					Lines:    []LineData{},
				}
			} else {
				m.files[event.FilePath].Status = "streaming"
			}
		case "skip":
			if _, exists := m.files[event.FilePath]; !exists {
				m.fileOrder = append(m.fileOrder, event.FilePath)
			}
			m.files[event.FilePath] = &FileData{
				FilePath:   event.FilePath,
				Status:     "skipped",
				SkipReason: event.Reason,
				Lines:      []LineData{},
			}
		case "line":
			if file, exists := m.files[event.FilePath]; exists {
				line := LineData{
					ChangeType:        event.ChangeType,
					DiffLine:          event.DiffLine,
					CodeLine:          event.CodeLine,
					MostImportantWord: event.MostImportantWord,
					ShouldReviewWhy:   event.ShouldReviewWhy,
					Score:             event.Score,
					ScoreNormalized:   event.ScoreNormalized,
					OldLineNumber:     event.OldLineNumber,
					NewLineNumber:     event.NewLineNumber,
				}
				file.Lines = append(file.Lines, line)
				if event.Score > file.MaxScore {
					file.MaxScore = event.Score
				}
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
			return m, nil
		case "error":
			m.err = fmt.Errorf("%s", event.Message)
			return m, nil
		}
		return m, listenSSE(sseEventChan)

	case sseErrorMsg:
		m.err = msg.err
		return m, nil

	case sseDoneMsg:
		m.isComplete = true
		return m, nil
	}

	return m, nil
}

func (m model) View() string {
	if m.width == 0 {
		return "Loading..."
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

		// Truncate filename
		maxNameLen := width - 12
		if len(fileName) > maxNameLen {
			fileName = fileName[:maxNameLen-1] + "…"
		}

		// Score
		scoreStr := ""
		if file.MaxScore > 0 {
			scoreStr = fmt.Sprintf("%3d", file.MaxScore)
		}

		line := fmt.Sprintf("%s %-*s %s", iconStyle.Render(icon), maxNameLen, fileName, scoreStr)

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

	header := fmt.Sprintf("%s%s", arrow, file.FilePath)
	headerRight := fmt.Sprintf("%d lines%s", len(file.Lines), langTag)
	if file.MaxScore > 0 {
		headerRight = fmt.Sprintf("%d lines (max: %d)%s", len(file.Lines), file.MaxScore, langTag)
	}

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

	// Render lines
	visibleLines := height - 5
	maxScroll := max(0, len(file.Lines)-visibleLines)
	if m.diffScroll > maxScroll {
		m.diffScroll = maxScroll
	}

	for i := m.diffScroll; i < min(m.diffScroll+visibleLines, len(file.Lines)); i++ {
		line := file.Lines[i]

		// Line numbers
		oldNum := "    "
		newNum := "    "
		if line.OldLineNumber != nil {
			oldNum = fmt.Sprintf("%4d", *line.OldLineNumber)
		}
		if line.NewLineNumber != nil {
			newNum = fmt.Sprintf("%4d", *line.NewLineNumber)
		}

		// Change indicator
		var changeChar string
		var changeStyle lipgloss.Style
		switch line.ChangeType {
		case "+":
			changeChar = "+"
			changeStyle = addStyle
		case "-":
			changeChar = "-"
			changeStyle = removeStyle
		default:
			changeChar = " "
			changeStyle = dimStyle
		}

		// Code - highlight the important token directly
		code := line.CodeLine
		if code == "" {
			code = line.DiffLine
		}

		// Highlight the most important word with score-based color
		code = highlightToken(code, line.MostImportantWord, line.Score)

		// Truncate if needed (be careful with ANSI codes)
		maxCodeLen := width - 16
		visibleLen := lipgloss.Width(code)
		if visibleLen > maxCodeLen {
			// Simple truncation - may cut ANSI codes but generally works
			code = code[:min(len(code), maxCodeLen*2)] + "…"
		}

		lineStr := fmt.Sprintf("%s %s %s %s",
			dimStyle.Render(oldNum),
			dimStyle.Render(newNum),
			changeStyle.Render(changeChar),
			code,
		)

		// Add tooltip
		if m.showTooltip && line.Score > 0 && line.ShouldReviewWhy != nil {
			lineStr += dimStyle.Italic(true).Render(fmt.Sprintf(" # %s", *line.ShouldReviewWhy))
		}

		b.WriteString(lineStr)
		b.WriteString("\n")
	}

	// Scroll indicator
	if len(file.Lines) > visibleLines {
		upArrow := " "
		downArrow := " "
		if m.diffScroll > 0 {
			upArrow = "↑"
		}
		if m.diffScroll+visibleLines < len(file.Lines) {
			downArrow = "↓"
		}
		hint := ""
		if isFocused {
			hint = " (j/k scroll, [/] files)"
		}
		b.WriteString(dimStyle.Render(fmt.Sprintf("%s%s Lines %d-%d/%d%s",
			upArrow, downArrow,
			m.diffScroll+1, min(m.diffScroll+visibleLines, len(file.Lines)), len(file.Lines),
			hint)))
	}

	return borderStyle.Width(width).Height(height).Render(b.String())
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
	} else {
		status = lipgloss.NewStyle().Foreground(lipgloss.Color("3")).Render("Loading...")
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

// Parse PR URL
func parsePRUrl(input string) (owner, repo string, prNumber int, err error) {
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

	return "", "", 0, fmt.Errorf("invalid PR URL format")
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("Usage: 0github <pr-url>")
		fmt.Println("  pr-url: https://github.com/owner/repo/pull/123 or owner/repo#123")
		os.Exit(1)
	}

	if os.Args[1] == "--legend" || os.Args[1] == "-h" || os.Args[1] == "--help" {
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
		fmt.Println("  t           - Toggle tooltips")
		fmt.Println("  g/G         - Go to top/bottom")
		fmt.Println("  q           - Quit")
		return
	}

	owner, repo, prNumber, err := parsePRUrl(os.Args[1])
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Initialize SSE channel
	sseEventChan = make(chan SSEEvent, 100)

	m := initialModel(owner, repo, prNumber)

	p := tea.NewProgram(m, tea.WithAltScreen())

	// Start SSE streaming in background
	go func() {
		url := fmt.Sprintf("%s/api/pr-review/simple?repoFullName=%s/%s&prNumber=%d",
			apiBaseURL, owner, repo, prNumber)

		resp, err := http.Get(url)
		if err != nil {
			sseEventChan <- SSEEvent{Type: "error", Message: err.Error()}
			close(sseEventChan)
			return
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

			sseEventChan <- event
		}
		close(sseEventChan)
	}()

	// Start listening for events
	go func() {
		for event := range sseEventChan {
			p.Send(sseEventMsg(event))
		}
		p.Send(sseDoneMsg{})
	}()

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}
