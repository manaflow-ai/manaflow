const HUNK_HEADER_REGEX = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const PAD_WIDTH = 5;

function normalizeStart(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed === 0) {
    return null;
  }
  return parsed;
}

function padLineNumber(value: number | null): string {
  return value === null ? " ".repeat(PAD_WIDTH) : value.toString().padStart(PAD_WIDTH, " ");
}

function formatAddedLine(newLineNumber: number | null, diffLine: string): string {
  const text = diffLine.length > 1 ? diffLine.slice(1) : "";
  return `+${padLineNumber(newLineNumber)} | ${text}`;
}

function formatDeletedLine(oldLineNumber: number | null, diffLine: string): string {
  const text = diffLine.length > 1 ? diffLine.slice(1) : "";
  return `-${padLineNumber(oldLineNumber)} | ${text}`;
}

function formatContextLine(
  oldLineNumber: number | null,
  newLineNumber: number | null,
  diffLine: string,
  showOld: boolean,
  showNew: boolean
): string {
  const marker = diffLine[0] ?? " ";
  const text = diffLine.length > 1 ? diffLine.slice(1) : "";
  const left = showOld ? padLineNumber(oldLineNumber) : " ".repeat(PAD_WIDTH);
  const right = showNew ? padLineNumber(newLineNumber) : " ".repeat(PAD_WIDTH);
  const separator = showOld && showNew ? "" : " ";
  return `${marker}${left}${separator}${right} | ${text}`;
}

function formatWithLineNumbers(normalizedDiff: string, includeContext: boolean): string[] {
  const lines = normalizedDiff.split("\n");
  const formatted: string[] = [];
  let currentOldLine: number | null = null;
  let currentNewLine: number | null = null;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const match = line.match(HUNK_HEADER_REGEX);
      if (match) {
        currentOldLine = normalizeStart(match[1]);
        currentNewLine = normalizeStart(match[3]);
      } else {
        currentOldLine = null;
        currentNewLine = null;
      }
      formatted.push(line);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      formatted.push(formatAddedLine(currentNewLine, line));
      if (currentNewLine !== null) {
        currentNewLine += 1;
      }
      continue;
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      formatted.push(formatDeletedLine(currentOldLine, line));
      if (currentOldLine !== null) {
        currentOldLine += 1;
      }
      continue;
    }

    if ((line.startsWith(" ") || line.startsWith("\t")) && includeContext) {
      formatted.push(
        formatContextLine(currentOldLine, currentNewLine, line, true, true)
      );
      if (currentOldLine !== null) {
        currentOldLine += 1;
      }
      if (currentNewLine !== null) {
        currentNewLine += 1;
      }
      continue;
    }

    if (line.startsWith(" ") || line.startsWith("\t")) {
      formatted.push(line);
      if (currentOldLine !== null) {
        currentOldLine += 1;
      }
      if (currentNewLine !== null) {
        currentNewLine += 1;
      }
      continue;
    }

    formatted.push(line);
  }

  if (formatted.length > 0 && formatted[formatted.length - 1] === "") {
    formatted.pop();
  }

  return formatted;
}

function formatWithoutLineNumbers(normalizedDiff: string): string[] {
  const lines = normalizedDiff.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

export interface FormatDiffOptions {
  showLineNumbers?: boolean;
  includeContextLineNumbers?: boolean;
}

export function formatUnifiedDiffWithLineNumbers(
  diff: string,
  options: FormatDiffOptions = {}
): string[] {
  if (!diff) {
    return [];
  }

  const normalized = diff.replace(/\r\n/g, "\n");
  const showLineNumbers = options.showLineNumbers ?? true;
  if (!showLineNumbers) {
    return formatWithoutLineNumbers(normalized);
  }

  const includeContext = options.includeContextLineNumbers ?? true;
  return formatWithLineNumbers(normalized, includeContext);
}
