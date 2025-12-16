"""
Task execution context and supporting types.
"""

from __future__ import annotations

import asyncio
import shlex
import socket
import textwrap
import typing as t

from dataclasses import dataclass, field

import httpx
from morphcloud.api import Instance, InstanceExecResponse

from ._types import Command, Console, TimingsCollector

if t.TYPE_CHECKING:
    from .exec import HttpExecClient


@dataclass(slots=True)
class ResourceProfile:
    name: str
    cpu_quota: int | None = None
    cpu_period: int | None = None
    cpu_weight: int | None = None
    memory_high: int | None = None
    memory_max: int | None = None
    io_weight: int | None = None


def _shell_command(command: Command) -> list[str]:
    if isinstance(command, str):
        script = f"set -euo pipefail\n{command}"
        return ["bash", "-lc", script]
    return list(command)


def _wrap_command_with_cgroup(cgroup_path: str, command: Command) -> Command:
    cgroup = shlex.quote(cgroup_path)
    prelude = textwrap.dedent(
        f"""
        if [ -d {cgroup} ] && [ -w {cgroup}/cgroup.procs ]; then
            printf '%d\\n' $$ > {cgroup}/cgroup.procs || true
        fi
        """
    ).strip()
    if isinstance(command, str):
        return f"{prelude}\n{command}"
    quoted = " ".join(shlex.quote(str(part)) for part in command)
    return f"{prelude}\n{quoted}"


async def _run_command(
    ctx: TaskContext,
    label: str,
    command: Command,
    *,
    timeout: float | None = None,
) -> InstanceExecResponse:
    ctx.console.info(f"[{label}] running...")
    command_parts = _shell_command(command)
    attempts: int = 0
    max_attempts: int = 3
    while True:
        attempts += 1
        try:
            result = await ctx.instance.aexec(
                command_parts,
                timeout=timeout,
            )
        except (httpx.HTTPError, OSError, socket.error) as exc:
            if attempts < max_attempts:
                delay: float = float(min(2**attempts, 8))  # pyright: ignore[reportAny]
                ctx.console.info(
                    f"[{label}] retrying after remote exec failure ({exc}) (attempt {attempts}/{max_attempts}) in {delay}s"
                )
                await asyncio.sleep(delay)
                continue
            raise
        stdout_lines = result.stdout.splitlines()
        stderr_lines = result.stderr.splitlines()
        for line in stdout_lines:
            ctx.console.info(f"[{label}] {line}")
        for line in stderr_lines:
            ctx.console.info(f"[{label}][stderr] {line}")
        exit_code = result.exit_code
        if exit_code not in (0, None):
            error_parts = [f"{label} failed with exit code {exit_code}"]
            if result.stdout.strip():
                error_parts.append(f"stdout:\n{result.stdout.rstrip()}")
            if result.stderr.strip():
                error_parts.append(f"stderr:\n{result.stderr.rstrip()}")
            raise RuntimeError("\n".join(error_parts))
        return result


@dataclass(slots=True)
class TaskContext:
    """Execution context passed to every task."""

    instance: Instance
    repo_root: t.Any  # Path, but avoid import
    remote_repo_root: str
    remote_repo_tar: str
    exec_service_url: str
    console: Console
    timings: TimingsCollector
    resource_profile: ResourceProfile | None = None
    cgroup_path: str | None = None
    exec_client: HttpExecClient | None = field(default=None, init=False)
    environment_prelude: str = field(default="", init=False)

    def __post_init__(self) -> None:
        exports = textwrap.dedent(
            """
            export RUSTUP_HOME=/usr/local/rustup
            export CARGO_HOME=/usr/local/cargo
            export NVM_DIR=/root/.nvm
            export GOPATH=/usr/local/go-workspace
            export GOMODCACHE="${GOPATH}/pkg/mod"
            export GOCACHE=/usr/local/go-cache
            export PATH="/root/.local/bin:/usr/local/cargo/bin:/usr/local/go/bin:${GOPATH}/bin:/usr/local/bin:$PATH"
            """
        ).strip()
        self.environment_prelude = exports

    async def run(
        self,
        label: str,
        command: Command,
        *,
        timeout: float | None = None,
    ) -> InstanceExecResponse:
        """Run a command, preferring the exec service if available."""
        command_with_env = self._apply_environment(command)
        command_to_run = (
            _wrap_command_with_cgroup(self.cgroup_path, command_with_env)
            if self.cgroup_path
            else command_with_env
        )
        if self.exec_client is not None:
            try:
                return await self.exec_client.run(
                    label,
                    command_to_run,
                    timeout=timeout,
                )
            except Exception as exc:
                log_tail = await self._collect_execd_log()
                if log_tail:
                    raise RuntimeError(
                        f"{exc}\n\ncmux-execd.log (tail):\n{log_tail}".rstrip()
                    ) from exc
                raise
        return await _run_command(self, label, command_to_run, timeout=timeout)

    async def run_via_ssh(
        self,
        label: str,
        command: Command,
        *,
        timeout: float | None = None,
        use_cgroup: bool = True,
    ) -> InstanceExecResponse:
        """Run a command directly via SSH, bypassing the exec service."""
        command_with_env = self._apply_environment(command)
        command_to_run = (
            _wrap_command_with_cgroup(self.cgroup_path, command_with_env)
            if use_cgroup and self.cgroup_path
            else command_with_env
        )
        return await _run_command(self, label, command_to_run, timeout=timeout)

    def _apply_environment(self, command: Command) -> Command:
        if not self.environment_prelude:
            return command
        if isinstance(command, str):
            return f"{self.environment_prelude}\n{command}"
        quoted = " ".join(shlex.quote(str(part)) for part in command)
        return f"{self.environment_prelude}\n{quoted}"

    async def _collect_execd_log(self) -> str | None:
        """Best-effort tail of the exec daemon log without using the exec service."""
        log_path = "/var/log/cmux-execd.log"
        try:
            result = await self.instance.aexec(
                ["bash", "-lc", f'if [ -f {log_path} ]; then tail -n 200 {log_path}; fi'],
                timeout=5,
            )
        except Exception:
            return None
        if result.exit_code not in (0, None):
            return None
        output = result.stdout.strip()
        return output or None
