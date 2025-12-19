#!/usr/bin/env node

import React, { useState, useEffect, useMemo } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import { program } from "commander";
import chalk from "chalk";
import { highlight } from "cli-highlight";

const API_BASE_URL = process.env.ZERO_GITHUB_API_URL ?? "https://0github.com";

const MIN_SIDEBAR_WIDTH = 36;

// Types
interface LineData {
  changeType: "+" | "-" | " ";
  diffLine: string;
  codeLine: string;
  mostImportantWord: string | null;
  shouldReviewWhy: string | null;
  score: number;
  scoreNormalized: number;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

interface FileData {
  filePath: string;
  status: "pending" | "streaming" | "complete" | "skipped" | "error";
  skipReason?: string;
  lines: LineData[];
  maxScore: number;
}

interface ReviewState {
  files: Map<string, FileData>;
  fileOrder: string[];
  isComplete: boolean;
  error: string | null;
}

// SSE streaming
async function* streamSSE(
  url: string,
  signal?: AbortSignal
): AsyncGenerator<Record<string, unknown>> {
  const response = await fetch(url, { signal });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const body = response.body;
  if (!body) {
    throw new Error("Response body missing");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf("\n\n");

        const lines = rawEvent.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data.length === 0) continue;
          try {
            yield JSON.parse(data) as Record<string, unknown>;
          } catch {
            // Skip malformed JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Parse GitHub PR URL
function parseGitHubPrUrl(input: string): {
  owner: string;
  repo: string;
  prNumber: number;
} | null {
  const urlMatch = input.match(
    /(?:github\.com|0github\.com)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      prNumber: parseInt(urlMatch[3], 10),
    };
  }

  const shortMatch = input.match(/^([\w.-]+)\/([\w.-]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      prNumber: parseInt(shortMatch[3], 10),
    };
  }

  return null;
}

// Get language from file extension for syntax highlighting
function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    yml: "yaml",
    yaml: "yaml",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    scss: "scss",
    less: "less",
    sql: "sql",
    md: "markdown",
    dockerfile: "dockerfile",
    makefile: "makefile",
    toml: "toml",
    ini: "ini",
    vue: "vue",
    svelte: "svelte",
  };
  return ext ? langMap[ext] : undefined;
}

// Syntax highlight a line of code
function highlightCode(code: string, language?: string): string {
  if (!language || !code.trim()) return code;
  try {
    // Strip the diff prefix (+/-/space) for highlighting, then restore
    const prefix = code.match(/^[+\- ]/)?.[0] || "";
    const codeWithoutPrefix = code.slice(prefix.length);
    const highlighted = highlight(codeWithoutPrefix, {
      language,
      ignoreIllegals: true,
    });
    return prefix + highlighted;
  } catch {
    return code;
  }
}

// Color helpers
function getScoreColor(score: number): string {
  if (score <= 10) return "gray";
  if (score <= 25) return "green";
  if (score <= 40) return "yellow";
  if (score <= 60) return "#FFA500"; // orange
  if (score <= 80) return "red";
  return "magenta";
}

function getScoreBgColor(score: number): string | undefined {
  if (score <= 10) return undefined;
  if (score <= 25) return "green";
  if (score <= 40) return "yellow";
  if (score <= 60) return "#FFA500";
  if (score <= 80) return "red";
  return "magenta";
}

// Components
interface FileListProps {
  files: FileData[];
  selectedIndex: number;
  height: number;
  isFocused: boolean;
}

function FileList({ files, selectedIndex, height, isFocused }: FileListProps) {
  const visibleItems = height - 3;
  const scrollOffset = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(visibleItems / 2), files.length - visibleItems)
  );

  const visibleFiles = files.slice(scrollOffset, scrollOffset + visibleItems);

  return (
    <Box
      flexDirection="column"
      width={MIN_SIDEBAR_WIDTH}
      minWidth={MIN_SIDEBAR_WIDTH}
      borderStyle="single"
      borderColor={isFocused ? "cyan" : "gray"}
    >
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color={isFocused ? "cyan" : "white"}>
          {isFocused ? "▶ " : "  "}Files ({files.length})
        </Text>
      </Box>
      {visibleFiles.map((file, i) => {
        const actualIndex = scrollOffset + i;
        const isSelected = actualIndex === selectedIndex;
        const fileName = file.filePath.split("/").pop() || file.filePath;

        let statusIcon = "○";
        let statusColor: string = "gray";
        if (file.status === "streaming") {
          statusIcon = "◐";
          statusColor = "blue";
        } else if (file.status === "complete") {
          statusIcon = "●";
          statusColor = file.maxScore > 60 ? "red" : file.maxScore > 30 ? "yellow" : "green";
        } else if (file.status === "skipped") {
          statusIcon = "⊘";
          statusColor = "gray";
        } else if (file.status === "error") {
          statusIcon = "✗";
          statusColor = "red";
        }

        const maxNameLen = MIN_SIDEBAR_WIDTH - 10;
        const displayName = fileName.length > maxNameLen
          ? fileName.slice(0, maxNameLen - 1) + "…"
          : fileName.padEnd(maxNameLen);

        return (
          <Box key={file.filePath} paddingX={1}>
            <Text
              backgroundColor={isSelected ? (isFocused ? "blue" : "gray") : undefined}
              color={isSelected ? "white" : undefined}
            >
              <Text color={statusColor}>{statusIcon}</Text>
              {" "}
              <Text bold={isSelected}>{displayName}</Text>
              {file.maxScore > 0 && (
                <Text color={getScoreColor(file.maxScore)} dimColor={!isSelected}>
                  {String(file.maxScore).padStart(3)}
                </Text>
              )}
            </Text>
          </Box>
        );
      })}
      {files.length === 0 && (
        <Box paddingX={1}>
          <Text dimColor>No files yet...</Text>
        </Box>
      )}
      {files.length > visibleItems && (
        <Box paddingX={1}>
          <Text dimColor>
            {scrollOffset > 0 ? "↑" : " "}
            {scrollOffset + visibleItems < files.length ? "↓" : " "}
            {" "}
            {scrollOffset + 1}-{Math.min(scrollOffset + visibleItems, files.length)}/{files.length}
          </Text>
        </Box>
      )}
    </Box>
  );
}

interface DiffViewProps {
  file: FileData | null;
  scrollOffset: number;
  height: number;
  showTooltips: boolean;
  isFocused: boolean;
}

function DiffView({ file, scrollOffset, height, showTooltips, isFocused }: DiffViewProps) {
  const visibleLines = height - 4;

  // Get language for syntax highlighting
  const language = file ? getLanguageFromPath(file.filePath) : undefined;

  // Memoize highlighted lines
  const highlightedLines = useMemo(() => {
    if (!file || !language) return null;
    return file.lines.map((line) => ({
      ...line,
      highlightedCode: highlightCode(line.codeLine || line.diffLine || "", language),
    }));
  }, [file, language]);

  if (!file) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderColor={isFocused ? "cyan" : "gray"}
      >
        <Box paddingX={1}>
          <Text dimColor>Select a file to view diff</Text>
        </Box>
      </Box>
    );
  }

  if (file.status === "skipped") {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderColor={isFocused ? "cyan" : "gray"}
      >
        <Box paddingX={1}>
          <Text bold color={isFocused ? "cyan" : "white"}>
            {isFocused ? "▶ " : "  "}{file.filePath}
          </Text>
        </Box>
        <Box paddingX={1} paddingY={1}>
          <Text dimColor>Skipped: {file.skipReason || "unknown reason"}</Text>
        </Box>
      </Box>
    );
  }

  if (file.status === "pending") {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        borderStyle="single"
        borderColor={isFocused ? "cyan" : "gray"}
      >
        <Box paddingX={1}>
          <Text bold color={isFocused ? "cyan" : "white"}>
            {isFocused ? "▶ " : "  "}{file.filePath}
          </Text>
        </Box>
        <Box paddingX={1} paddingY={1}>
          <Text dimColor>Waiting...</Text>
        </Box>
      </Box>
    );
  }

  const linesToRender = highlightedLines || file.lines;
  const visibleFileLines = linesToRender.slice(scrollOffset, scrollOffset + visibleLines);

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      borderStyle="single"
      borderColor={isFocused ? "cyan" : "gray"}
    >
      <Box paddingX={1} justifyContent="space-between">
        <Text bold color={isFocused ? "cyan" : "white"}>
          {isFocused ? "▶ " : "  "}{file.filePath}
        </Text>
        <Text dimColor>
          {file.lines.length} lines
          {file.maxScore > 0 && (
            <Text color={getScoreColor(file.maxScore)}> (max: {file.maxScore})</Text>
          )}
          {language && <Text color="gray"> [{language}]</Text>}
        </Text>
      </Box>
      <Box flexDirection="column" paddingX={1} overflow="hidden">
        {visibleFileLines.map((line, i) => {
          const actualIndex = scrollOffset + i;
          const oldNum = line.oldLineNumber?.toString().padStart(4) || "    ";
          const newNum = line.newLineNumber?.toString().padStart(4) || "    ";

          let changeChar = " ";
          let changeColor: string = "gray";
          if (line.changeType === "+") {
            changeChar = "+";
            changeColor = "green";
          } else if (line.changeType === "-") {
            changeChar = "-";
            changeColor = "red";
          }

          const scoreBg = getScoreBgColor(line.score);
          const scoreText = line.score > 0 ? String(line.score).padStart(3) : "   ";

          // Use highlighted code if available
          const displayCode = "highlightedCode" in line
            ? (line as typeof line & { highlightedCode: string }).highlightedCode
            : (line.codeLine || line.diffLine || "");

          // Unique key
          const lineKey = `${actualIndex}-${line.oldLineNumber ?? "x"}-${line.newLineNumber ?? "x"}`;

          return (
            <Box key={lineKey}>
              <Text dimColor>{oldNum} {newNum} </Text>
              <Text color={changeColor} bold>{changeChar}</Text>
              <Text> </Text>
              {line.score > 0 ? (
                <Text backgroundColor={scoreBg} color={scoreBg ? "black" : undefined}>
                  {scoreText}
                </Text>
              ) : (
                <Text dimColor>{scoreText}</Text>
              )}
              <Text> </Text>
              <Text>{displayCode}</Text>
              {showTooltips && line.score > 0 && line.shouldReviewWhy && (
                <Text dimColor italic> # {line.shouldReviewWhy}</Text>
              )}
            </Box>
          );
        })}
      </Box>
      {file.lines.length > visibleLines && (
        <Box paddingX={1}>
          <Text dimColor>
            {scrollOffset > 0 ? "↑" : " "}
            {scrollOffset + visibleLines < file.lines.length ? "↓" : " "}
            {" "}
            Lines {scrollOffset + 1}-{Math.min(scrollOffset + visibleLines, file.lines.length)}/{file.lines.length}
            {isFocused && " (j/k scroll, J/K page, [/] files)"}
          </Text>
        </Box>
      )}
    </Box>
  );
}

interface StatusBarProps {
  prUrl: string;
  isComplete: boolean;
  error: string | null;
  fileCount: number;
  totalLines: number;
  highScoreCount: number;
  activePane: "files" | "diff";
}

function StatusBar({
  prUrl,
  isComplete,
  error,
  fileCount,
  totalLines,
  highScoreCount,
  activePane,
}: StatusBarProps) {
  return (
    <Box paddingX={1} justifyContent="space-between">
      <Text>
        <Text bold color="cyan">0github</Text>
        <Text dimColor> | </Text>
        <Text>{prUrl}</Text>
        <Text dimColor> | </Text>
        <Text color="cyan">[{activePane === "files" ? "FILES" : "DIFF"}]</Text>
      </Text>
      <Text>
        {error ? (
          <Text color="red">Error: {error}</Text>
        ) : isComplete ? (
          <Text color="green">
            {fileCount} files | {totalLines} lines | {highScoreCount} flagged
          </Text>
        ) : (
          <Text color="yellow">Loading...</Text>
        )}
        <Text dimColor> | Tab: switch | t: tooltips | q: quit</Text>
      </Text>
    </Box>
  );
}

interface AppProps {
  owner: string;
  repo: string;
  prNumber: number;
  showTooltips: boolean;
}

function App({ owner, repo, prNumber, showTooltips: initialShowTooltips }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, setState] = useState<ReviewState>({
    files: new Map(),
    fileOrder: [],
    isComplete: false,
    error: null,
  });
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [diffScrollOffset, setDiffScrollOffset] = useState(0);
  const [activePane, setActivePane] = useState<"files" | "diff">("files");
  const [showTooltips, setShowTooltips] = useState(initialShowTooltips);

  const height = stdout?.rows || 24;
  const prUrl = `${owner}/${repo}#${prNumber}`;

  // Fetch and stream data
  useEffect(() => {
    const controller = new AbortController();

    const params = new URLSearchParams({
      repoFullName: `${owner}/${repo}`,
      prNumber: String(prNumber),
    });

    const url = `${API_BASE_URL}/api/pr-review/simple?${params.toString()}`;

    (async () => {
      try {
        for await (const event of streamSSE(url, controller.signal)) {
          const type = event.type as string;

          setState((prev) => {
            const files = new Map(prev.files);
            const fileOrder = [...prev.fileOrder];

            switch (type) {
              case "file": {
                const filePath = event.filePath as string;
                if (!files.has(filePath)) {
                  fileOrder.push(filePath);
                }
                files.set(filePath, {
                  filePath,
                  status: "streaming",
                  lines: files.get(filePath)?.lines || [],
                  maxScore: files.get(filePath)?.maxScore || 0,
                });
                break;
              }

              case "skip": {
                const filePath = event.filePath as string;
                if (!files.has(filePath)) {
                  fileOrder.push(filePath);
                }
                files.set(filePath, {
                  filePath,
                  status: "skipped",
                  skipReason: event.reason as string,
                  lines: [],
                  maxScore: 0,
                });
                break;
              }

              case "line": {
                const filePath = event.filePath as string;
                const existing = files.get(filePath);
                const lineData: LineData = {
                  changeType: event.changeType as "+" | "-" | " ",
                  diffLine: event.diffLine as string,
                  codeLine: event.codeLine as string,
                  mostImportantWord: event.mostImportantWord as string | null,
                  shouldReviewWhy: event.shouldReviewWhy as string | null,
                  score: event.score as number,
                  scoreNormalized: event.scoreNormalized as number,
                  oldLineNumber: event.oldLineNumber as number | null,
                  newLineNumber: event.newLineNumber as number | null,
                };
                const lines = [...(existing?.lines || []), lineData];
                const maxScore = Math.max(existing?.maxScore || 0, lineData.score);
                files.set(filePath, {
                  filePath,
                  status: "streaming",
                  lines,
                  maxScore,
                });
                break;
              }

              case "file-complete": {
                const filePath = event.filePath as string;
                const existing = files.get(filePath);
                if (existing) {
                  files.set(filePath, {
                    ...existing,
                    status: event.status === "error" ? "error" : "complete",
                  });
                }
                break;
              }

              case "complete": {
                return { ...prev, files, fileOrder, isComplete: true };
              }

              case "error": {
                return { ...prev, files, fileOrder, error: event.message as string };
              }
            }

            return { ...prev, files, fileOrder };
          });
        }
      } catch (err) {
        if (err instanceof Error && err.name !== "AbortError") {
          setState((prev) => ({ ...prev, error: err.message }));
        }
      }
    })();

    return () => controller.abort();
  }, [owner, repo, prNumber]);

  // Get files as array
  const filesArray = state.fileOrder.map((fp) => state.files.get(fp)!).filter(Boolean);
  const selectedFile = filesArray[selectedFileIndex] || null;

  // Calculate stats
  const totalLines = filesArray.reduce((sum, f) => sum + f.lines.length, 0);
  const highScoreCount = filesArray.reduce(
    (sum, f) => sum + f.lines.filter((l) => l.score >= 50).length,
    0
  );

  // Reset scroll when file changes
  useEffect(() => {
    setDiffScrollOffset(0);
  }, [selectedFileIndex]);

  // Keyboard handling
  useInput((input, key) => {
    if (input === "q") {
      exit();
      return;
    }

    if (input === "t") {
      setShowTooltips((v) => !v);
      return;
    }

    if (key.tab) {
      setActivePane((p) => (p === "files" ? "diff" : "files"));
      return;
    }

    const visibleDiffLines = height - 6;

    if (activePane === "files") {
      if (input === "j" || key.downArrow) {
        setSelectedFileIndex((i) => Math.min(i + 1, filesArray.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedFileIndex((i) => Math.max(i - 1, 0));
      } else if (input === "J" || key.pageDown) {
        setSelectedFileIndex((i) => Math.min(i + 10, filesArray.length - 1));
      } else if (input === "K" || key.pageUp) {
        setSelectedFileIndex((i) => Math.max(i - 10, 0));
      } else if (input === "g") {
        setSelectedFileIndex(0);
      } else if (input === "G") {
        setSelectedFileIndex(filesArray.length - 1);
      } else if (key.return || input === "l" || key.rightArrow) {
        setActivePane("diff");
      }
    } else {
      // diff pane
      if (input === "j" || key.downArrow) {
        if (selectedFile) {
          setDiffScrollOffset((o) =>
            Math.min(o + 1, Math.max(0, selectedFile.lines.length - visibleDiffLines))
          );
        }
      } else if (input === "k" || key.upArrow) {
        setDiffScrollOffset((o) => Math.max(o - 1, 0));
      } else if (input === "J" || key.pageDown) {
        if (selectedFile) {
          setDiffScrollOffset((o) =>
            Math.min(o + visibleDiffLines, Math.max(0, selectedFile.lines.length - visibleDiffLines))
          );
        }
      } else if (input === "K" || key.pageUp) {
        setDiffScrollOffset((o) => Math.max(o - visibleDiffLines, 0));
      } else if (input === "g") {
        setDiffScrollOffset(0);
      } else if (input === "G") {
        if (selectedFile) {
          setDiffScrollOffset(Math.max(0, selectedFile.lines.length - visibleDiffLines));
        }
      } else if (input === "h" || key.leftArrow) {
        setActivePane("files");
      } else if (input === "]") {
        // Next file
        const nextIndex = Math.min(selectedFileIndex + 1, filesArray.length - 1);
        setSelectedFileIndex(nextIndex);
      } else if (input === "[") {
        // Prev file
        const prevIndex = Math.max(selectedFileIndex - 1, 0);
        setSelectedFileIndex(prevIndex);
      }
    }
  });

  return (
    <Box flexDirection="column" height={height}>
      <Box flexGrow={1}>
        <FileList
          files={filesArray}
          selectedIndex={selectedFileIndex}
          height={height - 2}
          isFocused={activePane === "files"}
        />
        <DiffView
          file={selectedFile}
          scrollOffset={diffScrollOffset}
          height={height - 2}
          showTooltips={showTooltips}
          isFocused={activePane === "diff"}
        />
      </Box>
      <StatusBar
        prUrl={prUrl}
        isComplete={state.isComplete}
        error={state.error}
        fileCount={filesArray.filter((f) => f.status !== "skipped").length}
        totalLines={totalLines}
        highScoreCount={highScoreCount}
        activePane={activePane}
      />
    </Box>
  );
}

// CLI entry point
program
  .name("0github")
  .description("TUI heatmap diff viewer for GitHub pull requests")
  .version("0.0.1")
  .argument("[pr-url]", "GitHub PR URL or owner/repo#number")
  .option("-t, --tooltips", "Show review hints for flagged lines", true)
  .option("--no-tooltips", "Hide review hints")
  .option("--legend", "Show score legend and exit")
  .action((prUrl: string | undefined, options) => {
    if (options.legend) {
      console.log(chalk.bold("\nScore Legend:\n"));
      console.log(`  ${chalk.dim("  0-10 ")} - Minimal attention needed`);
      console.log(`  ${chalk.bgGreen.black(" 11-25 ")} - Low attention`);
      console.log(`  ${chalk.bgYellow.black(" 26-40 ")} - Moderate attention`);
      console.log(`  ${chalk.bgHex("#FFA500").black(" 41-60 ")} - Notable concern`);
      console.log(`  ${chalk.bgRed.white(" 61-80 ")} - High attention needed`);
      console.log(`  ${chalk.bgMagenta.white.bold(" 81-100")} - Critical review required`);
      console.log();
      console.log(chalk.dim("Controls:"));
      console.log(chalk.dim("  j/k or ↑/↓  - Navigate"));
      console.log(chalk.dim("  J/K         - Page up/down"));
      console.log(chalk.dim("  Tab         - Switch between file list and diff"));
      console.log(chalk.dim("  Enter/l/→   - Focus diff view"));
      console.log(chalk.dim("  h/←         - Focus file list"));
      console.log(chalk.dim("  [/]         - Prev/next file (in diff view)"));
      console.log(chalk.dim("  t           - Toggle tooltips"));
      console.log(chalk.dim("  g/G         - Go to top/bottom"));
      console.log(chalk.dim("  q           - Quit"));
      console.log();
      return;
    }

    if (!prUrl) {
      console.error(
        chalk.red("PR URL required. Use format: https://github.com/owner/repo/pull/123 or owner/repo#123")
      );
      console.log(chalk.dim("\nRun with --help for more options."));
      process.exit(1);
    }

    const parsed = parseGitHubPrUrl(prUrl);
    if (!parsed) {
      console.error(
        chalk.red(
          "Invalid PR URL. Use format: https://github.com/owner/repo/pull/123 or owner/repo#123"
        )
      );
      process.exit(1);
    }

    render(
      <App
        owner={parsed.owner}
        repo={parsed.repo}
        prNumber={parsed.prNumber}
        showTooltips={options.tooltips}
      />
    );
  });

program.parse();
