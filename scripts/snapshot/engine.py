"""
Task registry and parallel execution engine.

Provides dependency-based task scheduling with automatic parallelization.
"""

from __future__ import annotations

import asyncio
import time
import typing as t

from dataclasses import dataclass

from collections.abc import Awaitable, Iterable

if t.TYPE_CHECKING:
    from .context import TaskContext


TaskFunc = t.Callable[["TaskContext"], Awaitable[None]]


@dataclass(frozen=True)
class TaskDefinition:
    name: str
    func: TaskFunc
    dependencies: tuple[str, ...]
    description: str | None = None


class TaskRegistry:
    def __init__(self) -> None:
        self._tasks: dict[str, TaskDefinition] = {}

    def task(
        self,
        *,
        name: str,
        deps: Iterable[str] = (),
        description: str | None = None,
    ) -> t.Callable[[TaskFunc], TaskFunc]:
        def decorator(func: TaskFunc) -> TaskFunc:
            if name in self._tasks:
                raise ValueError(f"Task '{name}' already registered")
            self._tasks[name] = TaskDefinition(
                name=name,
                func=func,
                dependencies=tuple(deps),
                description=description,
            )
            return func

        return decorator

    @property
    def tasks(self) -> dict[str, TaskDefinition]:
        return dict(self._tasks)


async def _run_task_with_timing(ctx: TaskContext, task: TaskDefinition) -> None:
    start = time.perf_counter()
    await task.func(ctx)
    duration = time.perf_counter() - start
    ctx.timings.add(f"task:{task.name}", duration)
    ctx.console.info(f"✓ {task.name} completed in {duration:.2f}s")


async def run_task_graph(registry: TaskRegistry, ctx: TaskContext) -> None:
    """Execute all tasks in the registry respecting dependencies.

    Tasks with satisfied dependencies run in parallel.
    """
    remaining = registry.tasks
    completed: set[str] = set()

    while remaining:
        ready = [
            name
            for name, task in remaining.items()
            if all(dep in completed for dep in task.dependencies)
        ]
        if not ready:
            unresolved = ", ".join(remaining)
            raise RuntimeError(f"Dependency cycle detected: {unresolved}")

        tasks_to_run = [remaining[name] for name in ready]
        for task in tasks_to_run:
            ctx.console.info(f"→ starting task {task.name}")

        start = time.perf_counter()
        await asyncio.gather(
            *(_run_task_with_timing(ctx, task) for task in tasks_to_run)
        )
        duration = time.perf_counter() - start
        layer_label = f"layer:{'+'.join(ready)}"
        ctx.timings.add(layer_label, duration)
        ctx.console.info(
            f"✓ Layer completed in {duration:.2f}s (tasks: {', '.join(ready)})"
        )

        for task in tasks_to_run:
            completed.add(task.name)
            remaining.pop(task.name, None)


def format_dependency_graph(registry: TaskRegistry) -> str:
    """Format the task dependency graph as a tree string."""
    tasks = registry.tasks
    if not tasks:
        return ""

    children: dict[str, list[str]] = {name: [] for name in tasks}
    for task in tasks.values():
        for dependency in task.dependencies:
            children.setdefault(dependency, []).append(task.name)
    for child_list in children.values():
        child_list.sort()

    roots = sorted(
        name for name, definition in tasks.items() if not definition.dependencies
    )

    lines: list[str] = []

    def render_node(
        node: str,
        prefix: str,
        is_last: bool,
        path: set[str],
    ) -> None:
        connector = "└─" if is_last else "├─"
        lines.append(f"{prefix}{connector} {node}")
        if node in path:
            lines.append(f"{prefix}   ↻ cycle")
            return
        descendants = children.get(node, [])
        if not descendants:
            return
        next_prefix = f"{prefix}   " if is_last else f"{prefix}│  "
        next_path = set(path)
        next_path.add(node)
        for index, child in enumerate(descendants):
            render_node(child, next_prefix, index == len(descendants) - 1, next_path)

    for root_index, root in enumerate(roots):
        if root_index:
            lines.append("")
        lines.append(root)
        descendants = children.get(root, [])
        for index, child in enumerate(descendants):
            render_node(child, "", index == len(descendants) - 1, {root})

    orphaned = sorted(
        name
        for name in tasks
        if name not in roots
        and all(name not in children.get(other, []) for other in tasks)
    )
    for orphan in orphaned:
        if lines:
            lines.append("")
        lines.append(orphan)

    return "\n".join(lines)
