import { useId, useMemo } from "react";
import { Users } from "lucide-react";
import { STATUS_CONFIG, type TaskStatus } from "./status-config";
import type { OrchestrationTaskWithDeps } from "./OrchestrationDashboard";

interface OrchestrationDependencyGraphProps {
  tasks?: OrchestrationTaskWithDeps[];
  loading: boolean;
}

interface TaskNode {
  task: OrchestrationTaskWithDeps;
  level: number;
  indexInLevel: number;
}

function truncatePrompt(prompt: string | null | undefined, maxLen = 48): string {
  if (!prompt) {
    return "Untitled task";
  }
  const firstLine = prompt.split("\n")[0] ?? prompt;
  const clean = firstLine.trim();
  if (clean.length <= maxLen) {
    return clean;
  }
  return `${clean.slice(0, maxLen)}...`;
}

function isDependencyTaskId(depId: unknown): depId is string {
  return typeof depId === "string" && depId.length > 0;
}

/**
 * Topological sort to arrange tasks by dependency depth.
 * Tasks with no dependencies go to level 0, tasks depending only
 * on level-0 tasks go to level 1, etc.
 */
function computeLevels(tasks: OrchestrationTaskWithDeps[]): TaskNode[] {
  const taskMap = new Map<string, OrchestrationTaskWithDeps>();
  for (const t of tasks) {
    taskMap.set(t._id, t);
  }

  const levels = new Map<string, number>();
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function getLevel(id: string): number {
    if (levels.has(id)) {
      return levels.get(id)!;
    }
    if (visiting.has(id)) {
      // Cycle detected, break it
      return 0;
    }
    visiting.add(id);
    const task = taskMap.get(id);
    if (!task?.dependencies?.length) {
      levels.set(id, 0);
      visiting.delete(id);
      visited.add(id);
      return 0;
    }
    let maxDepLevel = 0;
    for (const depId of task.dependencies) {
      if (!isDependencyTaskId(depId)) {
        continue;
      }
      if (taskMap.has(depId)) {
        maxDepLevel = Math.max(maxDepLevel, getLevel(depId) + 1);
      }
    }
    levels.set(id, maxDepLevel);
    visiting.delete(id);
    visited.add(id);
    return maxDepLevel;
  }

  for (const t of tasks) {
    if (!visited.has(t._id)) {
      getLevel(t._id);
    }
  }

  // Group by level and assign index within level
  const levelGroups = new Map<number, OrchestrationTaskWithDeps[]>();
  for (const t of tasks) {
    const level = levels.get(t._id) ?? 0;
    const group = levelGroups.get(level) ?? [];
    group.push(t);
    levelGroups.set(level, group);
  }

  const nodes: TaskNode[] = [];
  for (const [level, group] of levelGroups) {
    group.forEach((task, idx) => {
      nodes.push({ task, level, indexInLevel: idx });
    });
  }

  return nodes;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; dot: string }> = {
  pending: { bg: "bg-neutral-50 dark:bg-neutral-800/50", border: "border-neutral-300 dark:border-neutral-600", dot: "bg-neutral-400" },
  assigned: { bg: "bg-blue-50 dark:bg-blue-900/20", border: "border-blue-300 dark:border-blue-700", dot: "bg-blue-500" },
  running: { bg: "bg-blue-50 dark:bg-blue-900/20", border: "border-blue-400 dark:border-blue-600", dot: "bg-blue-500 animate-pulse" },
  completed: { bg: "bg-green-50 dark:bg-green-900/15", border: "border-green-300 dark:border-green-700", dot: "bg-green-500" },
  failed: { bg: "bg-red-50 dark:bg-red-900/15", border: "border-red-300 dark:border-red-700", dot: "bg-red-500" },
  cancelled: { bg: "bg-neutral-100 dark:bg-neutral-800", border: "border-neutral-300 dark:border-neutral-600", dot: "bg-neutral-400" },
};

// Layout constants
const CARD_WIDTH = 220;
const CARD_HEIGHT = 80;
const LEVEL_GAP = 80;
const CARD_GAP = 16;
const PADDING = 24;

function TaskCard({ node }: { node: TaskNode }) {
  const { task } = node;
  const colors = STATUS_COLORS[task.status] ?? STATUS_COLORS.pending;
  const statusConf = STATUS_CONFIG[task.status as TaskStatus];
  const label = truncatePrompt(task.prompt);
  const agent = task.assignedAgentName;

  return (
    <div
      className={`rounded-lg border ${colors.border} ${colors.bg} p-3 shadow-sm transition-shadow hover:shadow-md`}
      style={{ width: CARD_WIDTH, minHeight: CARD_HEIGHT }}
      title={task.prompt}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 inline-block size-2 shrink-0 rounded-full ${colors.dot}`} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-tight text-neutral-900 dark:text-neutral-100 line-clamp-2">
            {label}
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-neutral-500 dark:text-neutral-400">
            {statusConf && (
              <span className="font-medium">{statusConf.label}</span>
            )}
            {agent && (
              <>
                <span className="text-neutral-300 dark:text-neutral-600">|</span>
                <span className="truncate">{agent}</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Compute SVG path coordinates for dependency arrows.
 * Each edge goes from a dependency (left) to a dependent (right).
 */
function computeEdges(
  nodes: TaskNode[],
  nodePositions: Map<string, { x: number; y: number }>
): Array<{ from: { x: number; y: number }; to: { x: number; y: number }; key: string }> {
  const edges: Array<{ from: { x: number; y: number }; to: { x: number; y: number }; key: string }> = [];

  for (const node of nodes) {
    const deps = node.task.dependencies;
    if (!deps?.length) continue;
    const toPos = nodePositions.get(node.task._id);
    if (!toPos) continue;

    for (const depId of deps) {
      if (!isDependencyTaskId(depId)) {
        continue;
      }
      const fromPos = nodePositions.get(depId);
      if (!fromPos) continue;

      edges.push({
        from: { x: fromPos.x + CARD_WIDTH, y: fromPos.y + CARD_HEIGHT / 2 },
        to: { x: toPos.x, y: toPos.y + CARD_HEIGHT / 2 },
        key: `${depId}->${node.task._id}`,
      });
    }
  }

  return edges;
}

export function OrchestrationDependencyGraph({
  tasks,
  loading,
}: OrchestrationDependencyGraphProps) {
  const markerId = useId().replace(/:/g, "-");
  const { nodes, nodePositions, edges, canvasWidth, canvasHeight, hasDeps } = useMemo(() => {
    if (!tasks || tasks.length === 0) {
      return { nodes: [], nodePositions: new Map<string, { x: number; y: number }>(), edges: [], canvasWidth: 0, canvasHeight: 0, hasDeps: false };
    }

    const computedNodes = computeLevels(tasks);
    const hasDependencies = tasks.some((t) => t.dependencies && t.dependencies.length > 0);

    // Compute positions
    const positions = new Map<string, { x: number; y: number }>();
    const levelCounts = new Map<number, number>();
    for (const n of computedNodes) {
      levelCounts.set(n.level, (levelCounts.get(n.level) ?? 0) + 1);
    }
    const maxLvl = Math.max(...Array.from(levelCounts.keys()), 0);

    for (const n of computedNodes) {
      const x = PADDING + n.level * (CARD_WIDTH + LEVEL_GAP);
      const y = PADDING + n.indexInLevel * (CARD_HEIGHT + CARD_GAP);
      positions.set(n.task._id, { x, y });
    }

    const maxNodesInLevel = Math.max(...Array.from(levelCounts.values()), 1);
    const totalWidth = PADDING * 2 + (maxLvl + 1) * CARD_WIDTH + maxLvl * LEVEL_GAP;
    const totalHeight = PADDING * 2 + maxNodesInLevel * CARD_HEIGHT + (maxNodesInLevel - 1) * CARD_GAP;

    const computedEdges = computeEdges(computedNodes, positions);

    return {
      nodes: computedNodes,
      nodePositions: positions,
      edges: computedEdges,
      canvasWidth: Math.max(totalWidth, 400),
      canvasHeight: Math.max(totalHeight, 200),
      hasDeps: hasDependencies,
    };
  }, [tasks]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600 dark:border-neutral-600 dark:border-t-neutral-300" />
      </div>
    );
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-neutral-500 dark:text-neutral-400">
        <Users className="size-8 text-neutral-400 dark:text-neutral-500" />
        <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
          No tasks to visualize
        </div>
        <p className="text-xs">
          Spawn agents to see the dependency graph.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-neutral-100 px-4 py-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
        {(Object.entries(STATUS_COLORS) as Array<[string, { dot: string }]>).map(([status, { dot }]) => {
          const conf = STATUS_CONFIG[status as TaskStatus];
          if (!conf) return null;
          return (
            <span key={status} className="flex items-center gap-1.5">
              <span className={`inline-block size-2 rounded-full ${dot.replace(" animate-pulse", "")}`} />
              {conf.label}
            </span>
          );
        })}
        {!hasDeps && (
          <span className="ml-auto text-neutral-400 dark:text-neutral-500 italic">
            No dependency edges
          </span>
        )}
      </div>

      {/* Graph canvas */}
      <div className="overflow-auto" style={{ maxHeight: "calc(100vh - 400px)" }}>
        <div className="relative" style={{ width: canvasWidth, height: canvasHeight, minWidth: "100%" }}>
          {/* SVG layer for edges */}
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

          {/* Card layer */}
          {nodes.map((node) => {
            const pos = nodePositions.get(node.task._id);
            if (!pos) return null;
            return (
              <div
                key={node.task._id}
                className="absolute"
                style={{ left: pos.x, top: pos.y }}
              >
                <TaskCard node={node} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
