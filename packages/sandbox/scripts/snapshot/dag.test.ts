import { describe, it, expect, beforeEach } from "vitest";
import {
  TaskRegistry,
  runTaskGraph,
  formatDependencyGraph,
  type TaskContext,
} from "./dag";

/**
 * Create a simple test context that records logs and timings.
 */
function createTestContext(): TaskContext & {
  logs: string[];
  timings: Map<string, number>;
} {
  const logs: string[] = [];
  const timings = new Map<string, number>();

  return {
    logs,
    timings,
    log: (message: string) => logs.push(message),
    recordTiming: (name: string, durationMs: number) => timings.set(name, durationMs),
  };
}

describe("TaskRegistry", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  it("should register a task", () => {
    const fn = async () => {};
    registry.register({ name: "test", func: fn });

    expect(registry.hasTask("test")).toBe(true);
    expect(registry.taskNames).toContain("test");
  });

  it("should throw when registering duplicate task name", () => {
    const fn = async () => {};
    registry.register({ name: "test", func: fn });

    expect(() => registry.register({ name: "test", func: fn })).toThrow(
      "Task 'test' already registered"
    );
  });

  it("should store task dependencies", () => {
    const fn = async () => {};
    registry.register({ name: "base", func: fn });
    registry.register({ name: "dependent", func: fn, deps: ["base"] });

    const task = registry.getTask("dependent");
    expect(task?.dependencies).toEqual(["base"]);
  });

  it("should store task description", () => {
    const fn = async () => {};
    registry.register({
      name: "test",
      func: fn,
      description: "A test task",
    });

    const task = registry.getTask("test");
    expect(task?.description).toBe("A test task");
  });

  describe("validate", () => {
    it("should pass for valid graph", () => {
      const fn = async () => {};
      registry.register({ name: "a", func: fn });
      registry.register({ name: "b", func: fn, deps: ["a"] });
      registry.register({ name: "c", func: fn, deps: ["a", "b"] });

      expect(() => registry.validate()).not.toThrow();
    });

    it("should detect missing dependencies", () => {
      const fn = async () => {};
      registry.register({ name: "test", func: fn, deps: ["missing"] });

      expect(() => registry.validate()).toThrow(
        "Task 'test' depends on 'missing', but 'missing' is not registered"
      );
    });

    it("should detect direct cycle", () => {
      const fn = async () => {};
      registry.register({ name: "a", func: fn, deps: ["b"] });
      registry.register({ name: "b", func: fn, deps: ["a"] });

      expect(() => registry.validate()).toThrow(/cycle/i);
    });

    it("should detect indirect cycle", () => {
      const fn = async () => {};
      registry.register({ name: "a", func: fn, deps: ["c"] });
      registry.register({ name: "b", func: fn, deps: ["a"] });
      registry.register({ name: "c", func: fn, deps: ["b"] });

      expect(() => registry.validate()).toThrow(/cycle/i);
    });

    it("should detect self-referencing cycle", () => {
      const fn = async () => {};
      registry.register({ name: "a", func: fn, deps: ["a"] });

      expect(() => registry.validate()).toThrow(/cycle/i);
    });
  });
});

describe("runTaskGraph", () => {
  it("should run a single task", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();
    let executed = false;

    registry.register({
      name: "single",
      func: async () => {
        executed = true;
      },
    });

    const result = await runTaskGraph(registry, ctx);

    expect(executed).toBe(true);
    expect(result.success).toBe(true);
    expect(result.taskResults).toHaveLength(1);
    expect(result.taskResults[0].name).toBe("single");
    expect(result.taskResults[0].success).toBe(true);
  });

  it("should run tasks in dependency order", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();
    const executionOrder: string[] = [];

    registry.register({
      name: "first",
      func: async () => {
        executionOrder.push("first");
      },
    });

    registry.register({
      name: "second",
      func: async () => {
        executionOrder.push("second");
      },
      deps: ["first"],
    });

    registry.register({
      name: "third",
      func: async () => {
        executionOrder.push("third");
      },
      deps: ["second"],
    });

    await runTaskGraph(registry, ctx);

    expect(executionOrder).toEqual(["first", "second", "third"]);
  });

  it("should run independent tasks in parallel", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();
    const startTimes: Map<string, number> = new Map();
    const endTimes: Map<string, number> = new Map();

    for (const name of ["a", "b", "c"]) {
      registry.register({
        name,
        func: async () => {
          startTimes.set(name, Date.now());
          await new Promise((resolve) => setTimeout(resolve, 50));
          endTimes.set(name, Date.now());
        },
      });
    }

    const result = await runTaskGraph(registry, ctx);

    expect(result.success).toBe(true);
    expect(result.taskResults).toHaveLength(3);

    // All tasks should start at roughly the same time (within 30ms)
    const starts = Array.from(startTimes.values());
    const maxStart = Math.max(...starts);
    const minStart = Math.min(...starts);
    expect(maxStart - minStart).toBeLessThan(30);
  });

  it("should handle task failure gracefully", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();

    registry.register({
      name: "failing",
      func: async () => {
        throw new Error("Task failed!");
      },
    });

    registry.register({
      name: "dependent",
      func: async () => {},
      deps: ["failing"],
    });

    const result = await runTaskGraph(registry, ctx);

    expect(result.success).toBe(false);
    expect(result.failedTasks).toContain("failing");
    expect(result.failedTasks).toContain("dependent");

    const failingResult = result.taskResults.find((r) => r.name === "failing");
    expect(failingResult?.success).toBe(false);
    expect(failingResult?.error?.message).toBe("Task failed!");

    const dependentResult = result.taskResults.find((r) => r.name === "dependent");
    expect(dependentResult?.success).toBe(false);
    expect(dependentResult?.error?.message).toContain("failed dependency");
  });

  it("should continue running unaffected tasks when one fails", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();
    let independentRan = false;

    registry.register({
      name: "failing",
      func: async () => {
        throw new Error("Oops!");
      },
    });

    registry.register({
      name: "independent",
      func: async () => {
        independentRan = true;
      },
    });

    const result = await runTaskGraph(registry, ctx);

    expect(independentRan).toBe(true);
    expect(result.failedTasks).toEqual(["failing"]);
    expect(result.taskResults.find((r) => r.name === "independent")?.success).toBe(true);
  });

  it("should record timings", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();

    registry.register({
      name: "timed",
      func: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });

    await runTaskGraph(registry, ctx);

    expect(ctx.timings.has("task:timed")).toBe(true);
    expect(ctx.timings.get("task:timed")!).toBeGreaterThan(15);
  });

  it("should log task progress", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();

    registry.register({
      name: "logged",
      func: async () => {},
    });

    await runTaskGraph(registry, ctx);

    expect(ctx.logs.some((l) => l.includes("starting task logged"))).toBe(true);
    expect(ctx.logs.some((l) => l.includes("✓ logged completed"))).toBe(true);
    expect(ctx.logs.some((l) => l.includes("Layer completed"))).toBe(true);
  });

  it("should handle empty registry", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();

    const result = await runTaskGraph(registry, ctx);

    expect(result.success).toBe(true);
    expect(result.taskResults).toHaveLength(0);
  });

  it("should handle complex DAG with multiple layers", async () => {
    const registry = new TaskRegistry();
    const ctx = createTestContext();
    const executionOrder: string[] = [];

    // Diamond pattern: a -> b, c -> d
    registry.register({
      name: "a",
      func: async () => {
        executionOrder.push("a");
      },
    });

    registry.register({
      name: "b",
      func: async () => {
        executionOrder.push("b");
      },
      deps: ["a"],
    });

    registry.register({
      name: "c",
      func: async () => {
        executionOrder.push("c");
      },
      deps: ["a"],
    });

    registry.register({
      name: "d",
      func: async () => {
        executionOrder.push("d");
      },
      deps: ["b", "c"],
    });

    const result = await runTaskGraph(registry, ctx);

    expect(result.success).toBe(true);
    expect(executionOrder[0]).toBe("a"); // a must be first
    expect(executionOrder[3]).toBe("d"); // d must be last
    // b and c can be in either order (they run in parallel)
    expect(executionOrder.slice(1, 3).sort()).toEqual(["b", "c"]);
  });
});

describe("formatDependencyGraph", () => {
  it("should return empty string for empty registry", () => {
    const registry = new TaskRegistry();
    expect(formatDependencyGraph(registry)).toBe("");
  });

  it("should format single task", () => {
    const registry = new TaskRegistry();
    registry.register({ name: "task", func: async () => {} });

    const output = formatDependencyGraph(registry);
    expect(output).toContain("task");
  });

  it("should show dependency relationships", () => {
    const registry = new TaskRegistry();
    registry.register({ name: "base", func: async () => {} });
    registry.register({
      name: "dependent",
      func: async () => {},
      deps: ["base"],
    });

    const output = formatDependencyGraph(registry);
    expect(output).toContain("base");
    expect(output).toContain("dependent");
  });

  it("should handle diamond dependencies", () => {
    const registry = new TaskRegistry();
    registry.register({ name: "a", func: async () => {} });
    registry.register({ name: "b", func: async () => {}, deps: ["a"] });
    registry.register({ name: "c", func: async () => {}, deps: ["a"] });
    registry.register({ name: "d", func: async () => {}, deps: ["b", "c"] });

    const output = formatDependencyGraph(registry);
    expect(output).toContain("a");
    expect(output).toContain("b");
    expect(output).toContain("c");
    expect(output).toContain("d");
  });
});
