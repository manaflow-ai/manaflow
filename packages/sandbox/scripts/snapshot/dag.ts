/**
 * Task registry and parallel execution engine.
 *
 * Provides dependency-based task scheduling with automatic parallelization.
 * TypeScript port of scripts/snapshot/engine.py
 */

/**
 * Task execution context passed to every task.
 * Generic to allow different providers to supply their own context types.
 */
export interface TaskContext {
  /** Log an info message */
  log: (message: string) => void;
  /** Record timing for a named operation */
  recordTiming: (name: string, durationMs: number) => void;
}

/**
 * Task function signature.
 */
export type TaskFunc<TContext extends TaskContext = TaskContext> = (
  ctx: TContext
) => Promise<void>;

/**
 * Definition of a single task in the registry.
 */
export interface TaskDefinition<TContext extends TaskContext = TaskContext> {
  /** Unique task name */
  name: string;
  /** The async function to execute */
  func: TaskFunc<TContext>;
  /** Names of tasks that must complete before this task */
  dependencies: readonly string[];
  /** Human-readable description */
  description?: string;
}

/**
 * Result of running a task.
 */
export interface TaskResult {
  name: string;
  durationMs: number;
  success: boolean;
  error?: Error;
}

/**
 * Result of running the entire task graph.
 */
export interface TaskGraphResult {
  /** Total execution time in milliseconds */
  totalDurationMs: number;
  /** Results for each task */
  taskResults: TaskResult[];
  /** Whether all tasks succeeded */
  success: boolean;
  /** Tasks that failed */
  failedTasks: string[];
}

/**
 * Registry for tasks with dependency tracking.
 */
export class TaskRegistry<TContext extends TaskContext = TaskContext> {
  private _tasks: Map<string, TaskDefinition<TContext>> = new Map();

  /**
   * Register a task with the registry.
   *
   * @param options Task configuration
   * @returns The registered task definition
   */
  register(options: {
    name: string;
    func: TaskFunc<TContext>;
    deps?: readonly string[];
    description?: string;
  }): TaskDefinition<TContext> {
    const { name, func, deps = [], description } = options;

    if (this._tasks.has(name)) {
      throw new Error(`Task '${name}' already registered`);
    }

    const definition: TaskDefinition<TContext> = {
      name,
      func,
      dependencies: deps,
      description,
    };

    this._tasks.set(name, definition);
    return definition;
  }

  /**
   * Get a copy of all registered tasks.
   */
  get tasks(): Map<string, TaskDefinition<TContext>> {
    return new Map(this._tasks);
  }

  /**
   * Get a specific task by name.
   */
  getTask(name: string): TaskDefinition<TContext> | undefined {
    return this._tasks.get(name);
  }

  /**
   * Check if a task exists.
   */
  hasTask(name: string): boolean {
    return this._tasks.has(name);
  }

  /**
   * Get all task names.
   */
  get taskNames(): string[] {
    return Array.from(this._tasks.keys());
  }

  /**
   * Validate the task graph for cycles and missing dependencies.
   * @throws Error if validation fails
   */
  validate(): void {
    const taskNames = new Set(this._tasks.keys());

    // Check for missing dependencies
    for (const [name, task] of this._tasks) {
      for (const dep of task.dependencies) {
        if (!taskNames.has(dep)) {
          throw new Error(
            `Task '${name}' depends on '${dep}', but '${dep}' is not registered`
          );
        }
      }
    }

    // Check for cycles using DFS
    const visited = new Set<string>();
    const inStack = new Set<string>();

    const hasCycle = (name: string, path: string[]): string[] | null => {
      if (inStack.has(name)) {
        return [...path, name];
      }
      if (visited.has(name)) {
        return null;
      }

      visited.add(name);
      inStack.add(name);

      const task = this._tasks.get(name);
      if (task) {
        for (const dep of task.dependencies) {
          const cycle = hasCycle(dep, [...path, name]);
          if (cycle) {
            return cycle;
          }
        }
      }

      inStack.delete(name);
      return null;
    };

    for (const name of this._tasks.keys()) {
      const cycle = hasCycle(name, []);
      if (cycle) {
        throw new Error(`Dependency cycle detected: ${cycle.join(" -> ")}`);
      }
    }
  }
}

/**
 * Run a single task with timing.
 */
async function runTaskWithTiming<TContext extends TaskContext>(
  ctx: TContext,
  task: TaskDefinition<TContext>
): Promise<TaskResult> {
  const start = performance.now();
  try {
    await task.func(ctx);
    const durationMs = performance.now() - start;
    ctx.recordTiming(`task:${task.name}`, durationMs);
    ctx.log(`✓ ${task.name} completed in ${(durationMs / 1000).toFixed(2)}s`);
    return { name: task.name, durationMs, success: true };
  } catch (error) {
    const durationMs = performance.now() - start;
    ctx.log(`✗ ${task.name} failed after ${(durationMs / 1000).toFixed(2)}s`);
    return {
      name: task.name,
      durationMs,
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Execute all tasks in the registry respecting dependencies.
 *
 * Tasks with satisfied dependencies run in parallel.
 * Continues executing tasks even if some fail (unless they depend on failed tasks).
 *
 * @param registry The task registry to execute
 * @param ctx The execution context
 * @returns Result of the task graph execution
 */
export async function runTaskGraph<TContext extends TaskContext>(
  registry: TaskRegistry<TContext>,
  ctx: TContext
): Promise<TaskGraphResult> {
  const totalStart = performance.now();
  const remaining = registry.tasks;
  const completed = new Set<string>();
  const failed = new Set<string>();
  const taskResults: TaskResult[] = [];

  while (remaining.size > 0) {
    // Find tasks that are ready to run (all dependencies satisfied and not failed)
    const ready: string[] = [];
    for (const [name, task] of remaining) {
      const depsOk = task.dependencies.every(
        (dep) => completed.has(dep) && !failed.has(dep)
      );
      // Skip if any dependency failed
      const depFailed = task.dependencies.some((dep) => failed.has(dep));
      if (depFailed) {
        // Mark this task as failed due to dependency
        remaining.delete(name);
        failed.add(name);
        taskResults.push({
          name,
          durationMs: 0,
          success: false,
          error: new Error("Skipped due to failed dependency"),
        });
        continue;
      }
      if (depsOk) {
        ready.push(name);
      }
    }

    if (ready.length === 0 && remaining.size > 0) {
      const unresolved = Array.from(remaining.keys()).join(", ");
      throw new Error(`Dependency cycle or unresolved dependencies: ${unresolved}`);
    }

    if (ready.length === 0) {
      break;
    }

    // Log tasks starting
    for (const name of ready) {
      ctx.log(`→ starting task ${name}`);
    }

    // Run ready tasks in parallel
    const layerStart = performance.now();
    const tasksToRun = ready.map((name) => remaining.get(name)!);
    const results = await Promise.all(
      tasksToRun.map((task) => runTaskWithTiming(ctx, task))
    );

    const layerDuration = performance.now() - layerStart;
    ctx.recordTiming(`layer:${ready.join("+")}`, layerDuration);
    ctx.log(
      `✓ Layer completed in ${(layerDuration / 1000).toFixed(2)}s (tasks: ${ready.join(", ")})`
    );

    // Process results
    for (const result of results) {
      taskResults.push(result);
      if (result.success) {
        completed.add(result.name);
      } else {
        failed.add(result.name);
      }
      remaining.delete(result.name);
    }
  }

  const totalDurationMs = performance.now() - totalStart;
  return {
    totalDurationMs,
    taskResults,
    success: failed.size === 0,
    failedTasks: Array.from(failed),
  };
}

/**
 * Format the task dependency graph as a tree string for visualization.
 */
export function formatDependencyGraph<TContext extends TaskContext>(
  registry: TaskRegistry<TContext>
): string {
  const tasks = registry.tasks;
  if (tasks.size === 0) {
    return "";
  }

  // Build adjacency list (parent -> children)
  const children: Map<string, string[]> = new Map();
  for (const name of tasks.keys()) {
    children.set(name, []);
  }

  for (const task of tasks.values()) {
    for (const dep of task.dependencies) {
      const depChildren = children.get(dep) ?? [];
      depChildren.push(task.name);
      children.set(dep, depChildren);
    }
  }

  // Sort children
  for (const childList of children.values()) {
    childList.sort();
  }

  // Find root nodes (no dependencies)
  const roots = Array.from(tasks.entries())
    .filter(([_, task]) => task.dependencies.length === 0)
    .map(([name]) => name)
    .sort();

  const lines: string[] = [];

  const renderNode = (
    node: string,
    prefix: string,
    isLast: boolean,
    path: Set<string>
  ): void => {
    const connector = isLast ? "└─" : "├─";
    lines.push(`${prefix}${connector} ${node}`);

    if (path.has(node)) {
      lines.push(`${prefix}   ↻ cycle`);
      return;
    }

    const descendants = children.get(node) ?? [];
    if (descendants.length === 0) {
      return;
    }

    const nextPrefix = isLast ? `${prefix}   ` : `${prefix}│  `;
    const nextPath = new Set(path);
    nextPath.add(node);

    for (let i = 0; i < descendants.length; i++) {
      renderNode(descendants[i], nextPrefix, i === descendants.length - 1, nextPath);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    if (i > 0) {
      lines.push("");
    }
    const root = roots[i];
    lines.push(root);
    const descendants = children.get(root) ?? [];
    for (let j = 0; j < descendants.length; j++) {
      renderNode(descendants[j], "", j === descendants.length - 1, new Set([root]));
    }
  }

  // Find orphaned nodes (not roots and not children of any other node)
  const orphaned = Array.from(tasks.keys())
    .filter((name) => {
      if (roots.includes(name)) return false;
      for (const [other, childList] of children) {
        if (childList.includes(name)) return false;
      }
      return true;
    })
    .sort();

  for (const orphan of orphaned) {
    if (lines.length > 0) {
      lines.push("");
    }
    lines.push(orphan);
  }

  return lines.join("\n");
}
