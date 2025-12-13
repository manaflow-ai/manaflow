"""Shared type definitions to avoid circular imports."""

from __future__ import annotations

from collections.abc import Sequence

Command = str | Sequence[str]


class Console:
    """Simple console output with quiet mode support."""

    quiet: bool

    def __init__(self) -> None:
        self.quiet = False

    def info(self, value: str) -> None:
        if not self.quiet:
            print(value)

    def always(self, value: str) -> None:
        print(value)


class TimingsCollector:
    """Collects timing information for task execution."""

    def __init__(self) -> None:
        self._entries: list[tuple[str, float]] = []

    def add(self, label: str, duration: float) -> None:
        self._entries.append((label, duration))

    def summary(self) -> list[str]:
        if not self._entries:
            return []

        lines: list[str] = []
        task_timings: dict[str, float] = {}
        layer_timings: list[tuple[float, list[str]]] = []

        for label, duration in self._entries:
            if label.startswith("task:"):
                task_name = label[5:]
                task_timings[task_name] = duration
            elif label.startswith("layer:"):
                layer_tasks = label[6:].split("+")
                layer_timings.append((duration, layer_tasks))

        if layer_timings:
            lines.append("Parallel Execution Layers:")
            for layer_duration, tasks in layer_timings:
                lines.append(f"\n  Layer (wall time: {layer_duration:.2f}s):")
                for task_name in sorted(tasks):
                    task_duration = task_timings.get(task_name, 0.0)
                    lines.append(f"    ├─ {task_name}: {task_duration:.2f}s")

        total_wall_time = sum(d for label, d in self._entries if label.startswith("layer:"))
        total_cpu_time = sum(task_timings.values())

        lines.append(f"\nTotal wall time: {total_wall_time:.2f}s")
        lines.append(f"Total CPU time: {total_cpu_time:.2f}s")
        if total_wall_time > 0:
            parallelism = total_cpu_time / total_wall_time
            lines.append(f"Effective parallelism: {parallelism:.2f}x")

        return lines
