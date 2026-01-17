import { createFileRoute } from "@tanstack/react-router";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { diffArrays } from "diff";
import type { editor } from "monaco-editor";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useTheme } from "@/components/theme/use-theme";
import { loaderInitPromise } from "@/lib/monaco-environment";

type DiffLineKind = "context" | "add" | "remove";

type DiffLine = {
  kind: DiffLineKind;
  content: string;
  originalLineNumber?: number;
  modifiedLineNumber?: number;
};

type DiffHunk = {
  originalStartLine: number;
  modifiedStartLine: number;
  lines: DiffLine[];
};

type FileDiff = {
  filePath: string;
  hunks: DiffHunk[];
};

type CombinedFileBoundary = {
  filePath: string;
  startLineNumber: number;
};

type CombinedDiffOutput = {
  originalText: string;
  modifiedText: string;
  originalLineNumbers: (number | null)[];
  modifiedLineNumbers: (number | null)[];
  fileBoundaries: CombinedFileBoundary[];
};

type MonacoLanguage =
  | "typescript"
  | "javascript"
  | "json"
  | "markdown"
  | "yaml"
  | "plaintext";

type DiffSample = {
  id: string;
  filePath: string;
  language: MonacoLanguage;
  original: string;
  modified: string;
};

const AUDIT_LOG_SEGMENT_COUNT = 240;
const auditLogSegmentOverrides = new Map<number, string>([
  [
    18,
    '    { id: "segment-019", throughput: 348, priority: 2, review: "daily" },',
  ],
  [
    124,
    '    { id: "segment-125", throughput: 1836, priority: 4, alerts: ["cpu", "io"] },',
  ],
  [
    219,
    '    { id: "segment-220", throughput: 2640, priority: 1, retentionOverride: "72h" },',
  ],
]);

const EXECUTION_PLAN_STAGE_COUNT = 140;
const executionPlanUpdates = new Map<
  number,
  { status: string; durationMs: number; retries: number }
>([
  [0, { status: "queued", durationMs: 45, retries: 1 }],
  [18, { status: "running", durationMs: 240, retries: 0 }],
  [47, { status: "running", durationMs: 420, retries: 2 }],
  [73, { status: "blocked", durationMs: 0, retries: 3 }],
  [96, { status: "queued", durationMs: 195, retries: 1 }],
  [119, { status: "completed", durationMs: 940, retries: 1 }],
  [139, { status: "completed", durationMs: 1230, retries: 2 }],
]);

const executionPlanInsertions = new Map<number, string[]>([
  [
    59,
    [
      '  { id: "stage-060-review", status: "blocked", durationMs: 0, retries: 2 },',
      '  { id: "stage-060-retry", status: "queued", durationMs: 42, retries: 3 },',
    ],
  ],
  [
    104,
    [
      '  { id: "stage-105-diagnostics", status: "running", durationMs: 720, retries: 1 },',
    ],
  ],
]);

function createSparseAuditLogSample(): DiffSample {
  const padLabel = (value: number) => value.toString().padStart(3, "0");

  const originalSegments: string[] = [];
  const modifiedSegments: string[] = [];

  for (let index = 0; index < AUDIT_LOG_SEGMENT_COUNT; index += 1) {
    const label = padLabel(index + 1);
    const baseLine = `    { id: "segment-${label}", throughput: ${(index + 1) * 12}, priority: ${
      (index % 5) + 1
    } },`;
    originalSegments.push(baseLine);

    const overrideLine = auditLogSegmentOverrides.get(index);
    if (overrideLine) {
      modifiedSegments.push(overrideLine);
    } else {
      modifiedSegments.push(baseLine);
    }
  }

  const originalParts: string[] = [
    "export const auditLogSchedule = {",
    "  retentionDays: 7,",
    "  compression: {",
    '    enabled: false,',
    '    strategy: "batch",',
    "  },",
    "  segments: [",
    ...originalSegments,
    "  ],",
    '  watermark: "v1.0.0",',
    "};",
  ];

  const modifiedParts: string[] = [
    "export const auditLogSchedule = {",
    "  retention: {",
    "    days: 7,",
    "    hours: 12,",
    "  },",
    "  compression: {",
    '    enabled: true,',
    '    strategy: "streaming",',
    '    window: "5m",',
    "  },",
    "  segments: [",
    ...modifiedSegments,
    "  ],",
    '  watermark: "v1.1.0",',
    "  review: {",
    '    window: "30d",',
    "  },",
    "};",
  ];

  return {
    id: "audit-log-schedule",
    filePath: "apps/server/src/config/audit-log-schedule.ts",
    language: "typescript",
    original: originalParts.join("\n"),
    modified: modifiedParts.join("\n"),
  };
}

function createLongExecutionPlanSample(): DiffSample {
  const padLabel = (value: number) => value.toString().padStart(3, "0");

  const originalParts: string[] = [
    "type ExecutionStage = {",
    '  id: string;',
    '  status: "pending" | "queued" | "running" | "blocked" | "completed";',
    "  durationMs?: number;",
    "};",
    "",
    "export const executionPlan: ExecutionStage[] = [",
  ];

  const modifiedParts: string[] = [
    "type ExecutionStage = {",
    '  id: string;',
    '  status: "pending" | "queued" | "running" | "blocked" | "completed";',
    "  durationMs?: number;",
    "  retries?: number;",
    "};",
    "",
    "export const executionPlan: ExecutionStage[] = [",
  ];

  for (let index = 0; index < EXECUTION_PLAN_STAGE_COUNT; index += 1) {
    const label = padLabel(index + 1);
    const baseLine = `  { id: "stage-${label}", status: "pending" },`;

    originalParts.push(baseLine);

    const updatedStage = executionPlanUpdates.get(index);
    if (updatedStage) {
      modifiedParts.push(
        `  { id: "stage-${label}", status: "${updatedStage.status}", durationMs: ${updatedStage.durationMs}, retries: ${updatedStage.retries} },`,
      );
    } else {
      modifiedParts.push(baseLine);
    }

    const insertions = executionPlanInsertions.get(index);
    if (insertions) {
      modifiedParts.push(...insertions);
    }
  }

  originalParts.push("];");
  modifiedParts.push("];");

  modifiedParts.push(
    "",
    "export function executionSummary(plan: ExecutionStage[]) {",
    "  return plan",
    "    .filter((stage) => (stage.retries ?? 0) > 0)",
    "    .map((stage) => `${stage.id}:${stage.retries ?? 0}`)",
    "    .join(\", \");",
    "}",
  );

  return {
    id: "execution-plan",
    filePath: "apps/server/src/plan/execution-plan.ts",
    language: "typescript",
    original: originalParts.join("\n"),
    modified: modifiedParts.join("\n"),
  };
}

const sparseAuditLogSample = createSparseAuditLogSample();
const longExecutionPlanSample = createLongExecutionPlanSample();

const diffSamples: DiffSample[] = [
  longExecutionPlanSample,
  sparseAuditLogSample,
  {
    id: "agents-selector",
    filePath: "packages/agents/src/selector.ts",
    language: "typescript",
    original: `export function rankAgents(agents: Array<{ latency: number }>) {
  return [...agents].sort((a, b) => a.latency - b.latency);
}

export function shouldWakeAgent(lastActiveAt: number, thresholdMs: number) {
  return Date.now() - lastActiveAt > thresholdMs;
}
`,
    modified: `export function rankAgents(agents: Array<{ latency: number; priority?: number }>) {
  return [...agents]
    .map((agent) => ({
      ...agent,
      score: (agent.priority ?? 0) * 1000 - agent.latency,
    }))
    .sort((a, b) => b.score - a.score);
}

export function shouldWakeAgent(lastActiveAt: number, thresholdMs: number) {
  const elapsed = Date.now() - lastActiveAt;
  return elapsed >= thresholdMs && thresholdMs > 0;
}
`,
  },
  {
    id: "feature-flags",
    filePath: "apps/server/src/config/feature-flags.ts",
    language: "typescript",
    original: `export type FeatureFlag = {
  name: string;
  enabled: boolean;
};

export const defaultFlags: FeatureFlag[] = [
  { name: "monaco-batch", enabled: false },
  { name: "agent-recording", enabled: false },
];
export function isEnabled(flags: FeatureFlag[], name: string) {
  return flags.some((flag) => flag.name === name && flag.enabled);
}
`,
    modified: `export type FeatureFlag = {
  name: string;
  enabled: boolean;
};

export const defaultFlags: FeatureFlag[] = [
  { name: "monaco-batch", enabled: true },
  { name: "agent-recording", enabled: false },
  { name: "structured-logs", enabled: true },
];

export function isEnabled(flags: FeatureFlag[], name: string) {
  const found = flags.find((flag) => flag.name === name);
  return found?.enabled ?? false;
}
`,
  },
  {
    id: "format-duration",
    filePath: "apps/client/src/utils/format-duration.ts",
    language: "typescript",
    original: `export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return seconds + "s";
}

export function formatLatency(latency: number) {
  return latency.toFixed(0) + "ms";
}
`,
    modified: `export function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes > 0
    ? minutes + "m " + remainingSeconds + "s"
    : seconds + "s";
}

export function formatLatency(latency: number) {
  return latency < 1
    ? (latency * 1000).toFixed(0) + "us"
    : latency.toFixed(2) + "ms";
}
`,
  },
  {
    id: "task-progress",
    filePath: "apps/client/src/hooks/use-task-progress.ts",
    language: "typescript",
    original: `export function getTaskProgress(task: { completeSteps: number; totalSteps: number }) {
  if (task.totalSteps === 0) {
    return 0;
  }

  return Math.round((task.completeSteps / task.totalSteps) * 100);
}

export function isTaskStale(updatedAt: number, now: number) {
  return now - updatedAt > 30_000;
}
`,
    modified: `export function getTaskProgress(task: { completeSteps: number; totalSteps: number }) {
  if (task.totalSteps === 0) {
    return 0;
  }

  const value = (task.completeSteps / task.totalSteps) * 100;
  return Math.min(100, Math.max(0, Math.round(value)));
}

export function isTaskStale(updatedAt: number, now: number) {
  const elapsed = now - updatedAt;
  return elapsed > 30_000 && elapsed > 0;
}
`,
  },
  {
    id: "session-handler",
    filePath: "apps/server/src/routes/session-handler.ts",
    language: "typescript",
    original: `export async function loadSession(id: string) {
  const response = await fetch("/api/sessions/" + id);
  if (!response.ok) {
    throw new Error("Failed to load session");
  }

  return response.json();
}

export async function archiveSession(id: string) {
  const response = await fetch("/api/sessions/" + id + "/archive", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to archive session");
  }
}
`,
    modified: `export async function loadSession(id: string) {
  const response = await fetch("/api/sessions/" + id);
  if (!response.ok) {
    throw new Error("Failed to load session");
  }

  const payload = await response.json();
  return {
    ...payload,
    loadedAt: Date.now(),
  };
}

export async function archiveSession(id: string) {
  const response = await fetch("/api/sessions/" + id + "/archive", { method: "POST" });
  if (!response.ok) {
    throw new Error("Failed to archive session");
  }

  return { archiveRequestedAt: Date.now() };
}
`,
  },
  {
    id: "shared-logger",
    filePath: "packages/shared/src/logger.ts",
    language: "typescript",
    original: `export function logInfo(message: string) {
  console.info(message);
}

export function logError(message: string, error?: unknown) {
  console.error(message, error);
}
`,
    modified: `export function logInfo(message: string, context: Record<string, unknown> = {}) {
  console.info("[info] " + message, context);
}

export function logError(message: string, error?: unknown) {
  console.error("[error] " + message, error);
  if (error instanceof Error && error.stack) {
    console.error(error.stack);
  }
}
`,
  },
  {
    id: "run-timers",
    filePath: "apps/client/src/store/run-timers.ts",
    language: "typescript",
    original: `export function startTimer(label: string) {
  performance.mark(label + "-start");
}

export function endTimer(label: string) {
  performance.mark(label + "-end");
  performance.measure(label, label + "-start", label + "-end");
}
`,
    modified: `export function startTimer(label: string) {
  performance.mark(label + "-start");
  console.time(label);
}

export function endTimer(label: string) {
  performance.mark(label + "-end");
  performance.measure(label, label + "-start", label + "-end");
  console.timeEnd(label);
}
`,
  },
  {
    id: "workflows-yaml",
    filePath: "apps/server/src/config/workflows.yaml",
    language: "yaml",
    original: `workflows:
  deploy:
    steps:
      - checkout
      - install
      - build
      - smoke
  verify:
    steps:
      - lint
      - typecheck
      - test
      - coverage
  nightly:
    steps:
      - migrate
      - seed
      - e2e
      - report
`,
    modified: `workflows:
  deploy:
    steps:
      - checkout
      - install
      - build
      - package
      - smoke
  verify:
    steps:
      - lint
      - typecheck
      - test
      - coverage
      - mutation
  nightly:
    steps:
      - migrate
      - seed
      - e2e
      - report
      - snapshot
  cleanup:
    steps:
      - prune
      - rotate-logs
`,
  },
  {
    id: "changelog",
    filePath: "apps/client/src/content/changelog.md",
    language: "markdown",
    original: `## v0.13.0

- add multi-agent support
- improve telemetry

## v0.12.5

- add new worker pool
- fix diff layout

## v0.12.0

- bug fixes
- reduce bundle size

## v0.11.0

- initial release
- support debug routes
`,
    modified: `## v0.13.0

- add multi-agent support
- improve telemetry
- new diff viewer sandbox

## v0.12.5

- add new worker pool
- fix diff layout
- experimental timeline

## v0.12.0

- bug fixes
- reduce bundle size
- document retry semantics

## v0.11.0

- initial release
- support debug routes
- added debug tools
`,
  },
  {
    id: "runtime-schema",
    filePath: "packages/runtime/src/schema.json",
    language: "json",
    original: `{
  "version": 1,
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "status", "type": "string" }
  ],
  "indexes": []
}
`,
    modified: `{
  "version": 1,
  "fields": [
    { "name": "id", "type": "string" },
    { "name": "status", "type": "string" },
    { "name": "createdAt", "type": "number" }
  ],
  "indexes": [
    { "name": "by_status", "fields": ["status"] }
  ]
}
`,
  },
];

const multiFileDiffExample = diffSamples.map(createFileDiffFromSample);

const FILE_LABEL_ZONE_HEIGHT = 32;

export const Route = createFileRoute("/monaco-single-buffer")({
  component: MonacoSingleBufferRoute,
});

function MonacoSingleBufferRoute() {
  const { theme } = useTheme();
  const [isReady, setIsReady] = useState(false);
  const overlayRootRef = useRef<HTMLDivElement | null>(null);
  const unifiedOverlayRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    loaderInitPromise
      .then(() => {
        if (!cancelled) {
          setIsReady(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to initialize Monaco", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const diffData = useMemo(() => multiFileDiffExample, []);
  const combinedDiff = useMemo<CombinedDiffOutput>(() => buildCombinedDiff(diffData), [diffData]);

  const editorTheme = theme === "dark" ? "vs-dark" : "vs";

  const diffOptions = useMemo<editor.IDiffEditorConstructionOptions>(
    () => ({
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      readOnly: true,
      originalEditable: false,
      enableSplitViewResizing: true,
      minimap: { enabled: false },
      renderOverviewRuler: false,
      smoothScrolling: true,
      hideUnchangedRegions: {
        enabled: true,
        revealLineCount: 2,
        minimumLineCount: 6,
        contextLineCount: 3,
      },
      scrollbar: {
        useShadows: false,
        vertical: "auto",
        horizontal: "auto",
      },
      lineDecorationsWidth: 48,
      lineNumbers: "on",
      wordWrap: "on",
    }),
    [],
  );

  const handleMount: DiffOnMount = (editorInstance, _monacoInstance) => {
    const originalEditor = editorInstance.getOriginalEditor();
    const modifiedEditor = editorInstance.getModifiedEditor();

    originalEditor.updateOptions({
      lineNumbers: (lineNumber) =>
        formatLineNumber(combinedDiff.originalLineNumbers, lineNumber),
    });

    modifiedEditor.updateOptions({
      lineNumbers: (lineNumber) =>
        formatLineNumber(combinedDiff.modifiedLineNumbers, lineNumber),
    });

    const container = overlayRootRef.current;
    if (!container) {
      return;
    }

    const disposeHeaderOverlay = setupHeaderOverlay({
      container,
      boundaries: combinedDiff.fileBoundaries,
      originalEditor,
      modifiedEditor,
      overlayContainer: unifiedOverlayRef.current,
      theme,
    });

    editorInstance.onDidDispose(() => {
      disposeHeaderOverlay();
    });
  };

  if (!isReady) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-neutral-100 text-neutral-800 dark:bg-neutral-950 dark:text-neutral-100">
        <span className="text-sm tracking-wide text-neutral-600 dark:text-neutral-400">
          Loading Monaco diff…
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-neutral-100 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      <header className="flex flex-col gap-1 border-b border-neutral-200 px-6 py-5 dark:border-neutral-800">
        <h1 className="text-2xl font-semibold">Monaco Multi-file Diff Sandbox</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Visualize 10 synthetic files with 20 hunks collapsed into a single buffer. View zones mark
          file boundaries and content widgets display the file names.
        </p>
      </header>
      <main className="flex flex-1 flex-col gap-4 px-4 py-4 md:px-6 lg:px-8">
        <section className="flex-1 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
          <div ref={overlayRootRef} className="relative h-[80vh]">
            <div ref={unifiedOverlayRef} className="pointer-events-none absolute inset-0 z-40" />
            <DiffEditor
              key={theme}
              theme={editorTheme}
              options={diffOptions}
              height="100%"
              original={combinedDiff.originalText}
              modified={combinedDiff.modifiedText}
              originalLanguage="plaintext"
              modifiedLanguage="plaintext"
              onMount={handleMount}
            />
          </div>
        </section>
        <section className="rounded-lg border border-dashed border-neutral-300 bg-white/70 p-4 text-xs text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900/60 dark:text-neutral-400">
          Line numbers reuse the original hunks through a mapping array so the Monaco gutter matches
          real file positions. The view zones reserve {FILE_LABEL_ZONE_HEIGHT}px for each file label
          and the paired content widgets render the filename overlays.
        </section>
      </main>
    </div>
  );
}

function formatLineNumber(map: (number | null)[], lineNumber: number): string {
  const mapped = map[lineNumber - 1];
  if (typeof mapped === "number") {
    return mapped.toString();
  }
  return "";
}

function groupDiffsByFile(diffFiles: FileDiff[]): FileDiff[] {
  const grouped = new Map<string, DiffHunk[]>();
  const fileOrder: string[] = [];

  diffFiles.forEach(({ filePath, hunks }) => {
    if (!grouped.has(filePath)) {
      grouped.set(filePath, []);
      fileOrder.push(filePath);
    }

    const stored = grouped.get(filePath);
    if (!stored) {
      return;
    }

    stored.push(...hunks);
  });

  return fileOrder.map((filePath) => {
    const hunks = grouped.get(filePath) ?? [];
    const sortedHunks = [...hunks].sort((left, right) => {
      if (left.originalStartLine !== right.originalStartLine) {
        return left.originalStartLine - right.originalStartLine;
      }

      return left.modifiedStartLine - right.modifiedStartLine;
    });

    return { filePath, hunks: sortedHunks };
  });
}

function buildCombinedDiff(diffFiles: FileDiff[]): CombinedDiffOutput {
  const groupedDiffFiles = groupDiffsByFile(diffFiles);
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  const originalNumbers: (number | null)[] = [];
  const modifiedNumbers: (number | null)[] = [];
  const fileBoundaries: CombinedFileBoundary[] = [];

  let totalLines = 0;

  groupedDiffFiles.forEach((fileDiff) => {
    const startLineNumber = totalLines + 1;
    fileBoundaries.push({ filePath: fileDiff.filePath, startLineNumber });

    fileDiff.hunks.forEach((hunk, hunkIndex) => {
      hunk.lines.forEach((line) => {
        switch (line.kind) {
          case "context": {
            originalLines.push(line.content);
            modifiedLines.push(line.content);
            originalNumbers.push(line.originalLineNumber ?? null);
            modifiedNumbers.push(line.modifiedLineNumber ?? null);
            totalLines += 1;
            break;
          }
          case "remove": {
            originalLines.push(line.content);
            modifiedLines.push("");
            originalNumbers.push(line.originalLineNumber ?? null);
            modifiedNumbers.push(null);
            totalLines += 1;
            break;
          }
          case "add": {
            originalLines.push("");
            modifiedLines.push(line.content);
            originalNumbers.push(null);
            modifiedNumbers.push(line.modifiedLineNumber ?? null);
            totalLines += 1;
            break;
          }
        }
      });

      if (hunkIndex < fileDiff.hunks.length - 1) {
        originalLines.push("");
        modifiedLines.push("");
        originalNumbers.push(null);
        modifiedNumbers.push(null);
        totalLines += 1;
      }
    });

  });

  return {
    originalText: originalLines.join("\n"),
    modifiedText: modifiedLines.join("\n"),
    originalLineNumbers: originalNumbers,
    modifiedLineNumbers: modifiedNumbers,
    fileBoundaries,
  };
}

type SetupHeaderOverlayParams = {
  container: HTMLElement;
  originalEditor: editor.ICodeEditor;
  modifiedEditor: editor.ICodeEditor;
  boundaries: CombinedFileBoundary[];
  overlayContainer: HTMLElement | null;
  theme: string;
};

function setupHeaderOverlay({
  container,
  originalEditor,
  modifiedEditor,
  boundaries,
  overlayContainer,
  theme,
}: SetupHeaderOverlayParams) {
  if (!overlayContainer) {
    return () => {};
  }

  const originalZones = registerBoundaryZones({ editor: originalEditor, boundaries });
  const modifiedZones = registerBoundaryZones({ editor: modifiedEditor, boundaries });

  const disposeOverlay = createUnifiedOverlay({
    container,
    overlayRoot: overlayContainer,
    boundaries,
    theme,
    referenceNodes: modifiedZones.zoneNodes,
    editors: [originalEditor, modifiedEditor],
  });

  return () => {
    disposeOverlay();
    originalZones.dispose();
    modifiedZones.dispose();
    overlayContainer.replaceChildren();
  };
}
type BoundaryZoneRegistration = {
  zoneIds: string[];
  zoneNodes: HTMLElement[];
  dispose: () => void;
};

type Disposable = {
  dispose: () => void;
};

function registerBoundaryZones({
  editor,
  boundaries,
}: {
  editor: editor.ICodeEditor;
  boundaries: CombinedFileBoundary[];
}): BoundaryZoneRegistration {
  if (boundaries.length === 0) {
    return {
      zoneIds: [],
      zoneNodes: [],
      dispose: () => {},
    };
  }

  const zoneIds: string[] = [];
  const zoneNodes: HTMLElement[] = [];

  editor.changeViewZones((accessor) => {
    boundaries.forEach((boundary, index) => {
      const domNode = document.createElement("div");
      domNode.style.height = `${FILE_LABEL_ZONE_HEIGHT}px`;
      domNode.style.width = "100%";
      domNode.style.pointerEvents = "none";
      domNode.style.background = "transparent";

      const zoneId = accessor.addZone({
        afterLineNumber: Math.max(boundary.startLineNumber - 1, 0),
        domNode,
        heightInPx: FILE_LABEL_ZONE_HEIGHT,
      });

      zoneIds.push(zoneId);
      zoneNodes[index] = domNode;
    });
  });

  return {
    zoneIds,
    zoneNodes,
    dispose: () => {
      editor.changeViewZones((accessor) => {
        zoneIds.forEach((zoneId) => accessor.removeZone(zoneId));
      });
    },
  };
}

type UnifiedOverlayOptions = {
  container: HTMLElement;
  overlayRoot: HTMLElement;
  boundaries: CombinedFileBoundary[];
  theme: string;
  referenceNodes: HTMLElement[];
  editors: editor.ICodeEditor[];
};

function createUnifiedOverlay({
  container,
  overlayRoot,
  boundaries,
  theme,
  referenceNodes,
  editors,
}: UnifiedOverlayOptions): () => void {
  if (boundaries.length === 0) {
    overlayRoot.replaceChildren();
    return () => {
      overlayRoot.replaceChildren();
    };
  }

  overlayRoot.replaceChildren();
  overlayRoot.style.position = "absolute";
  overlayRoot.style.top = "0";
  overlayRoot.style.left = "0";
  overlayRoot.style.width = "100%";
  overlayRoot.style.height = "100%";
  overlayRoot.style.pointerEvents = "none";
  overlayRoot.style.zIndex = "46";

  const labelStyle = getUnifiedLabelStyle(theme);
  const labelNodes: HTMLElement[] = [];

  boundaries.forEach((boundary, index) => {
    const label = document.createElement("div");
    applyStyles(label, labelStyle);
    label.textContent = boundary.filePath;
    label.style.position = "absolute";
    label.style.left = "0";
    label.style.right = "0";
    label.style.zIndex = `${100 + index}`;
    overlayRoot.appendChild(label);
    labelNodes[index] = label;
  });

  let rafToken: number | null = null;

  const compute = () => {
    const containerRect = container.getBoundingClientRect();

    labelNodes.forEach((label, index) => {
      const node = referenceNodes[index];
      if (!label || !node) {
        return;
      }

      const rect = node.getBoundingClientRect();
      if (!Number.isFinite(rect.top)) {
        return;
      }

      let y = rect.top - containerRect.top;
      if (y < 0) {
        y = 0;
      }

      const nextNode = referenceNodes[index + 1];
      if (nextNode) {
        const nextRect = nextNode.getBoundingClientRect();
        const maxY = nextRect.top - containerRect.top - FILE_LABEL_ZONE_HEIGHT;
        if (Number.isFinite(maxY)) {
          y = Math.min(y, Math.max(maxY, 0));
        }
      }

      label.style.transform = `translateY(${y}px)`;
      const boundary = boundaries[index];
      if (boundary) {
        console.debug("Unified overlay translateY", {
          index,
          filePath: boundary.filePath,
          y,
        });
      }
    });
  };

  const scheduleUpdate = () => {
    if (rafToken !== null) {
      cancelAnimationFrame(rafToken);
    }
    rafToken = requestAnimationFrame(() => {
      rafToken = null;
      compute();
    });
  };

  const disposables: Disposable[] = [];
  editors.forEach((currentEditor) => {
    const handleScrollChange: Parameters<editor.ICodeEditor["onDidScrollChange"]>[0] = (
      event,
    ) => {
      console.debug("Unified overlay scroll", {
        editorId: currentEditor.getId(),
        scrollTop: event.scrollTop,
        scrollTopChanged: event.scrollTopChanged,
        scrollLeft: event.scrollLeft,
        scrollLeftChanged: event.scrollLeftChanged,
      });
      scheduleUpdate();
    };

    disposables.push(
      currentEditor.onDidScrollChange(handleScrollChange),
      currentEditor.onDidLayoutChange(scheduleUpdate),
      currentEditor.onDidContentSizeChange(scheduleUpdate),
    );
  });

  const resizeObserver = new ResizeObserver(scheduleUpdate);
  resizeObserver.observe(container);
  referenceNodes.forEach((node) => {
    if (node) {
      resizeObserver.observe(node);
    }
  });

  scheduleUpdate();

  return () => {
    if (rafToken !== null) {
      cancelAnimationFrame(rafToken);
      rafToken = null;
    }

    resizeObserver.disconnect();
    disposables.forEach((disposable) => disposable.dispose());
    overlayRoot.replaceChildren();
  };
}

function getUnifiedLabelStyle(theme: string): CSSProperties {
  return {
    height: `${FILE_LABEL_ZONE_HEIGHT}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "0 24px",
    fontFamily: '"JetBrains Mono", "Fira Code", "SFMono-Regular", monospace',
    fontSize: "12px",
    letterSpacing: "0.02em",
    textTransform: "uppercase",
    fontWeight: 600,
    borderRadius: "8px",
    border: theme === "dark" ? "1px solid #3f3f46" : "1px solid #d4d4d8",
    background: theme === "dark" ? "rgba(32,32,36,0.92)" : "rgba(248,248,249,0.95)",
    color: theme === "dark" ? "#e5e5e5" : "#1f2937",
    boxSizing: "border-box",
    boxShadow: "none",
    pointerEvents: "none",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    width: "100%",
  };
}


function applyStyles(element: HTMLElement, styles: CSSProperties) {
  Object.entries(styles).forEach(([property, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    const typedValue = typeof value === "number" ? `${value}` : value;
    const style = element.style as unknown as Record<string, string>;
    style[property] = typedValue;
  });
}


function createFileDiffFromSample(sample: DiffSample): FileDiff {
  const lines = computeDiffLines(sample.original, sample.modified);

  const firstOriginalLine = lines.find((line) => typeof line.originalLineNumber === "number")
    ?.originalLineNumber;
  const firstModifiedLine = lines.find((line) => typeof line.modifiedLineNumber === "number")
    ?.modifiedLineNumber;

  return {
    filePath: sample.filePath,
    hunks: [
      {
        originalStartLine: firstOriginalLine ?? 1,
        modifiedStartLine: firstModifiedLine ?? 1,
        lines,
      },
    ],
  };
}

function computeDiffLines(originalContent: string, modifiedContent: string): DiffLine[] {
  const originalLines = splitLines(originalContent);
  const modifiedLines = splitLines(modifiedContent);
  const changes = diffArrays(originalLines, modifiedLines);

  const lines: DiffLine[] = [];
  let originalLineNumber = 1;
  let modifiedLineNumber = 1;

  changes.forEach((change) => {
    const changeLines = change.value;

    if (change.added) {
      changeLines.forEach((content) => {
        lines.push(createAddLine(content, modifiedLineNumber));
        modifiedLineNumber += 1;
      });
      return;
    }

    if (change.removed) {
      changeLines.forEach((content) => {
        lines.push(createRemoveLine(content, originalLineNumber));
        originalLineNumber += 1;
      });
      return;
    }

    changeLines.forEach((content) => {
      lines.push(createContextLine(content, originalLineNumber, modifiedLineNumber));
      originalLineNumber += 1;
      modifiedLineNumber += 1;
    });
  });

  return lines;
}

function splitLines(content: string): string[] {
  const normalized = content.replace(/\r\n/g, "\n");
  return normalized.split("\n");
}

function createContextLine(content: string, originalLineNumber: number, modifiedLineNumber: number): DiffLine {
  return {
    kind: "context",
    content,
    originalLineNumber,
    modifiedLineNumber,
  };
}

function createAddLine(content: string, modifiedLineNumber: number): DiffLine {
  return {
    kind: "add",
    content,
    modifiedLineNumber,
  };
}

function createRemoveLine(content: string, originalLineNumber: number): DiffLine {
  return {
    kind: "remove",
    content,
    originalLineNumber,
  };
}
