/**
 * PlanEditor Component
 *
 * Visual task graph editor for creating orchestration plans:
 * - Canvas with task nodes
 * - Drag-drop to create dependency lines
 * - Agent selector per task
 * - Priority adjustment
 * - Add/remove task buttons
 * - Save/import/export functionality
 */

import { useState, useCallback, useMemo, useId, useRef } from "react";
import {
  Plus,
  Trash2,
  Save,
  Download,
  Upload,
  GripVertical,
  Link2,
  Link2Off,
  Users,
  Loader2,
  ChevronDown,
  CheckCircle2,
  XCircle,
  Clock,
  Play,
} from "lucide-react";
import clsx from "clsx";

import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/ui/dropdown";

// ============================================================================
// Types
// ============================================================================

export interface PlanTask {
  id: string;
  prompt: string;
  agentName: string;
  status: string;
  dependsOn?: string[];
  priority?: number;
  orchestrationTaskId?: string;
}

export interface Plan {
  orchestrationId: string;
  headAgent: string;
  description?: string;
  tasks: PlanTask[];
}

interface TaskStatusInfo {
  status: string;
  result?: string;
  errorMessage?: string;
}

interface PlanEditorProps {
  plan?: Plan;
  availableAgents?: string[];
  onSave?: (plan: Plan) => Promise<void>;
  className?: string;
  readOnly?: boolean;
  taskStatuses?: Map<string, TaskStatusInfo>;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_AGENTS = [
  "claude/opus-4.5",
  "claude/sonnet-4.5",
  "claude/haiku-4.5",
  "codex/gpt-5.3-codex-xhigh",
  "codex/gpt-5.2-xhigh",
  "codex/gpt-5.1-codex-mini",
];

const CARD_WIDTH = 280;
const CARD_HEIGHT = 120;
const LEVEL_GAP = 100;
const CARD_GAP = 24;
const PADDING = 32;

// ============================================================================
// Utility Functions
// ============================================================================

function generateTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateOrchestrationId(): string {
  return `orch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Compute task levels based on dependencies (topological sort).
 */
function computeTaskLevels(tasks: PlanTask[]): Map<string, number> {
  const levels = new Map<string, number>();
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  function getLevel(id: string, visiting = new Set<string>()): number {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0; // Cycle detected

    visiting.add(id);
    const task = taskMap.get(id);
    if (!task?.dependsOn?.length) {
      levels.set(id, 0);
      return 0;
    }

    let maxDepLevel = 0;
    for (const depId of task.dependsOn) {
      if (taskMap.has(depId)) {
        maxDepLevel = Math.max(maxDepLevel, getLevel(depId, visiting) + 1);
      }
    }

    levels.set(id, maxDepLevel);
    return maxDepLevel;
  }

  for (const task of tasks) {
    getLevel(task.id);
  }

  return levels;
}

/**
 * Compute node positions for visual layout.
 */
function computeNodePositions(
  tasks: PlanTask[],
  levels: Map<string, number>
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Group by level
  const levelGroups = new Map<number, PlanTask[]>();
  for (const task of tasks) {
    const level = levels.get(task.id) ?? 0;
    const group = levelGroups.get(level) ?? [];
    group.push(task);
    levelGroups.set(level, group);
  }

  // Assign positions
  for (const [level, group] of levelGroups) {
    group.forEach((task, idx) => {
      positions.set(task.id, {
        x: PADDING + level * (CARD_WIDTH + LEVEL_GAP),
        y: PADDING + idx * (CARD_HEIGHT + CARD_GAP),
      });
    });
  }

  return positions;
}

// ============================================================================
// TaskCard Component
// ============================================================================

interface TaskCardProps {
  task: PlanTask;
  position: { x: number; y: number };
  isSelected: boolean;
  isConnecting: boolean;
  availableAgents: string[];
  onSelect: () => void;
  onUpdate: (updates: Partial<PlanTask>) => void;
  onDelete: () => void;
  onStartConnection: () => void;
  onEndConnection: () => void;
  readOnly?: boolean;
  statusInfo?: TaskStatusInfo;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { icon: typeof CheckCircle2; color: string; label: string }> = {
    completed: { icon: CheckCircle2, color: "text-green-500", label: "Completed" },
    running: { icon: Play, color: "text-blue-500", label: "Running" },
    assigned: { icon: Loader2, color: "text-blue-400", label: "Assigned" },
    pending: { icon: Clock, color: "text-amber-500", label: "Pending" },
    failed: { icon: XCircle, color: "text-red-500", label: "Failed" },
  };
  const c = config[status] ?? config.pending;
  const Icon = c.icon;

  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", c.color)}>
      <Icon className={clsx("size-3", status === "running" || status === "assigned" ? "animate-spin" : "")} />
      {c.label}
    </span>
  );
}

function TaskCard({
  task,
  position,
  isSelected,
  isConnecting,
  availableAgents,
  onSelect,
  onUpdate,
  onDelete,
  onStartConnection,
  onEndConnection,
  readOnly,
  statusInfo,
}: TaskCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editPrompt, setEditPrompt] = useState(task.prompt);

  const handleSavePrompt = () => {
    onUpdate({ prompt: editPrompt });
    setIsEditing(false);
  };

  return (
    <div
      className={clsx(
        "absolute rounded-lg border bg-white shadow-sm transition-all dark:bg-neutral-900",
        isSelected
          ? "border-blue-500 ring-2 ring-blue-500/30"
          : "border-neutral-200 dark:border-neutral-700",
        isConnecting && "ring-2 ring-purple-500/30"
      )}
      style={{
        left: position.x,
        top: position.y,
        width: CARD_WIDTH,
        minHeight: CARD_HEIGHT,
      }}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-2 dark:border-neutral-800">
        <div className="flex items-center gap-2">
          {!readOnly && <GripVertical className="size-4 cursor-grab text-neutral-400" />}
          <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {task.agentName.split("/")[1] ?? task.agentName}
          </span>
          {statusInfo && <StatusBadge status={statusInfo.status} />}
        </div>
        {!readOnly && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartConnection();
              }}
              className="rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              title="Create dependency"
            >
              <Link2 className="size-3.5 text-neutral-500" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="rounded p-1 hover:bg-red-100 dark:hover:bg-red-900/30"
              title="Delete task"
            >
              <Trash2 className="size-3.5 text-red-500" />
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-3">
        {!readOnly && isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editPrompt}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditPrompt(e.target.value)}
              className="min-h-[60px] w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-xs placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-800 dark:bg-neutral-950 dark:placeholder:text-neutral-400"
              placeholder="Task prompt..."
              autoFocus
            />
            <div className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSavePrompt}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <p
            className={clsx(
              "line-clamp-2 text-xs text-neutral-700 dark:text-neutral-300",
              !readOnly && "cursor-text"
            )}
            onClick={(e) => {
              if (readOnly) return;
              e.stopPropagation();
              setIsEditing(true);
            }}
          >
            {task.prompt || (readOnly ? "(no prompt)" : "Click to add prompt...")}
          </p>
        )}

        {/* Error message for failed tasks */}
        {statusInfo?.errorMessage && (
          <p className="mt-2 text-[10px] text-red-500 line-clamp-2">
            {statusInfo.errorMessage}
          </p>
        )}

        {/* Result for completed tasks */}
        {statusInfo?.result && (
          <p className="mt-2 text-[10px] text-green-600 dark:text-green-400 line-clamp-2">
            {statusInfo.result}
          </p>
        )}

        {/* Dependencies indicator */}
        {task.dependsOn && task.dependsOn.length > 0 && (
          <div className="mt-2 flex items-center gap-1 text-[10px] text-neutral-500">
            <Link2 className="size-3" />
            Depends on {task.dependsOn.length} task{task.dependsOn.length > 1 ? "s" : ""}
          </div>
        )}
      </div>

      {/* Agent selector (when selected and not readOnly) */}
      {isSelected && !readOnly && (
        <div className="border-t border-neutral-100 px-3 py-2 dark:border-neutral-800">
          <Dropdown.Root>
            <Dropdown.Trigger className="flex w-full items-center justify-between rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800">
              {task.agentName}
              <ChevronDown className="size-3" />
            </Dropdown.Trigger>
            <Dropdown.Portal>
              <Dropdown.Positioner>
                <Dropdown.Popup className="max-h-48 overflow-y-auto">
                  {availableAgents.map((agent) => (
                    <Dropdown.Item
                      key={agent}
                      onClick={() => onUpdate({ agentName: agent })}
                    >
                      <span className="px-2 py-1 text-xs">{agent}</span>
                    </Dropdown.Item>
                  ))}
                </Dropdown.Popup>
              </Dropdown.Positioner>
            </Dropdown.Portal>
          </Dropdown.Root>
        </div>
      )}

      {/* Connection target overlay */}
      {isConnecting && !readOnly && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEndConnection();
          }}
          className="absolute inset-0 flex items-center justify-center rounded-lg bg-purple-500/10 border-2 border-dashed border-purple-500"
        >
          <span className="rounded bg-purple-500 px-2 py-1 text-xs font-medium text-white">
            Click to connect
          </span>
        </button>
      )}
    </div>
  );
}

// ============================================================================
// PlanEditor Component
// ============================================================================

export function PlanEditor({
  plan: initialPlan,
  availableAgents = DEFAULT_AGENTS,
  onSave,
  className,
  readOnly,
  taskStatuses,
}: PlanEditorProps) {
  const markerId = useId().replace(/:/g, "-");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [tasks, setTasks] = useState<PlanTask[]>(initialPlan?.tasks ?? []);
  const [orchestrationId] = useState(initialPlan?.orchestrationId ?? generateOrchestrationId());
  const [headAgent, setHeadAgent] = useState(initialPlan?.headAgent ?? availableAgents[0]);
  const [description, setDescription] = useState(initialPlan?.description ?? "");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [connectingFromId, setConnectingFromId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Computed layout
  const { positions, edges, canvasWidth, canvasHeight } = useMemo(() => {
    const taskLevels = computeTaskLevels(tasks);
    const taskPositions = computeNodePositions(tasks, taskLevels);

    // Compute edges
    const computedEdges: Array<{
      from: { x: number; y: number };
      to: { x: number; y: number };
      key: string;
    }> = [];

    for (const task of tasks) {
      if (!task.dependsOn?.length) continue;
      const toPos = taskPositions.get(task.id);
      if (!toPos) continue;

      for (const depId of task.dependsOn) {
        const fromPos = taskPositions.get(depId);
        if (!fromPos) continue;

        computedEdges.push({
          from: { x: fromPos.x + CARD_WIDTH, y: fromPos.y + CARD_HEIGHT / 2 },
          to: { x: toPos.x, y: toPos.y + CARD_HEIGHT / 2 },
          key: `${depId}->${task.id}`,
        });
      }
    }

    // Calculate canvas size
    const maxLevel = Math.max(...Array.from(taskLevels.values()), 0);
    const levelCounts = new Map<number, number>();
    for (const [, level] of taskLevels) {
      levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
    }
    const maxNodesInLevel = Math.max(...Array.from(levelCounts.values()), 1);

    const width = PADDING * 2 + (maxLevel + 1) * CARD_WIDTH + maxLevel * LEVEL_GAP;
    const height = PADDING * 2 + maxNodesInLevel * CARD_HEIGHT + (maxNodesInLevel - 1) * CARD_GAP;

    return {
      levels: taskLevels,
      positions: taskPositions,
      edges: computedEdges,
      canvasWidth: Math.max(width, 600),
      canvasHeight: Math.max(height, 300),
    };
  }, [tasks]);

  // Handlers
  const addTask = useCallback(() => {
    const newTask: PlanTask = {
      id: generateTaskId(),
      prompt: "",
      agentName: availableAgents[0],
      status: "pending",
      priority: 5,
    };
    setTasks((prev) => [...prev, newTask]);
    setSelectedTaskId(newTask.id);
  }, [availableAgents]);

  const updateTask = useCallback((taskId: string, updates: Partial<PlanTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
    );
  }, []);

  const deleteTask = useCallback((taskId: string) => {
    setTasks((prev) => {
      // Remove task and any references to it
      return prev
        .filter((t) => t.id !== taskId)
        .map((t) => ({
          ...t,
          dependsOn: t.dependsOn?.filter((d) => d !== taskId),
        }));
    });
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
  }, [selectedTaskId]);

  const startConnection = useCallback((fromId: string) => {
    setConnectingFromId(fromId);
    setSelectedTaskId(null);
  }, []);

  const endConnection = useCallback((toId: string) => {
    if (connectingFromId && connectingFromId !== toId) {
      // Add dependency
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === toId) {
            const deps = new Set(t.dependsOn ?? []);
            deps.add(connectingFromId);
            return { ...t, dependsOn: Array.from(deps) };
          }
          return t;
        })
      );
    }
    setConnectingFromId(null);
  }, [connectingFromId]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setIsSaving(true);
    try {
      await onSave({
        orchestrationId,
        headAgent,
        description,
        tasks,
      });
    } finally {
      setIsSaving(false);
    }
  }, [onSave, orchestrationId, headAgent, description, tasks]);

  const exportPlan = useCallback(() => {
    const plan: Plan = { orchestrationId, headAgent, description, tasks };
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `plan-${orchestrationId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [orchestrationId, headAgent, description, tasks]);

  const importPlan = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const plan = JSON.parse(e.target?.result as string) as Plan;
        setTasks(plan.tasks);
        setHeadAgent(plan.headAgent);
        setDescription(plan.description ?? "");
      } catch (error) {
        console.error("Failed to import plan:", error);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  }, []);

  return (
    <div className={clsx("flex flex-col rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900", className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-3">
          <h3 className="font-medium text-neutral-900 dark:text-neutral-100">
            Plan Editor
          </h3>
          <span className="rounded border border-neutral-200 px-2 py-0.5 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">{tasks.length} tasks</span>
        </div>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={addTask}>
              <Plus className="mr-1 size-4" />
              Add Task
            </Button>
          )}
          {!readOnly && (
            <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-1 size-4" />
              Import
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={importPlan}
            className="hidden"
          />
          <Button variant="outline" size="sm" onClick={exportPlan} disabled={tasks.length === 0}>
            <Download className="mr-1 size-4" />
            Export
          </Button>
          {onSave && !readOnly && (
            <Button size="sm" onClick={handleSave} disabled={isSaving || tasks.length === 0}>
              {isSaving ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Save className="mr-1 size-4" />
              )}
              Save
            </Button>
          )}
        </div>
      </div>

      {/* Plan metadata */}
      {!readOnly && (
        <div className="flex items-center gap-4 border-b border-neutral-100 px-4 py-2 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-500">Head Agent:</label>
            <Dropdown.Root>
              <Dropdown.Trigger className="flex items-center gap-1 rounded border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800">
                {headAgent}
                <ChevronDown className="size-3" />
              </Dropdown.Trigger>
              <Dropdown.Portal>
                <Dropdown.Positioner>
                  <Dropdown.Popup>
                    {availableAgents.map((agent) => (
                      <Dropdown.Item key={agent} onClick={() => setHeadAgent(agent)}>
                        <span className="px-2 py-1 text-xs">{agent}</span>
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Popup>
                </Dropdown.Positioner>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
          <div className="flex-1">
            <input
              value={description}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDescription(e.target.value)}
              placeholder="Plan description..."
              className="h-7 w-full rounded-md border border-neutral-200 bg-white px-2 text-xs placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-800 dark:bg-neutral-950 dark:placeholder:text-neutral-400"
            />
          </div>
        </div>
      )}

      {/* Connection mode indicator */}
      {connectingFromId && (
        <div className="flex items-center justify-between bg-purple-50 px-4 py-2 dark:bg-purple-900/20">
          <span className="flex items-center gap-2 text-sm text-purple-700 dark:text-purple-300">
            <Link2 className="size-4" />
            Click on a task to create a dependency
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConnectingFromId(null)}
            className="text-purple-700 dark:text-purple-300"
          >
            <Link2Off className="mr-1 size-4" />
            Cancel
          </Button>
        </div>
      )}

      {/* Canvas */}
      <div className="flex-1 overflow-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-neutral-500">
            <Users className="mb-4 size-12 text-neutral-300" />
            <p className="mb-2 text-lg font-medium text-neutral-600 dark:text-neutral-400">
              No tasks yet
            </p>
            <p className="mb-4 text-sm">
              {readOnly ? "No tasks in this plan" : "Click \"Add Task\" to start building your plan"}
            </p>
            {!readOnly && (
              <Button onClick={addTask}>
                <Plus className="mr-1 size-4" />
                Add First Task
              </Button>
            )}
          </div>
        ) : (
          <div
            className="relative"
            style={{ width: canvasWidth, height: canvasHeight, minWidth: "100%" }}
            onClick={() => {
              setSelectedTaskId(null);
              if (connectingFromId) setConnectingFromId(null);
            }}
          >
            {/* SVG edges */}
            {edges.length > 0 && (
              <svg
                className="pointer-events-none absolute inset-0"
                width={canvasWidth}
                height={canvasHeight}
              >
                <defs>
                  <marker
                    id={markerId}
                    markerWidth="8"
                    markerHeight="6"
                    refX="7"
                    refY="3"
                    orient="auto"
                  >
                    <polygon
                      points="0 0, 8 3, 0 6"
                      className="fill-neutral-400 dark:fill-neutral-500"
                    />
                  </marker>
                </defs>
                {edges.map((edge) => {
                  const dx = edge.to.x - edge.from.x;
                  const cp = dx * 0.4;
                  const d = `M ${edge.from.x} ${edge.from.y} C ${edge.from.x + cp} ${edge.from.y}, ${edge.to.x - cp} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`;
                  return (
                    <path
                      key={edge.key}
                      d={d}
                      fill="none"
                      className="stroke-neutral-300 dark:stroke-neutral-600"
                      strokeWidth={1.5}
                      markerEnd={`url(#${markerId})`}
                    />
                  );
                })}
              </svg>
            )}

            {/* Task cards */}
            {tasks.map((task) => {
              const pos = positions.get(task.id);
              if (!pos) return null;

              return (
                <TaskCard
                  key={task.id}
                  task={task}
                  position={pos}
                  isSelected={selectedTaskId === task.id}
                  isConnecting={connectingFromId !== null && connectingFromId !== task.id}
                  availableAgents={availableAgents}
                  onSelect={() => setSelectedTaskId(task.id)}
                  onUpdate={(updates) => updateTask(task.id, updates)}
                  onDelete={() => deleteTask(task.id)}
                  onStartConnection={() => startConnection(task.id)}
                  onEndConnection={() => endConnection(task.id)}
                  readOnly={readOnly}
                  statusInfo={taskStatuses?.get(task.id)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
