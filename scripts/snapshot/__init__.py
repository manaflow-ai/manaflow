"""
Snapshot framework - a parallel task execution engine for provisioning instances.

This is the "Dockerfile-like" framework for defining and running dependency-based
tasks with parallel execution.
"""

from .engine import (
    TaskRegistry,
    TaskDefinition,
    TaskFunc,
    run_task_graph,
    format_dependency_graph,
)
from .context import (
    TaskContext,
    ResourceProfile,
)
from ._types import (
    Console,
    Command,
    TimingsCollector,
)
from .exec import (
    HttpExecClient,
    shell_command,
    wrap_command_with_cgroup,
)

__all__ = [
    # Engine
    "TaskRegistry",
    "TaskDefinition",
    "TaskFunc",
    "run_task_graph",
    "format_dependency_graph",
    "TimingsCollector",
    # Context
    "TaskContext",
    "ResourceProfile",
    # Types
    "Console",
    "Command",
    # Exec
    "HttpExecClient",
    "shell_command",
    "wrap_command_with_cgroup",
]
