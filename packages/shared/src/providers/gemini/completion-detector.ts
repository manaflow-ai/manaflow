import type { FSWatcher } from "node:fs";
import { getGeminiTelemetryPath } from "./telemetry";

type CompletionSignal =
  | "next_speaker_ready"
  | "agent_goal"
  | "complete_task"
  | "conversation_finished";

type AttributeMap = Record<string, unknown>;

function extractAttributes(event: unknown): AttributeMap | null {
  if (!event || typeof event !== "object") {
    return null;
  }
  const record = event as Record<string, unknown>;
  const direct = record.attributes;
  if (direct && typeof direct === "object") {
    return direct as AttributeMap;
  }
  const resource = record.resource;
  if (
    resource &&
    typeof resource === "object" &&
    "attributes" in resource &&
    resource.attributes &&
    typeof resource.attributes === "object"
  ) {
    return resource.attributes as AttributeMap;
  }
  const body = record.body;
  if (
    body &&
    typeof body === "object" &&
    "attributes" in body &&
    body.attributes &&
    typeof body.attributes === "object"
  ) {
    return body.attributes as AttributeMap;
  }
  return null;
}

function chooseAttr(
  attrs: AttributeMap,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = attrs[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function classifyTelemetryEvent(event: unknown): CompletionSignal | null {
  const attrs = extractAttributes(event);
  if (!attrs) return null;

  const eventName = chooseAttr(attrs, ["event.name", "event_name"]);
  if (!eventName) return null;

  if (eventName === "gemini_cli.next_speaker_check") {
    const result = chooseAttr(attrs, ["result"]);
    if (result === "user") {
      return "next_speaker_ready";
    }
    return null;
  }

  if (eventName === "gemini_cli.tool_call") {
    const fnName = chooseAttr(attrs, [
      "function_name",
      "functionName",
      "function",
    ]);
    if (fnName === "complete_task") {
      return "complete_task";
    }
    return null;
  }

  if (eventName === "gemini_cli.agent.finish") {
    const terminateReason = chooseAttr(attrs, [
      "terminate_reason",
      "terminateReason",
    ]);
    if (terminateReason === "GOAL") {
      return "agent_goal";
    }
    return null;
  }

  if (eventName === "gemini_cli.conversation_finished") {
    return "conversation_finished";
  }

  return null;
}

function createJsonStreamParser(onObject: (obj: unknown) => void) {
  let collecting = false;
  let depth = 0;
  let inString = false;
  let escape = false;
  let buf = "";

  return (chunk: string) => {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];

      if (inString) {
        buf += ch;
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        if (collecting) buf += ch;
        continue;
      }

      if (ch === "{") {
        if (!collecting) {
          collecting = true;
          depth = 1;
          buf = "{";
        } else {
          depth++;
          buf += ch;
        }
        continue;
      }

      if (ch === "}") {
        if (collecting) {
          depth--;
          buf += ch;
          if (depth === 0) {
            try {
              const obj = JSON.parse(buf);
              onObject(obj);
            } catch {
              // Ignore parse errors and try to resume on the next object
            }
            collecting = false;
            buf = "";
          }
        }
        continue;
      }

      if (collecting) {
        buf += ch;
      }
    }
  };
}

export function startGeminiCompletionDetector(
  taskRunId: string
): Promise<void> {
  const telemetryPath = getGeminiTelemetryPath(taskRunId);
  let fileWatcher: FSWatcher | null = null;
  let dirWatcher: FSWatcher | null = null;

  return new Promise<void>((resolve) => {
    void (async () => {
      const path = await import("node:path");
      const fs = await import("node:fs");
      const { watch, createReadStream, promises: fsp } = fs;

      let stopped = false;
      let lastSize = 0;

      const dir = path.dirname(telemetryPath);
      const file = path.basename(telemetryPath);

      const stop = () => {
        if (stopped) return;
        stopped = true;
        try {
          fileWatcher?.close();
        } catch {
          // ignore
        }
        try {
          dirWatcher?.close();
        } catch {
          // ignore
        }
        resolve();
      };

      const parser = createJsonStreamParser((obj) => {
        if (stopped) return;
        const signal = classifyTelemetryEvent(obj);
        if (signal) {
          stop();
        }
      });

      const readNew = async (initial = false) => {
        try {
          const st = await fsp.stat(telemetryPath);
          const start = initial ? 0 : lastSize;
          if (st.size <= start) {
            lastSize = st.size;
            return;
          }
          await new Promise<void>((r) => {
            const rs = createReadStream(telemetryPath, {
              start,
              end: st.size - 1,
              encoding: "utf-8",
            });
            rs.on("data", (chunk: string | Buffer) => {
              const text =
                typeof chunk === "string" ? chunk : chunk.toString("utf-8");
              parser(text);
            });
            rs.on("end", () => r());
            rs.on("error", () => r());
          });
          lastSize = st.size;
        } catch {
          // File may not exist yet; wait for watcher
        }
      };

      const attachFileWatcher = async () => {
        if (stopped) return;
        try {
          const st = await fsp.stat(telemetryPath);
          lastSize = st.size;
          await readNew(true);
          if (stopped) return;
          fileWatcher = watch(
            telemetryPath,
            { persistent: false, encoding: "utf8" },
            (eventType: string) => {
              if (!stopped && eventType === "change") {
                void readNew(false);
              }
            }
          );
        } catch {
          // File not present; wait for directory watcher
        }
      };

      dirWatcher = watch(
        dir,
        { persistent: false, encoding: "utf8" },
        (_eventType: string, filename: string | null) => {
          if (stopped) return;
          if (filename && filename.toString() === file) {
            void attachFileWatcher();
          }
        }
      );

      await attachFileWatcher();
    })();
  });
}
