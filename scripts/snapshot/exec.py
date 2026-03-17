"""
HTTP-based command execution client.

Provides streaming command execution over HTTP as an alternative to SSH.
"""

from __future__ import annotations

import asyncio
import json
import shlex
import ssl
import time
from http.client import HTTPResponse
from typing import cast
import urllib.error
import urllib.parse
import urllib.request

from morphcloud.api import InstanceExecResponse

from ._types import Console, Command

# HTTP status codes that indicate transient errors worth retrying
TRANSIENT_HTTP_CODES = frozenset({502, 503, 504})


def shell_command(command: Command) -> list[str]:
    """Convert a command to a bash -lc invocation."""
    if isinstance(command, str):
        script = f"set -euo pipefail\n{command}"
        return ["bash", "-lc", script]
    return list(command)


def wrap_command_with_cgroup(cgroup_path: str, command: Command) -> Command:
    """Wrap a command to run within a cgroup."""
    cgroup = shlex.quote(cgroup_path)
    prelude = f"""if [ -d {cgroup} ] && [ -w {cgroup}/cgroup.procs ]; then
    printf '%d\\n' $$ > {cgroup}/cgroup.procs || true
fi"""
    if isinstance(command, str):
        return f"{prelude}\n{command}"
    quoted = " ".join(shlex.quote(str(part)) for part in command)
    return f"{prelude}\n{quoted}"


class HttpExecClient:
    """HTTP client for the cmux-execd service with streaming output."""

    _base_url: str
    _console: Console
    _ssl_context: ssl.SSLContext | None

    def __init__(self, base_url: str, console: Console) -> None:
        self._base_url = base_url.rstrip("/")
        self._console = console
        parsed = urllib.parse.urlparse(self._base_url)
        if parsed.scheme == "https":
            self._ssl_context = ssl.create_default_context()
        else:
            self._ssl_context = None

    async def wait_ready(
        self,
        *,
        retries: int = 20,
        delay: float = 0.5,
    ) -> None:
        """Wait for the exec service to become healthy."""
        for attempt in range(1, retries + 1):
            try:
                await asyncio.to_thread(self._check_health)
                return
            except Exception:
                if attempt == retries:
                    break
                await asyncio.sleep(delay)
        raise RuntimeError("exec service did not become ready")

    def _check_health(self) -> None:
        url = urllib.parse.urljoin(f"{self._base_url}/", "healthz")
        request = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(
            request,
            timeout=5,
            context=self._ssl_context,
        ) as resp:  # pyright: ignore[reportAny]
            response = cast(HTTPResponse, resp)
            status: int | None = response.getcode()
            if status != 200:
                raise RuntimeError(f"unexpected health status {status}")

    async def run(
        self,
        label: str,
        command: Command,
        *,
        timeout: float | None,
    ) -> InstanceExecResponse:
        """Execute a command via the HTTP exec service."""
        return await asyncio.to_thread(
            self._run_sync,
            label,
            command,
            timeout,
        )

    def _run_sync(
        self,
        label: str,
        command: Command,
        timeout: float | None,
        *,
        max_retries: int = 3,
        initial_delay: float = 1.0,
    ) -> InstanceExecResponse:
        exec_cmd = shell_command(command)
        command_str = exec_cmd if isinstance(exec_cmd, str) else shlex.join(exec_cmd)
        url = urllib.parse.urljoin(f"{self._base_url}/", "exec")
        payload: dict[str, str | int] = {"command": command_str}
        if timeout is not None:
            payload["timeout_ms"] = max(int(timeout * 1000), 1)
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        request_timeout: float | None = None
        if timeout is not None:
            request_timeout = max(timeout + 5, 30.0)

        last_error: Exception | None = None
        for attempt in range(max_retries):
            request = urllib.request.Request(
                url, data=data, headers=headers, method="POST"
            )
            try:
                resp = urllib.request.urlopen(  # pyright: ignore[reportAny]
                    request,
                    timeout=request_timeout,
                    context=self._ssl_context,
                )
                response = cast(HTTPResponse, resp)
                break
            except urllib.error.HTTPError as exc:
                if exc.code in TRANSIENT_HTTP_CODES and attempt < max_retries - 1:
                    delay = initial_delay * (2**attempt)
                    self._console.info(
                        f"[{label}] HTTP {exc.code} error, retrying in {delay:.1f}s "
                        f"(attempt {attempt + 1}/{max_retries})"
                    )
                    time.sleep(delay)
                    last_error = exc
                    continue
                raise RuntimeError(f"exec service request failed: {exc}") from exc
            except urllib.error.URLError as exc:
                raise RuntimeError(f"exec service request failed: {exc}") from exc
        else:
            raise RuntimeError(
                f"exec service request failed after {max_retries} retries: {last_error}"
            ) from last_error

        stdout_parts: list[str] = []
        stderr_parts: list[str] = []
        exit_code: int | None = None
        try:
            status: int | None = response.getcode()
            if status != 200:
                body: str = response.read().decode("utf-8", "replace")
                raise RuntimeError(
                    f"exec service returned status {status}: {body.strip()}"
                )
            for raw_line in response:
                line: str = bytes(raw_line).decode("utf-8", "replace").rstrip("\r\n")
                if not line:
                    continue
                try:
                    event: dict[str, object] = json.loads(line)  # pyright: ignore[reportAny]
                except json.JSONDecodeError:
                    stderr_parts.append(f"invalid exec response: {line}")
                    self._console.info(
                        f"[{label}][stderr] invalid exec response: {line}"
                    )
                    continue
                event_type = event.get("type")
                if event_type == "stdout":
                    data_value = str(event.get("data", ""))
                    stdout_parts.append(data_value)
                    for sub_line in data_value.splitlines():
                        self._console.info(f"[{label}] {sub_line}")
                elif event_type == "stderr":
                    data_value = str(event.get("data", ""))
                    stderr_parts.append(data_value)
                    for sub_line in data_value.splitlines():
                        self._console.info(f"[{label}][stderr] {sub_line}")
                elif event_type == "exit":
                    try:
                        exit_code = int(str(event.get("code", 0)))
                    except (TypeError, ValueError):
                        exit_code = 1
                elif event_type == "error":
                    message = str(event.get("message", ""))
                    stderr_parts.append(message)
                    self._console.info(f"[{label}][stderr] {message}")
                else:
                    stderr_parts.append(f"unknown event type: {line}")
                    self._console.info(f"[{label}][stderr] unknown event: {line}")
        finally:
            response.close()

        stdout_text = "".join(stdout_parts)
        stderr_text = "".join(stderr_parts)
        if exit_code is None:
            self._console.info(
                f"[{label}] Warning: exec service did not report exit code, assuming success"
            )
            exit_code = 0
        if exit_code not in (0, None):
            error_parts = [f"{label} failed with exit code {exit_code}"]
            if stdout_text.strip():
                error_parts.append(f"stdout:\n{stdout_text.rstrip()}")
            if stderr_text.strip():
                error_parts.append(f"stderr:\n{stderr_text.rstrip()}")
            raise RuntimeError("\n".join(error_parts))
        return InstanceExecResponse(
            exit_code=exit_code,
            stdout=stdout_text,
            stderr=stderr_text,
        )
