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
  prompt?: string;
  command: string;
  output: Line[];
  pauseAfter?: number;
}

// --- Demo script ---

const STEPS: Step[] = [
  // 1. Install as a skill
  {
    command: "npx skills add manaflow-ai/cloudrouter --all",
    output: [
      [{ text: "┌   skills ", color: "#d4d4d4" }],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "◇  Source: ", color: "#d4d4d4" },
        { text: "https://github.com/manaflow-ai/manaflow.git", color: "#38bdf8" },
      ],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "◇  Repository cloned", color: "#22c55e" },
      ],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "◇  Found 1 skill", color: "#22c55e" },
      ],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "●  Installing all 1 skills", color: "#a78bfa" },
      ],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "●  Installing to all 39 agents", color: "#a78bfa" },
      ],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "◇  Installation complete", color: "#22c55e" },
      ],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "◇  Installed 1 skill ─────────────────────────────────────", color: "#22c55e" },
      ],
      [
        { text: "│  ", color: "#d4d4d4" },
        { text: "✓ ", color: "#22c55e" },
        { text: "~/.agents/skills/cloudrouter", color: "#d4d4d4" },
      ],
      [
        { text: "│    ", color: "#d4d4d4" },
        { text: "universal: Amp, Codex, Gemini CLI, GitHub Copilot +3 more", color: "#a3a3a3" },
      ],
      [
        { text: "│    ", color: "#d4d4d4" },
        { text: "symlinked: Augment, Claude Code, Cline, Cursor +27 more", color: "#a3a3a3" },
      ],
      [{ text: "│", color: "#d4d4d4" }],
      [
        { text: "└  Done! ", color: "#d4d4d4" },
        { text: " Review skills before use; they run with full agent permissions.", color: "#737373" },
      ],
    ],
    pauseAfter: 700,
  },
  // 2. Login
  {
    command: "cloudrouter login",
    output: [
      [{ text: "Starting authentication...", color: "#d4d4d4" }],
      "",
      [{ text: "Opening browser to complete authentication...", color: "#d4d4d4" }],
      [
        { text: "If browser doesn't open, visit:", color: "#d4d4d4" },
      ],
      [
        { text: "  https://cloudrouter.dev/handler/cli-auth-confirm?login_code=x7k9m2", color: "#38bdf8" },
      ],
      "",
      [{ text: "Waiting for authentication... (press Ctrl+C to cancel)", color: "#a3a3a3" }],
      [{ text: "...", color: "#a3a3a3" }],
      "",
      [
        { text: "✓ Authentication successful!", color: "#22c55e" },
      ],
    ],
    pauseAfter: 500,
  },
  // 3. Check who we are
  {
    command: "cloudrouter whoami",
    output: [
      [
        { text: "User: ", color: "#d4d4d4" },
        { text: "you@company.com", color: "#d4d4d4" },
      ],
      [
        { text: "Team: ", color: "#d4d4d4" },
        { text: "my-team", color: "#d4d4d4" },
      ],
    ],
    pauseAfter: 400,
  },
  // 4. Start sandbox from current directory
  {
    command: "cloudrouter start .",
    output: [
      [{ text: "Waiting for sandbox to initialize.", color: "#d4d4d4" }],
      [
        { text: "Syncing ", color: "#d4d4d4" },
        { text: "./", color: "#d4d4d4" },
        { text: " to sandbox...", color: "#d4d4d4" },
      ],
      [
        { text: "✓ Synced 247 files (12.4 MB) in 3.2s (3.9 MB/s)", color: "#22c55e" },
      ],
      [
        { text: "✓ Files synced", color: "#22c55e" },
      ],
      [
        { text: "Created sandbox: ", color: "#d4d4d4" },
        { text: "cr_x7k9m2p", color: "#d4d4d4" },
      ],
      [
        { text: "  Provider: ", color: "#d4d4d4" },
        { text: "e2b", color: "#d4d4d4" },
      ],
      [
        { text: "  Status:   ", color: "#d4d4d4" },
        { text: "running", color: "#22c55e" },
      ],
      [
        { text: "  VSCode:   ", color: "#d4d4d4" },
        { text: "https://39378-x7k9m2p.e2b.app?folder=/home/user/workspace", color: "#38bdf8" },
      ],
      [
        { text: "  VNC:      ", color: "#d4d4d4" },
        { text: "https://39380-x7k9m2p.e2b.app?autoconnect=true", color: "#38bdf8" },
      ],
    ],
    pauseAfter: 700,
  },
  // 5. Open VS Code
  {
    command: "cloudrouter code cr_x7k9m2p",
    output: [
      [{ text: "Opening VS Code...", color: "#d4d4d4" }],
    ],
    pauseAfter: 400,
  },
  // 6. Execute a command
  {
    command: 'cloudrouter exec cr_x7k9m2p "npm install && npm run dev"',
    output: [
      [{ text: "added 847 packages in 12s", color: "#d4d4d4" }],
      [{ text: "137 packages are looking for funding", color: "#d4d4d4" }],
      "",
      [{ text: "> my-app@0.1.0 dev", color: "#d4d4d4" }],
      [{ text: "> next dev", color: "#d4d4d4" }],
      "",
      [{ text: "▲ Next.js 15.1.0", color: "#d4d4d4" }],
      [
        { text: "- Local:   ", color: "#d4d4d4" },
        { text: "http://localhost:3000", color: "#38bdf8" },
      ],
      [
        { text: "✓ Ready in 2.1s", color: "#22c55e" },
      ],
    ],
    pauseAfter: 600,
  },
  // 7. Browser automation — open URL
  {
    command: 'cloudrouter computer open cr_x7k9m2p "http://localhost:3000"',
    output: [
      [
        { text: "Navigated to: ", color: "#d4d4d4" },
        { text: "http://localhost:3000", color: "#d4d4d4" },
      ],
    ],
    pauseAfter: 300,
  },
  // 8. Browser automation — accessibility snapshot
  {
    command: "cloudrouter computer snapshot cr_x7k9m2p",
    output: [
      [
        { text: "@e1", color: "#a78bfa" },
        { text: " [RootWebArea] ", color: "#fbbf24" },
        { text: '"My App" (focused)', color: "#d4d4d4" },
      ],
      [
        { text: "  @e2", color: "#a78bfa" },
        { text: " [heading] ", color: "#fbbf24" },
        { text: '"Welcome to My App"', color: "#d4d4d4" },
      ],
      [
        { text: "    @e3", color: "#a78bfa" },
        { text: " [StaticText] ", color: "#fbbf24" },
        { text: '"Welcome to My App"', color: "#d4d4d4" },
      ],
      [
        { text: "  @e4", color: "#a78bfa" },
        { text: " [paragraph]", color: "#fbbf24" },
      ],
      [
        { text: "    @e5", color: "#a78bfa" },
        { text: " [StaticText] ", color: "#fbbf24" },
        { text: '"Build something amazing with cloud sandboxes."', color: "#d4d4d4" },
      ],
      [
        { text: "  @e6", color: "#a78bfa" },
        { text: " [button] ", color: "#fbbf24" },
        { text: '"Get Started"', color: "#d4d4d4" },
      ],
      [
        { text: "    @e7", color: "#a78bfa" },
        { text: " [StaticText] ", color: "#fbbf24" },
        { text: '"Get Started"', color: "#d4d4d4" },
      ],
      [
        { text: "  @e8", color: "#a78bfa" },
        { text: " [link] ", color: "#fbbf24" },
        { text: '"Documentation"', color: "#d4d4d4" },
      ],
      [
        { text: "    @e9", color: "#a78bfa" },
        { text: " [StaticText] ", color: "#fbbf24" },
        { text: '"Documentation"', color: "#d4d4d4" },
      ],
    ],
    pauseAfter: 500,
  },
  // 9. Browser automation — click
  {
    command: "cloudrouter computer click cr_x7k9m2p @e6",
    output: [
      [{ text: "Clicked: @e6", color: "#d4d4d4" }],
    ],
    pauseAfter: 300,
  },
  // 10. Browser automation — screenshot
  {
    command: "cloudrouter computer screenshot cr_x7k9m2p ./screenshot.png",
    output: [
      [
        { text: "Screenshot saved to: ", color: "#d4d4d4" },
        { text: "./screenshot.png", color: "#d4d4d4" },
      ],
    ],
    pauseAfter: 400,
  },
  // 11. Upload with watch mode
  {
    command: "cloudrouter upload cr_x7k9m2p ./src",
    output: [
      [
        { text: "Uploading ", color: "#d4d4d4" },
        { text: "./src", color: "#d4d4d4" },
        { text: " to cr_x7k9m2p:/home/user/workspace...", color: "#d4d4d4" },
      ],
      [
        { text: "✓ Synced 42 files (1.8 MB) in 1.1s (1.6 MB/s)", color: "#22c55e" },
      ],
    ],
    pauseAfter: 400,
  },
  // 12. List sandboxes
  {
    command: "cloudrouter ls",
    output: [
      [{ text: "Sandboxes:", color: "#d4d4d4" }],
      [
        { text: "  cr_x7k9m2p", color: "#d4d4d4" },
        { text: " - ", color: "#737373" },
        { text: "running", color: "#22c55e" },
        { text: " (my-app) [e2b]", color: "#a3a3a3" },
      ],
      [
        { text: "  cr_p3n8q1r", color: "#d4d4d4" },
        { text: " - ", color: "#737373" },
        { text: "running", color: "#22c55e" },
        { text: " (ml-train) [e2b]", color: "#a3a3a3" },
      ],
    ],
    pauseAfter: 500,
  },
  // 13. Start GPU sandbox
  {
    command: "cloudrouter start --gpu B200 --name gpu-training",
    output: [
      [{ text: "Waiting for sandbox to initialize.", color: "#d4d4d4" }],
      [
        { text: "Created sandbox: ", color: "#d4d4d4" },
        { text: "cr_g4h8j2k", color: "#d4d4d4" },
      ],
      [
        { text: "  Provider: ", color: "#d4d4d4" },
        { text: "modal", color: "#d4d4d4" },
      ],
      [
        { text: "  Status:   ", color: "#d4d4d4" },
        { text: "running", color: "#22c55e" },
      ],
      [
        { text: "  GPU:      ", color: "#d4d4d4" },
        { text: "B200 (192GB VRAM)", color: "#fbbf24" },
      ],
      [
        { text: "  Jupyter:  ", color: "#d4d4d4" },
        { text: "https://cr-g4h8j2k.modal.run/jupyter", color: "#38bdf8" },
      ],
    ],
  },
];

// --- Helpers ---

const CHAR_DELAY = 32;
const CHAR_VARIANCE = 18;
const STEP_PAUSE = 800;

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
  const [currentPrompt, setCurrentPrompt] = useState("~/my-app");
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
        const prompt = step.prompt ?? "~/my-app";

        setCurrentPrompt(prompt);
        setCurrentTyping("");
        setShowCursor(true);

        // Small pause before typing
        await sleep(300, signal);

        // Type the command
        await typeCommand(step.command, signal);

        // Brief pause after command is typed
        await sleep(200, signal);

        // "Submit" the command — add the prompt+command as a line
        const promptLine: LineFragment[] = [
          { text: `${prompt} `, color: "#22c55e" },
          { text: "$ ", color: "#737373" },
          { text: step.command, color: "#d4d4d4" },
        ];
        setCurrentTyping("");
        addLine(promptLine);

        // Output all lines at once (like a real terminal)
        setShowCursor(false);
        signal.throwIfAborted();
        for (const outputLine of step.output) {
          addLine(outputLine);
        }

        // Show prompt immediately after output (keep current dir, next step sets its own)
        setShowCursor(true);

        // Pause between steps
        const pause = step.pauseAfter ?? STEP_PAUSE;
        await sleep(pause + 400, signal);
      }

      // Demo complete
      setCurrentPrompt("~/my-app");
      setCurrentTyping("");
      setIsComplete(true);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // Aborted — skip to end
        return;
      }
      console.error("Terminal demo error:", err);
    } finally {
      setIsRunning(false);
      abortRef.current = null;
    }
  }, [isRunning, sleep, typeCommand, addLine]);

  const skipToEnd = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    // Render all steps at once
    const allLines: Array<{ key: string; content: Line }> = [];
    let counter = 0;
    for (const step of STEPS) {
      const prompt = step.prompt ?? "~/my-app";
      allLines.push({
        key: `line-${counter++}`,
        content: [
          { text: `${prompt} `, color: "#22c55e" },
          { text: "$ ", color: "#737373" },
          { text: step.command, color: "#d4d4d4" },
        ],
      });
      for (const outputLine of step.output) {
        allLines.push({ key: `line-${counter++}`, content: outputLine });
      }
    }
    lineCounterRef.current = counter;
    setLines(allLines);
    setCurrentPrompt("~/my-app");
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
    setCurrentPrompt("~/my-app");
    setIsComplete(false);
    setIsRunning(false);
    lineCounterRef.current = 0;
    // Small delay before restarting
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
            cloudrouter — bash
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
                <span style={{ color: "#22c55e" }}>{currentPrompt} </span>
                <span style={{ color: "#737373" }}>$ </span>
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
