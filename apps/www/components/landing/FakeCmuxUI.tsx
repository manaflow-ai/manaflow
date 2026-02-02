"use client";

import { useEffect, useRef, useState } from "react";
import CmuxLogo from "@/components/logo/cmux-logo";

// Drag bounds - defined outside component to avoid dependency issues
const BOUNDS = { minX: -200, maxX: 200, minY: -50, maxY: 100 };

export type FakeCmuxUIVariant = "dashboard" | "tasks" | "diff" | "pr";

type TaskStatus = "complete" | "running" | "pending";
type SidebarRunChildType = "vscode" | "diff";

type SidebarRunChild = {
  type: SidebarRunChildType;
  label: string;
};

type SidebarRun = {
  name: string;
  status: TaskStatus;
  children?: SidebarRunChild[];
};

type SidebarTask = {
  title: string;
  status: TaskStatus;
  expanded?: boolean;
  runs?: SidebarRun[];
};

type TaskRowStatus = "ready" | "running" | "blocked";

type TaskRow = {
  title: string;
  repo: string;
  time: string;
  status: TaskRowStatus;
};

type TaskCategory = {
  title: string;
  items: TaskRow[];
};

type PullRequestRow = {
  title: string;
  repo: string;
  status: "success" | "pending";
};

type IconProps = {
  className?: string;
};

export type FakeCmuxUIProps = {
  variant?: FakeCmuxUIVariant;
  draggable?: boolean;
  showDragHint?: boolean;
  className?: string;
};

function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function GitBranchIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

function ImageIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
      />
    </svg>
  );
}

function MicIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
      />
    </svg>
  );
}

function VSCodeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.583 2.414L12.93 6.07l-5.26-3.54L6.5 3.26v17.48l1.17.73 5.26-3.54 4.653 3.656 3.917-2.052V4.466l-3.917-2.052zM12 15.666L8.333 12 12 8.334v7.332z" />
    </svg>
  );
}

function GitDiffIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
    </svg>
  );
}

function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function CloudIcon({ className }: IconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999A5.002 5.002 0 106.22 11.1 4.001 4.001 0 003 15z"
      />
    </svg>
  );
}

function SidebarStatusIcon({ status }: { status: TaskStatus }) {
  if (status === "complete") {
    return (
      <svg className="w-3 h-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === "running") {
    return <div className="w-3 h-3 border border-blue-500 border-t-transparent rounded-full animate-spin" />;
  }
  return <div className="w-3 h-3 rounded-full border border-neutral-500" />;
}

function TaskRowStatusDot({ status }: { status: TaskRowStatus }) {
  const baseClass = "w-[9px] h-[9px] rounded-full";
  if (status === "ready") {
    return <span className={`${baseClass} bg-green-500`} />;
  }
  if (status === "running") {
    return <span className={`${baseClass} bg-blue-500`} />;
  }
  return <span className={`${baseClass} bg-orange-500`} />;
}

const pullRequests: PullRequestRow[] = [
  { title: "Devbox", repo: "cmux/devbox-v1", status: "success" },
  { title: "chore: daily morph snapshot...", repo: "morph-snapshot-20260120-...", status: "success" },
  { title: "chore: daily morph snapshot...", repo: "morph-snapshot-20260119-...", status: "success" },
  { title: "Add iOS app with Stack Au...", repo: "swift-ios-clean", status: "pending" },
  { title: "chore: daily morph snapshot...", repo: "morph-snapshot-20260118-...", status: "success" },
];

const sidebarTasks: SidebarTask[] = [
  {
    title: "Refactor Mac download...",
    status: "complete",
    expanded: true,
    runs: [
      {
        name: "claude/opus-4.5",
        status: "complete",
        children: [
          { type: "vscode", label: "VS Code" },
          { type: "diff", label: "Git diff" },
        ],
      },
      {
        name: "codex/gpt-5-high",
        status: "running",
        children: [
          { type: "vscode", label: "VS Code" },
          { type: "diff", label: "Git diff" },
        ],
      },
    ],
  },
  {
    title: "Configure API key helper",
    status: "running",
  },
  {
    title: "Implement Electron autoupdater",
    status: "pending",
  },
  {
    title: "Clean up onboarding flow",
    status: "complete",
  },
];

const taskCategories: TaskCategory[] = [
  {
    title: "Pinned",
    items: [
      {
        title: "we need to implement rsync between the local vscode to the cloud vscode for th...",
        repo: "cmux",
        time: "Jan 28",
        status: "ready",
      },
      {
        title: "our normal git diff viewer should have the sidebar thing where we can easily filter...",
        repo: "cmux-helpers",
        time: "Jan 27",
        status: "ready",
      },
      {
        title: "i think the trimming feature in the hostScreenshotCollector is too much...",
        repo: "cmux",
        time: "Jan 26",
        status: "ready",
      },
      {
        title: "for some reason the cmux terminal is still not showing up all of the time...",
        repo: "cmux",
        time: "Jan 26",
        status: "ready",
      },
      {
        title: "currently the host screenshot agent is calling a script to process the videos it ma...",
        repo: "cmux",
        time: "Jan 26",
        status: "ready",
      },
    ],
  },
];

const runningCategories: TaskCategory[] = [
  {
    title: "In progress",
    items: [
      {
        title: "Fix auth bug (Claude)",
        repo: "cmux",
        time: "2m",
        status: "running",
      },
      {
        title: "Fix auth bug (Codex)",
        repo: "cmux",
        time: "3m",
        status: "running",
      },
      {
        title: "Fix auth bug (Gemini)",
        repo: "cmux",
        time: "Done",
        status: "ready",
      },
    ],
  },
];

function SidebarSectionLabel({ children }: { children: string }) {
  return (
    <div className="text-[11px] text-neutral-500 uppercase tracking-wider px-2 pt-3 pb-1">
      {children}
    </div>
  );
}

function PullRequestStatus({ status }: { status: PullRequestRow["status"] }) {
  if (status === "pending") {
    return <div className="w-2 h-2 rounded-full bg-orange-500" />;
  }
  return <div className="w-2 h-2 rounded-full bg-green-500" />;
}

function TaskTabs({ active }: { active: "tasks" | "previews" | "archived" }) {
  const tabClass = (tab: "tasks" | "previews" | "archived") =>
    `text-[13px] font-medium transition-colors ${
      active === tab ? "text-neutral-200" : "text-neutral-500"
    }`;
  return (
    <div className="border-b border-neutral-800 bg-neutral-900/70 px-4 py-2">
      <div className="flex items-end gap-2.5 select-none">
        <span className={tabClass("tasks")}>Tasks</span>
        <span className={tabClass("previews")}>Previews</span>
        <span className={tabClass("archived")}>Archived</span>
      </div>
    </div>
  );
}

function TaskCategorySection({ category }: { category: TaskCategory }) {
  return (
    <div className="w-full">
      <div className="sticky top-0 z-10 flex w-full border-y border-neutral-800 bg-neutral-900/70 select-none">
        <div className="flex w-full items-center pr-4">
          <button
            className="flex h-9 w-9 items-center justify-center text-neutral-500 hover:text-neutral-200"
            type="button"
          >
            <ChevronRightIcon className="h-3 w-3 rotate-90" />
          </button>
          <div className="flex items-center gap-2 text-xs font-medium tracking-tight text-neutral-200">
            <span>{category.title}</span>
            <span className="text-xs text-neutral-500">{category.items.length}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col w-full">
        {category.items.map((task) => (
          <div
            key={`${task.title}-${task.time}`}
            className="relative grid w-full items-center py-2 pr-3 cursor-default select-none grid-cols-[22px_30px_1fr_minmax(120px,auto)_58px] bg-neutral-900/50 hover:bg-neutral-800/60"
          >
            <div className="flex items-center justify-center pl-1 -mr-2 relative">
              <div className="w-3 h-3 rounded border border-neutral-600 bg-neutral-900" />
            </div>
            <div className="flex items-center justify-center">
              <TaskRowStatusDot status={task.status} />
            </div>
            <div className="min-w-0 flex items-center">
              <span className="text-[13px] font-medium truncate min-w-0 pr-1 text-neutral-200">
                {task.title}
              </span>
            </div>
            <div className="text-[11px] text-neutral-500 min-w-0 text-right">{task.repo}</div>
            <div className="text-[11px] text-neutral-500 flex-shrink-0 tabular-nums text-right">
              {task.time}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DashboardInputCard() {
  return (
    <div className="max-w-[640px]">
      <div className="relative bg-neutral-900 border border-neutral-800 rounded-2xl">
        <div className="px-4 pt-3 text-[15px] text-neutral-500 min-h-[60px]">
          Describe a task
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 mb-2">
            <button
              className="relative inline-flex h-7 items-center rounded-full border border-neutral-700 bg-neutral-900 px-3 pr-7 text-[13px] text-neutral-200"
              type="button"
            >
              <span className="flex items-center gap-1.5 pr-1">
                <span className="text-neutral-400">@</span>
                manaflow-ai/cmux
              </span>
              <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
            </button>
            <button
              className="relative inline-flex h-7 items-center rounded-full border border-neutral-700 bg-neutral-900 px-3 pr-7 text-[13px] text-neutral-200"
              type="button"
            >
              <span className="flex items-center gap-1.5 pr-1">
                <GitBranchIcon className="w-4 h-4 text-neutral-500" />
                main
              </span>
              <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <button
              className="relative inline-flex h-7 items-center rounded-full border border-neutral-700 bg-neutral-900 px-3 pr-7 text-[13px] text-neutral-200"
              type="button"
            >
              <span className="flex items-center gap-1.5 pr-1">
                <span className="flex">
                  <span className="text-orange-500 -mr-0.5">✦</span>
                  <span className="text-pink-500 -mr-0.5">✦</span>
                </span>
                codex/gpt-5.2-codex-xhigh
              </span>
              <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
            </button>
            <div className="flex items-center gap-2">
              <button
                className="w-8 h-8 rounded-full bg-blue-500/20 border border-blue-500/40 text-blue-300 flex items-center justify-center"
                type="button"
              >
                <CloudIcon className="w-4 h-4" />
              </button>
              <button
                className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 flex items-center justify-center"
                type="button"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                className="w-8 h-8 rounded-full bg-neutral-800 border border-neutral-700 text-neutral-400 flex items-center justify-center"
                type="button"
              >
                <MicIcon className="w-4 h-4" />
              </button>
              <button
                className="h-8 px-3 rounded-md bg-neutral-800 text-neutral-500 border border-neutral-700 text-xs font-medium cursor-not-allowed"
                type="button"
              >
                Start task
              </button>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-neutral-500">
            Configure workspace for manaflow-ai/cmux
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardTasks({ categories }: { categories: TaskCategory[] }) {
  return (
    <div className="flex-1 border-t border-neutral-800 bg-neutral-950/70 overflow-hidden">
      <TaskTabs active="tasks" />
      <div className="flex flex-col gap-1 w-full">
        {categories.map((category) => (
          <TaskCategorySection key={category.title} category={category} />
        ))}
      </div>
    </div>
  );
}

function DiffView() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 text-[12px]">
        <span className="px-2 py-1 rounded-md bg-neutral-800 text-neutral-200 font-medium">Diff</span>
        <span className="text-neutral-500">Terminal</span>
        <span className="text-neutral-500">Preview</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <div className="border-b border-neutral-800 bg-neutral-950/60 px-3.5 py-3 text-xs text-neutral-500">
          Loading screenshots...
        </div>
        <div className="h-full overflow-auto bg-neutral-950 px-3 py-2 font-mono text-[11px] text-neutral-200">
          <div className="text-neutral-500">apps/www/components/landing/Hero.tsx</div>
          <div className="text-red-400">- className=&quot;bg-neutral-900&quot;</div>
          <div className="text-green-400">+ className=&quot;bg-neutral-950&quot;</div>
          <div className="text-neutral-500 mt-2">apps/www/components/landing/CTA.tsx</div>
          <div className="text-green-400">+ Added new gradient highlight</div>
        </div>
      </div>
    </div>
  );
}

function PullRequestView() {
  return (
    <div className="flex flex-col h-full px-4 py-3 gap-3">
      <div>
        <div className="text-[11px] text-neutral-500 mb-1">Title</div>
        <div className="bg-neutral-900 rounded-md px-2 py-1.5 text-[12px] text-neutral-200 border border-neutral-800">
          feat: implement secure auth flow
        </div>
      </div>
      <div>
        <div className="text-[11px] text-neutral-500 mb-1">Description</div>
        <div className="bg-neutral-900 rounded-md px-2 py-1.5 text-[11px] text-neutral-400 border border-neutral-800 h-16">
          - Migrated to secure_auth()<br />
          - Added comprehensive tests<br />
          - Verified in preview
        </div>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-neutral-500">
        <div className="w-3 h-3 bg-green-500 rounded-full flex items-center justify-center">
          <svg className="w-2 h-2 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <span>All checks passed</span>
      </div>
      <button
        className="mt-auto flex items-center gap-1.5 px-3 py-1 h-[26px] bg-[#1f883d] text-white rounded hover:bg-[#1f883d]/90 font-medium text-xs select-none whitespace-nowrap"
        type="button"
      >
        Open PR
      </button>
    </div>
  );
}

export default function FakeCmuxUI({
  variant = "dashboard",
  draggable = true,
  showDragHint = true,
  className,
}: FakeCmuxUIProps) {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
  } | null>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging || !dragRef.current) return;
      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;

      const newX = Math.max(
        BOUNDS.minX,
        Math.min(BOUNDS.maxX, dragRef.current.initialX + deltaX)
      );
      const newY = Math.max(
        BOUNDS.minY,
        Math.min(BOUNDS.maxY, dragRef.current.initialY + deltaY)
      );

      setPosition({ x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!draggable) return;
    if (!(e.target instanceof HTMLElement)) return;
    if (!e.target.closest("[data-drag-handle]")) return;
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initialX: position.x,
      initialY: position.y,
    };
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
  };

  const categories = variant === "tasks" ? runningCategories : taskCategories;

  return (
    <div
      ref={containerRef}
      className={`relative w-full max-w-5xl mx-auto ${className ?? ""}`}
      style={{
        transform: `translate(${position.x}px, ${position.y}px)`,
        transition: isDragging ? "none" : "transform 0.1s ease-out",
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="bg-neutral-950 rounded-xl shadow-2xl shadow-black/60 border border-neutral-800 overflow-hidden">
        <div className="flex h-[520px]">
          {/* Sidebar */}
          <div className="w-[260px] bg-neutral-950 flex flex-col shrink-0 border-r border-neutral-800">
            <div
              data-drag-handle
              className="h-[38px] flex items-center pr-1 shrink-0 pl-3 cursor-grab active:cursor-grabbing"
            >
              <div className="flex gap-2 mr-3">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              </div>
              <CmuxLogo
                height={20}
                className="text-neutral-200"
                wordmarkFill="currentColor"
              />
              <div className="grow" />
              <button
                className="w-[25px] h-[25px] border border-neutral-700 hover:bg-neutral-900 rounded-lg flex items-center justify-center"
                type="button"
              >
                <PlusIcon className="w-4 h-4 text-neutral-400" />
              </button>
            </div>

            <nav className="grow flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto pb-4">
                <SidebarSectionLabel>Pull requests</SidebarSectionLabel>
                <div className="ml-2 pr-2 space-y-1">
                  {pullRequests.map((pr) => (
                    <div key={`${pr.title}-${pr.repo}`} className="flex items-center gap-2 text-[12px] text-neutral-300 hover:text-neutral-200 cursor-default">
                      <ChevronRightIcon className="w-3 h-3 text-neutral-600" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{pr.title}</div>
                        <div className="text-[10px] text-neutral-500 truncate">{pr.repo}</div>
                      </div>
                      <PullRequestStatus status={pr.status} />
                    </div>
                  ))}
                </div>

                <div className="mt-3 flex items-center justify-between ml-2 pr-2">
                  <span className="text-[12px] font-medium text-neutral-400">Workspaces</span>
                  <button
                    className="p-1 flex items-center justify-center text-neutral-500 hover:text-neutral-200"
                    type="button"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="ml-2 pt-1">
                  <div className="space-y-px">
                    {sidebarTasks.map((task, index) => (
                      <div key={`${task.title}-${index}`} className="group">
                        <div className="flex items-center rounded-sm pr-2 py-[3px] text-xs hover:bg-neutral-900 cursor-default" style={{ paddingLeft: "8px" }}>
                          <div className="pr-1 -ml-0.5">
                            <ChevronRightIcon className={`w-3 h-3 text-neutral-500 ${task.expanded ? "rotate-90" : ""}`} />
                          </div>
                          <div className="mr-2 flex-shrink-0">
                            <SidebarStatusIcon status={task.status} />
                          </div>
                          <span className="truncate text-neutral-200 font-medium">{task.title}</span>
                        </div>
                        {task.expanded && task.runs ? (
                          <div className="ml-5 space-y-px">
                            {task.runs.map((run, runIndex) => (
                              <div key={`${run.name}-${runIndex}`}>
                                <div className="flex items-center rounded-sm pr-2 py-[2px] text-[11px] text-neutral-400 hover:bg-neutral-900 cursor-default" style={{ paddingLeft: "6px" }}>
                                  <ChevronRightIcon className="w-3 h-3 text-neutral-500" />
                                  <div className="ml-1 mr-1">
                                    <SidebarStatusIcon status={run.status} />
                                  </div>
                                  <span className="truncate">{run.name}</span>
                                </div>
                                {run.children ? (
                                  <div className="ml-6 border-l border-neutral-800">
                                    {run.children.map((child, childIndex) => (
                                      <div
                                        key={`${child.label}-${childIndex}`}
                                        className="flex items-center gap-1.5 py-0.5 px-2 text-[11px] text-neutral-500 hover:bg-neutral-900 cursor-default"
                                      >
                                        {child.type === "vscode" ? (
                                          <VSCodeIcon className="w-3.5 h-3.5 text-blue-500" />
                                        ) : (
                                          <GitDiffIcon className="w-3.5 h-3.5 text-orange-500" />
                                        )}
                                        {child.label}
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </nav>
          </div>

          {/* Main area */}
          <div className="flex-1 bg-neutral-950">
            <div className="py-1.5 px-[5.8px] h-full flex flex-col">
              <div className="rounded-md border border-neutral-800 flex flex-col grow min-h-0 h-full overflow-hidden bg-neutral-900">
                <div
                  data-drag-handle
                  className="min-h-[24px] border-b border-neutral-800 flex items-center justify-center text-[11px] font-medium text-neutral-400 cursor-grab active:cursor-grabbing"
                >
                  cmux
                </div>

                <div className="flex-1 overflow-hidden min-h-0">
                  <div className="flex flex-col h-full">
                    {variant === "dashboard" ? (
                      <>
                        <div className="pt-10 pb-6 px-6">
                          <DashboardInputCard />
                        </div>
                        <DashboardTasks categories={categories} />
                      </>
                    ) : null}
                    {variant === "tasks" ? (
                      <>
                        <div className="pt-6" />
                        <DashboardTasks categories={categories} />
                      </>
                    ) : null}
                    {variant === "diff" ? <DiffView /> : null}
                    {variant === "pr" ? <PullRequestView /> : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDragHint ? (
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs text-neutral-500 select-none pointer-events-none">
          Drag the title bar to move
        </div>
      ) : null}
    </div>
  );
}
