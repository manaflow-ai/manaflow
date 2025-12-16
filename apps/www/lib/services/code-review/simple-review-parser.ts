const HUNK_HEADER_PATTERN =
  /^@@\s*-(?<oldStart>\d+)(?:,(?<oldLength>\d+))?\s+\+(?<newStart>\d+)(?:,(?<newLength>\d+))?\s*@@/;
const ANNOTATION_PATTERN = /^(?<prefix>.*)(\s+#\s+)(?<annotation>.+)$/;

type LineChangeType = "add" | "remove" | "context";

export type SimpleReviewParsedLine = {
  changeType: LineChangeType;
  diffLine: string;
  codeLine: string;
  mostImportantWord: string;
  shouldReviewWhy: string;
  score: number;
  scoreNormalized: number;
  oldLineNumber: number | null;
  newLineNumber: number | null;
};

export type SimpleReviewParsedEvent =
  | { type: "file"; filePath: string }
  | { type: "hunk"; filePath: string | null; header: string }
  | { type: "line"; filePath: string; line: SimpleReviewParsedLine }
  | { type: "skip"; filePath: string; reason: string }
  | {
      type: "file-complete";
      filePath: string;
      status: "success" | "skipped" | "error";
      summary?: string;
    };

function clampScore(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function normalizeGitPath(input: string | null): string | null {
  if (!input) {
    return null;
  }
  const trimmed = input.trim();
  if (!trimmed || trimmed === "/dev/null") {
    return null;
  }
  const withoutPrefix = trimmed.replace(/^(a|b)\//, "");
  return withoutPrefix;
}

type ParsedAnnotation = {
  mostImportantWord: string;
  shouldReviewWhy: string;
  score: number;
};

function stripAnnotation(line: string, annotationStart: number): {
  diffLine: string;
  codeLine: string;
} {
  const diffLine = line.slice(0, annotationStart).replace(/\s+$/, "");
  const diffMarker = diffLine[0] ?? "";
  const codeStart = diffMarker === "+" || diffMarker === "-" || diffMarker === " "
    ? diffLine.slice(1)
    : diffLine;
  return {
    diffLine,
    codeLine: codeStart,
  };
}

function parseAnnotation(content: string): ParsedAnnotation | null {
  const trimmedContent = content.trim();
  if (trimmedContent.length === 0) {
    return null;
  }

  const scoreMatch = trimmedContent.match(/(?:"?(?<score>\d{1,3})"?)\s*$/);
  if (!scoreMatch?.groups?.score || scoreMatch.index === undefined) {
    return null;
  }

  const score = clampScore(Number.parseInt(scoreMatch.groups.score, 10));
  let remainder = trimmedContent.slice(0, scoreMatch.index).trim();

  if (remainder.length === 0) {
    return null;
  }

  let mostImportantWord: string;

  if (remainder.startsWith("\"")) {
    const firstQuoted = remainder.match(/^"([^"]*)"/);
    if (!firstQuoted) {
      return null;
    }
    mostImportantWord = firstQuoted[1]?.trim() ?? "";
    remainder = remainder.slice(firstQuoted[0].length).trim();
  } else {
    const nextQuoteIndex = remainder.indexOf("\"");
    if (nextQuoteIndex === -1) {
      const parts = remainder.split(/\s+/).filter((part) => part.length > 0);
      if (parts.length === 0) {
        return null;
      }
      mostImportantWord = parts.shift() ?? "";
      const combinedReason = parts.join(" ").trim();
      return {
        mostImportantWord,
        shouldReviewWhy: combinedReason,
        score,
      };
    }
    mostImportantWord = remainder.slice(0, nextQuoteIndex).trim();
    remainder = remainder.slice(nextQuoteIndex).trim();
  }

  if (mostImportantWord.length === 0) {
    return null;
  }

  const shouldReviewWhy = remainder.replace(/"/g, "").trim();

  return {
    mostImportantWord,
    shouldReviewWhy,
    score,
  };
}

export class SimpleReviewParser {
  private readonly buffer: string[] = [];
  private partial = "";
  private currentFile: string | null = null;
  private oldLine = 0;
  private newLine = 0;

  constructor(initialFilePath?: string | null) {
    if (initialFilePath) {
      this.setFallbackFile(initialFilePath);
    }
  }

  push(chunk: string): SimpleReviewParsedEvent[] {
    if (chunk.length === 0) {
      return [];
    }
    this.buffer.push(chunk);
    return this.consumeBuffer();
  }

  flush(): SimpleReviewParsedEvent[] {
    if (this.partial.length === 0) {
      return [];
    }
    const remaining = this.partial;
    this.partial = "";
    return this.processLine(remaining);
  }

  setFallbackFile(filePath: string): void {
    if (this.currentFile) {
      return;
    }
    this.currentFile = filePath;
    this.oldLine = 0;
    this.newLine = 0;
  }

  private consumeBuffer(): SimpleReviewParsedEvent[] {
    const text = this.partial + this.buffer.join("");
    this.buffer.length = 0;

    const events: SimpleReviewParsedEvent[] = [];
    let start = 0;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char !== "\n") {
        continue;
      }

      const rawLine = text.slice(start, index);
      events.push(...this.processLine(rawLine));
      start = index + 1;
    }

    this.partial = text.slice(start);
    return events;
  }

  private processLine(line: string): SimpleReviewParsedEvent[] {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("diff --git")) {
      this.currentFile = null;
      return [];
    }

    if (trimmed.startsWith("--- ")) {
      return [];
    }

    if (trimmed.startsWith("+++ ")) {
      const filePath = normalizeGitPath(trimmed.slice(4));
      if (filePath) {
        this.currentFile = filePath;
        this.oldLine = 0;
        this.newLine = 0;
        return [{ type: "file", filePath }];
      }
      return [];
    }

    if (trimmed.startsWith("@@")) {
      const match = trimmed.match(HUNK_HEADER_PATTERN);
      if (match && match.groups) {
        const { oldStart, newStart } = match.groups;
        this.oldLine = Number.parseInt(oldStart ?? "0", 10) || 0;
        this.newLine = Number.parseInt(newStart ?? "0", 10) || 0;
      }
      return [
        {
          type: "hunk",
          filePath: this.currentFile,
          header: trimmed,
        },
      ];
    }

    if (!this.currentFile) {
      return [];
    }

    const firstChar = trimmed[0] ?? "";
    if (!["+","-"," ","\\"].includes(firstChar)) {
      return [];
    }

    if (firstChar === "\\") {
      return [];
    }

    const annotationMatch = trimmed.match(ANNOTATION_PATTERN);
    const events: SimpleReviewParsedEvent[] = [];

    const incrementOld = firstChar === "-" || firstChar === " ";
    const incrementNew = firstChar === "+" || firstChar === " ";

    const currentOldLine =
      incrementOld && this.oldLine > 0 ? this.oldLine : null;
    const currentNewLine =
      incrementNew && this.newLine > 0 ? this.newLine : null;

    if (incrementOld) {
      this.oldLine += 1;
    }
    if (incrementNew) {
      this.newLine += 1;
    }

    if (!annotationMatch || !annotationMatch.groups) {
      return events;
    }

    const { prefix = "", annotation } = annotationMatch.groups;
    if (!annotation) {
      return events;
    }

    const parsedAnnotation = parseAnnotation(annotation);
    if (!parsedAnnotation) {
      return events;
    }

    const annotationStart = prefix.length;
    const { diffLine, codeLine } = stripAnnotation(trimmed, annotationStart);

    const { mostImportantWord, shouldReviewWhy, score } = parsedAnnotation;
    const parsedScore = clampScore(score);
    const scoreNormalized = parsedScore / 100;

    const changeType: LineChangeType =
      firstChar === "+"
        ? "add"
        : firstChar === "-"
          ? "remove"
          : "context";

    const parsedLine: SimpleReviewParsedLine = {
      changeType,
      diffLine,
      codeLine,
      mostImportantWord: mostImportantWord.trim(),
      shouldReviewWhy,
      score: parsedScore,
      scoreNormalized,
      oldLineNumber: currentOldLine,
      newLineNumber: currentNewLine,
    };

    events.push({
      type: "line",
      filePath: this.currentFile,
      line: parsedLine,
    });

    return events;
  }
}
