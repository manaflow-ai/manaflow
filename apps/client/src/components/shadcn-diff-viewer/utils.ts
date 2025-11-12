import parseDiffLib from "parse-diff";

export interface ParsedFile {
  name: string;
  oldPath?: string;
  newPath?: string;
  hunks: Hunk[];
}

export interface Hunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: Change[];
}

export interface Change {
  type: "add" | "delete" | "normal";
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export function parseDiff(diffString: string): ParsedFile[] {
  try {
    const parsed = parseDiffLib(diffString);

    return parsed.map((file) => {
      let oldLineNum = 0;
      let newLineNum = 0;

      const hunks: Hunk[] = (file.chunks || []).map((chunk, hunkIndex) => {
        // Reset line numbers for each hunk
        oldLineNum = chunk.oldStart;
        newLineNum = chunk.newStart;

        const changes: Change[] = (chunk.changes || []).map((change) => {
          let type: "add" | "delete" | "normal" = "normal";
          if (change.type === "add") type = "add";
          if (change.type === "del") type = "delete";

          const result: Change = {
            type,
            content: change.content || "",
            oldLineNumber: type !== "add" ? oldLineNum : undefined,
            newLineNumber: type !== "delete" ? newLineNum : undefined,
          };

          // Increment line numbers based on change type
          if (type === "add") {
            newLineNum++;
          } else if (type === "delete") {
            oldLineNum++;
          } else {
            oldLineNum++;
            newLineNum++;
          }

          return result;
        });

        return {
          id: `hunk-${hunkIndex}`,
          oldStart: chunk.oldStart || 0,
          oldLines: chunk.oldLines || 0,
          newStart: chunk.newStart || 0,
          newLines: chunk.newLines || 0,
          changes,
        };
      });

      return {
        name: file.to || file.from || "unknown",
        oldPath: file.from,
        newPath: file.to,
        hunks,
      };
    });
  } catch (error) {
    console.error("Failed to parse diff:", error);
    return [];
  }
}
