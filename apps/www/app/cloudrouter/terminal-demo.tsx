"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStickToBottom } from "use-stick-to-bottom";

// --- Types ---

interface LineFragment {
  text: string;
  color?: string;
}

type Line = string | LineFragment[];

interface Step {
  type?: "user" | "agent" | "tool" | "shell";
  command: string;
  output: Line[];
  pauseAfter?: number;
}

// --- Demo script (Claude Code session) ---

const STEPS: Step[] = [
  // --- Phase 1: Install the skill ---
  {
    type: "shell",
    command: "npx skills add manaflow-ai/cloudrouter",
    output: [
      "",
      [{ text: "  Installing cloudrouter skill...", color: "#a3a3a3" }],
      [{ text: "  ✓ Added cloudrouter skill to Claude Code", color: "#22c55e" }],
      "",
    ],
    pauseAfter: 1200,
  },

  // --- Phase 2: Launch Claude Code ---
  {
    type: "shell",
    command: "claude",
    output: [],
    pauseAfter: 800,
  },

  // --- Phase 3: Claude Code session ---
  {
    type: "user",
    command: "/cloudrouter deploy my Next.js app to a cloud sandbox and test it in the browser",
    output: [],
    pauseAfter: 800,
  },
  {
    type: "agent",
    command: "I'll create a sandbox, sync your project, install dependencies, and verify it works in the browser.",
    output: [],
    pauseAfter: 800,
  },

  // Start sandbox
  {
    type: "tool",
    command: "cloudrouter start . --name my-app",
    output: [
      "",
      [{ text: "    Waiting for sandbox to initialize.", color: "#a3a3a3" }],
      [
        { text: "    Syncing ", color: "#a3a3a3" },
        { text: "./", color: "#d4d4d4" },
        { text: " to sandbox...", color: "#a3a3a3" },
      ],
      [{ text: "    ✓ Synced 247 files (12.4 MB) in 3.2s (3.9 MB/s)", color: "#22c55e" }],
      [
        { text: "    Created sandbox: ", color: "#a3a3a3" },
        { text: "cr_x7k9m2p", color: "#d4d4d4" },
      ],
      [
        { text: "      Type:   ", color: "#737373" },
        { text: "Docker", color: "#d4d4d4" },
      ],
      [
        { text: "      Status: ", color: "#737373" },
        { text: "running", color: "#22c55e" },
      ],
      [
        { text: "      VSCode:  ", color: "#737373" },
        { text: "https://39378-x7k9m2p.e2b.app?folder=/home/user/workspace", color: "#38bdf8" },
      ],
      [
        { text: "      Jupyter: ", color: "#737373" },
        { text: "https://8888-x7k9m2p.e2b.app", color: "#38bdf8" },
      ],
      [
        { text: "      VNC:     ", color: "#737373" },
        { text: "https://39380-x7k9m2p.e2b.app?autoconnect=true", color: "#38bdf8" },
      ],
      "",
    ],
    pauseAfter: 1000,
  },

  // Install deps
  {
    type: "agent",
    command: "Sandbox is running. Installing dependencies and starting the dev server.",
    output: [],
    pauseAfter: 600,
  },
  {
    type: "tool",
    command: 'cloudrouter ssh cr_x7k9m2p "npm install"',
    output: [
      "",
      [{ text: "    added 1,247 packages in 8s", color: "#a3a3a3" }],
      "",
    ],
    pauseAfter: 800,
  },

  // Dev server
  {
    type: "tool",
    command: 'cloudrouter ssh cr_x7k9m2p "npm run dev"',
    output: [
      "",
      [{ text: "    ▲ Next.js 15.5.12", color: "#d4d4d4" }],
      [
        { text: "    - Local:   ", color: "#a3a3a3" },
        { text: "http://localhost:3000", color: "#38bdf8" },
      ],
      [{ text: "    ✓ Ready in 1414ms", color: "#22c55e" }],
      "",
    ],
    pauseAfter: 1000,
  },

  // Browser testing
  {
    type: "agent",
    command: "Dev server is running. Opening the browser to verify.",
    output: [],
    pauseAfter: 600,
  },
  {
    type: "tool",
    command: 'cloudrouter browser open cr_x7k9m2p "http://localhost:3000"',
    output: [
      "",
      [
        { text: "    Navigated to: ", color: "#a3a3a3" },
        { text: "http://localhost:3000", color: "#d4d4d4" },
      ],
      "",
    ],
    pauseAfter: 800,
  },
  {
    type: "tool",
    command: "cloudrouter browser snapshot cr_x7k9m2p",
    output: [
      "",
      [{ text: "    - document:", color: "#a3a3a3" }],
      [{ text: "      - main:", color: "#a3a3a3" }],
      [
        { text: "        - heading ", color: "#a3a3a3" },
        { text: '"Welcome to My App"', color: "#d4d4d4" },
        { text: " [ref=e1] [level=1]", color: "#a78bfa" },
      ],
      [{ text: "        - navigation:", color: "#a3a3a3" }],
      [
        { text: "          - link ", color: "#a3a3a3" },
        { text: '"Docs →"', color: "#d4d4d4" },
        { text: " [ref=e2]", color: "#a78bfa" },
      ],
      [
        { text: "          - link ", color: "#a3a3a3" },
        { text: '"Learn →"', color: "#d4d4d4" },
        { text: " [ref=e3]", color: "#a78bfa" },
      ],
      [
        { text: "          - link ", color: "#a3a3a3" },
        { text: '"Deploy →"', color: "#d4d4d4" },
        { text: " [ref=e4]", color: "#a78bfa" },
      ],
      "",
    ],
    pauseAfter: 1000,
  },

  // Click test
  {
    type: "agent",
    command: "App is live. Testing navigation by clicking the Docs link.",
    output: [],
    pauseAfter: 600,
  },
  {
    type: "tool",
    command: "cloudrouter browser click cr_x7k9m2p e2",
    output: [
      "",
      [{ text: "    Clicked: e2", color: "#a3a3a3" }],
      "",
    ],
    pauseAfter: 600,
  },
  {
    type: "tool",
    command: "cloudrouter browser screenshot cr_x7k9m2p screenshot.png",
    output: [
      "",
      [{ text: "    ✓ Screenshot saved to screenshot.png", color: "#22c55e" }],
      "",
    ],
    pauseAfter: 1000,
  },

  // GPU sandbox
  {
    type: "agent",
    command: "App is deployed and working. Now spinning up a GPU sandbox for ML training.",
    output: [],
    pauseAfter: 800,
  },
  {
    type: "tool",
    command: "cloudrouter start --gpu H100 --name ml-training",
    output: [
      "",
      [{ text: "    Waiting for sandbox to initialize.", color: "#a3a3a3" }],
      [
        { text: "    Created sandbox: ", color: "#a3a3a3" },
        { text: "cr_g4h8j2k", color: "#d4d4d4" },
      ],
      [
        { text: "      Type:   ", color: "#737373" },
        { text: "GPU (H100)", color: "#fbbf24" },
      ],
      [
        { text: "      Status: ", color: "#737373" },
        { text: "running", color: "#22c55e" },
      ],
      [
        { text: "      Jupyter: ", color: "#737373" },
        { text: "https://ta-g4h8j2k-8888.modal.host", color: "#38bdf8" },
      ],
      "",
    ],
    pauseAfter: 1000,
  },

  // Verify GPU
  {
    type: "tool",
    command: 'cloudrouter ssh cr_g4h8j2k "nvidia-smi --query-gpu=name,memory.total --format=csv"',
    output: [
      "",
      [{ text: "    name, memory.total [MiB]", color: "#a3a3a3" }],
      [{ text: "    NVIDIA H100, 81920 MiB", color: "#d4d4d4" }],
      "",
    ],
    pauseAfter: 800,
  },

  // List all
  {
    type: "tool",
    command: "cloudrouter ls",
    output: [
      "",
      [{ text: "    Sandboxes:", color: "#a3a3a3" }],
      [
        { text: "      cr_x7k9m2p", color: "#d4d4d4" },
        { text: " - ", color: "#737373" },
        { text: "running", color: "#22c55e" },
        { text: " (my-app) [Docker]", color: "#a3a3a3" },
      ],
      [
        { text: "      cr_g4h8j2k", color: "#d4d4d4" },
        { text: " - ", color: "#737373" },
        { text: "running", color: "#22c55e" },
        { text: " (ml-training) [GPU]", color: "#a3a3a3" },
      ],
      "",
    ],
    pauseAfter: 800,
  },

  // Final summary
  {
    type: "agent",
    command: "Done! Two sandboxes running — your Next.js app on Docker and an H100 GPU for ML training.",
    output: [],
  },
];

// --- Helpers ---

const CHAR_DELAY = 32;
const CHAR_VARIANCE = 18;
const STEP_PAUSE = 800;

/** Colorize a cloudrouter CLI command into fragments */
function colorizeCommand(cmd: string): LineFragment[] {
  // Match: cloudrouter <rest...>
  const match = cmd.match(/^(cloudrouter)\s+(.*)/);
  if (!match) return [{ text: cmd, color: "#d4d4d4" }];

  const [, bin, rest] = match;
  return [
    { text: bin, color: "#f97316" },    // orange for cloudrouter
    { text: " " + rest, color: "#38bdf8" },  // blue for everything after
  ];
}

function randomDelay(base: number, variance: number) {
  return base + (Math.random() * variance * 2 - variance);
}

// --- Component ---

function RenderedLine({ line }: { line: Line }) {
  if (typeof line === "string") {
    return <div className="min-h-[1.35em]">{line || "\u00A0"}</div>;
  }
  return (
    <div className="min-h-[1.35em]">
      {line.map((fragment, i) => (
        <span key={i} style={fragment.color ? { color: fragment.color } : undefined}>
          {fragment.text}
        </span>
      ))}
    </div>
  );
}

export function TerminalDemo() {
  const [lines, setLines] = useState<Array<{ key: string; content: Line }>>([]);
  const [currentTyping, setCurrentTyping] = useState("");
  const [showCursor, setShowCursor] = useState(true);
  const [promptStyle, setPromptStyle] = useState<"shell" | "claude">("shell");
  const [isComplete, setIsComplete] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

  const { scrollRef, contentRef } = useStickToBottom({
    resize: "instant",
    initial: "instant",
  });
  const abortRef = useRef<AbortController | null>(null);
  const lineCounterRef = useRef(0);

  const sleep = useCallback((ms: number, signal?: AbortSignal) => {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  }, []);

  const addLine = useCallback(
    (content: Line) => {
      const key = `line-${lineCounterRef.current++}`;
      setLines((prev) => [...prev, { key, content }]);
    },
    [],
  );

  const typeCommand = useCallback(
    async (cmd: string, signal: AbortSignal) => {
      for (let i = 0; i <= cmd.length; i++) {
        signal.throwIfAborted();
        setCurrentTyping(cmd.slice(0, i));
        if (i < cmd.length) {
          await sleep(randomDelay(CHAR_DELAY, CHAR_VARIANCE), signal);
        }
      }
    },
    [sleep],
  );

  const renderStepLines = useCallback(
    (step: Step) => {
      const type = step.type ?? "user";

      if (type === "shell") {
        // $ command
        addLine([
          { text: "$ ", color: "#a3a3a3" },
          { text: step.command, color: "#d4d4d4" },
        ]);
      } else if (type === "user") {
        // ❯ command
        addLine([
          { text: "❯ ", color: "#22c55e" },
          { text: step.command, color: "#d4d4d4" },
        ]);
      } else if (type === "agent") {
        // ⏺ text
        addLine([
          { text: "⏺ ", color: "#818cf8" },
          { text: step.command, color: "#d4d4d4" },
        ]);
      } else if (type === "tool") {
        // ⏺  Bash  command (with syntax coloring)
        addLine([
          { text: "  ⏺ ", color: "#818cf8" },
          { text: "Bash ", color: "#737373" },
          ...colorizeCommand(step.command),
        ]);
      }

      // Output lines
      for (const outputLine of step.output) {
        addLine(outputLine);
      }
    },
    [addLine],
  );

  const runDemo = useCallback(async () => {
    if (isRunning) return;
    setIsRunning(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      setLines([]);
      setIsComplete(false);
      lineCounterRef.current = 0;

      await sleep(600, signal);

      for (let stepIdx = 0; stepIdx < STEPS.length; stepIdx++) {
        const step = STEPS[stepIdx];
        const type = step.type ?? "user";

        if (type === "shell" || type === "user") {
          // Type the command character by character
          setPromptStyle(type === "shell" ? "shell" : "claude");
          setCurrentTyping("");
          setShowCursor(true);

          await sleep(400, signal);
          await typeCommand(step.command, signal);
          await sleep(300, signal);

          // "Submit" — add as line and clear typing
          setCurrentTyping("");
          setShowCursor(false);
          renderStepLines(step);
        } else {
          // Agent text and tool calls appear instantly
          setShowCursor(false);
          await sleep(300, signal);
          renderStepLines(step);
        }

        // Pause between steps
        const pause = step.pauseAfter ?? STEP_PAUSE;
        await sleep(pause, signal);
      }

      // Demo complete — show cursor again
      setShowCursor(true);
      setCurrentTyping("");
      setIsComplete(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        return;
      }
      console.error("Terminal demo error:", err);
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [isRunning, sleep, typeCommand, renderStepLines]);

  const skipToEnd = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Render all steps at once
    const allLines: Array<{ key: string; content: Line }> = [];
    let counter = 0;

    const addSkipLine = (content: Line) => {
      allLines.push({ key: `line-${counter++}`, content });
    };

    for (const step of STEPS) {
      const type = step.type ?? "user";

      if (type === "shell") {
        addSkipLine([
          { text: "$ ", color: "#a3a3a3" },
          { text: step.command, color: "#d4d4d4" },
        ]);
      } else if (type === "user") {
        addSkipLine([
          { text: "❯ ", color: "#22c55e" },
          { text: step.command, color: "#d4d4d4" },
        ]);
      } else if (type === "agent") {
        addSkipLine([
          { text: "⏺ ", color: "#818cf8" },
          { text: step.command, color: "#d4d4d4" },
        ]);
      } else if (type === "tool") {
        addSkipLine([
          { text: "  ⏺ ", color: "#818cf8" },
          { text: "Bash ", color: "#737373" },
          ...colorizeCommand(step.command),
        ]);
      }

      for (const outputLine of step.output) {
        addSkipLine(outputLine);
      }
    }

    lineCounterRef.current = counter;
    setLines(allLines);
    setCurrentTyping("");
    setShowCursor(true);
    setIsComplete(true);
    setIsRunning(false);
  }, []);

  const restart = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLines([]);
    setCurrentTyping("");
    setShowCursor(true);
    setIsComplete(false);
    setIsRunning(false);
    lineCounterRef.current = 0;
    setTimeout(() => {
      runDemo();
    }, 100);
  }, [runDemo]);

  // Auto-start on mount
  useEffect(() => {
    runDemo();
    return () => {
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Blinking cursor
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="group relative mx-auto w-full max-w-3xl"
      onKeyDown={(e) => {
        if (e.key === "Enter" && isRunning) {
          skipToEnd();
        }
      }}
    >
      {/* Terminal window */}
      <div className="overflow-hidden rounded-xl border border-neutral-800 bg-[#0a0a0a] shadow-2xl shadow-black/50">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-neutral-800 bg-[#1a1a1a] px-4 py-3">
          <div className="flex gap-1.5">
            <button
              type="button"
              className="h-3 w-3 rounded-full bg-[#ff5f57] transition hover:brightness-110"
              aria-label="Close"
              onClick={restart}
            />
            <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
            <div className="h-3 w-3 rounded-full bg-[#28c840]" />
          </div>
          <span className="ml-2 flex-1 select-none text-center text-xs text-neutral-500">
            cloudrouter
          </span>
        </div>

        {/* Terminal body */}
        <div
          ref={scrollRef}
          className="h-[420px] overflow-y-auto font-mono text-[13px] leading-[1.35] sm:h-[480px] sm:text-sm"
          onClick={() => {
            if (isRunning) skipToEnd();
          }}
        >
          <div ref={contentRef} className="p-4">
            {/* Rendered lines */}
            {lines.map((line) => (
              <RenderedLine key={line.key} line={line.content} />
            ))}

            {/* Current prompt + typing */}
            {showCursor && (
              <div className="min-h-[1.35em]">
                {promptStyle === "shell" ? (
                  <span style={{ color: "#a3a3a3" }}>$ </span>
                ) : (
                  <span style={{ color: "#22c55e" }}>❯ </span>
                )}
                <span style={{ color: "#d4d4d4" }}>{currentTyping}</span>
                <span
                  className="inline-block h-[1.1em] w-[0.55em] translate-y-[0.15em] align-baseline"
                  style={{
                    backgroundColor: cursorVisible ? "#d4d4d4" : "transparent",
                  }}
                />
              </div>
            )}

            {/* Completion message */}
            {isComplete && (
              <div className="mt-4">
                <div className="min-h-[1.35em]" />
                <div className="min-h-[1.35em] text-neutral-600">
                  {"  "}— Demo complete. Click the{" "}
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#ff5f57] align-middle" />{" "}
                  button or press{" "}
                  <kbd className="rounded border border-neutral-700 bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    R
                  </kbd>{" "}
                  to replay.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Click hint */}
      <div className={`mt-3 text-center text-xs text-neutral-600 transition-opacity ${isRunning ? "opacity-100" : "opacity-0"}`}>
        Click terminal or press Enter to skip animation
      </div>

      {/* Keyboard listener for restart */}
      <KeyboardListener
        onRestart={restart}
        isComplete={isComplete}
      />
    </div>
  );
}

function KeyboardListener({
  onRestart,
  isComplete,
}: {
  onRestart: () => void;
  isComplete: boolean;
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (isComplete && e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey) {
        onRestart();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isComplete, onRestart]);

  return null;
}
