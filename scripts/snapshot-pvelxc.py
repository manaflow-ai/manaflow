#!/usr/bin/env python3
"""
Provision Proxmox VE LXC containers from an existing base template, perform
parallelized environment setup that mirrors the Morph snapshot workflow, and
create snapshots for multiple presets (standard + boosted).

This is the PVE LXC equivalent of snapshot.py for self-hosted cmux sandboxes.

The flow:
1. Clone LXC container per preset from the provided base template
2. Start containers and wait for network
3. Execute dependency graph tasks concurrently via pct exec
4. Run in-container sanity checks (cargo/node/bun/uv/envd/envctl + service curls)
5. Snapshot the configured container and record in pve-lxc-snapshots.json

Required environment variables:
    PVE_API_URL - Proxmox API endpoint (e.g., https://pve.example.com:8006)
    PVE_API_TOKEN - API token in format: user@realm!tokenid=secret

Optional environment variables:
    PVE_PUBLIC_DOMAIN - Cloudflare Tunnel domain for HTTP exec (e.g., example.com)
                    When set, uses instanceId-based URL pattern:
                    https://port-{port}-{instanceId}.{domain} for command execution via
                    cmux-execd instead of SSH+pct exec. Falls back to SSH if not set.
    PVE_NODE - Target PVE node name (auto-detected if not set)
    PVE_SSH_HOST - SSH host for fallback (derived from PVE_API_URL if not set)

Examples:
    uv run --env-file .env ./scripts/snapshot-pvelxc.py
    uv run --env-file .env ./scripts/snapshot-pvelxc.py --template-vmid 9000
    uv run --env-file .env ./scripts/snapshot-pvelxc.py --standard-vcpus 4 --standard-memory 8192
"""

from __future__ import annotations

# Force unbuffered output for real-time console logging
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(line_buffering=True)
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(line_buffering=True)

import argparse
import asyncio
import http.client
import json
import os
import shlex
import shutil
import ssl
import subprocess
import tarfile
import tempfile
import textwrap
import traceback
import typing as t
import urllib.parse
import urllib.request
import uuid

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import dotenv

from snapshot import (
    TaskRegistry,
    Console,
    TimingsCollector,
    Command,
    format_dependency_graph,
)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

VSCODE_HTTP_PORT = 39378
WORKER_HTTP_PORT = 39376  # Node.js worker (PVE-LXC only); Go worker uses 39377
PROXY_HTTP_PORT = 39379
VNC_HTTP_PORT = 39380
CDP_HTTP_PORT = 39381
XTERM_HTTP_PORT = 39383
EXEC_HTTP_PORT = 39375
CDP_PROXY_BINARY_NAME = "cmux-cdp-proxy"
VNC_PROXY_BINARY_NAME = "cmux-vnc-proxy"
EXECD_BINARY_NAME = "cmux-execd"

PVE_SNAPSHOT_MANIFEST_PATH = (
    Path(__file__).resolve().parent.parent / "packages/shared/src/pve-lxc-snapshots.json"
)
CURRENT_MANIFEST_SCHEMA_VERSION = 2

# Default template VMID (should be created via pve-lxc-template.sh)
DEFAULT_TEMPLATE_VMID = 9000

# Base VMID for cloned containers during template building
# Clones will use 9000, 9001, 9002, etc. (auto-increments if slot is taken)
CLONE_BASE_VMID = 9000

# ---------------------------------------------------------------------------
# IDE Provider Configuration
# ---------------------------------------------------------------------------

IDE_PROVIDER_CODER = "coder"
IDE_PROVIDER_OPENVSCODE = "openvscode"
IDE_PROVIDER_CMUX_CODE = "cmux-code"
DEFAULT_IDE_PROVIDER = IDE_PROVIDER_CMUX_CODE

# Module-level IDE provider setting (set from args before task graph runs)
_ide_provider: str = DEFAULT_IDE_PROVIDER


def set_ide_provider(provider: str) -> None:
    global _ide_provider
    _ide_provider = provider


def get_ide_provider() -> str:
    return _ide_provider


# ---------------------------------------------------------------------------
# Git Diff Mode Configuration
# ---------------------------------------------------------------------------

# Module-level settings for git diff upload mode
_use_git_diff: bool = False


def set_git_diff_mode(use_diff: bool) -> None:
    global _use_git_diff
    _use_git_diff = use_diff


def get_git_diff_mode() -> bool:
    return _use_git_diff


# ---------------------------------------------------------------------------
# PVE API Client
# ---------------------------------------------------------------------------


class PveLxcClient:
    """Proxmox VE API client for LXC container management."""

    def __init__(
        self,
        api_url: str,
        api_token: str,
        node: str | None = None,
        verify_ssl: bool = False,
        ssh_host: str | None = None,
        cf_domain: str | None = None,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.api_token = api_token
        self.node = node
        self.verify_ssl = verify_ssl
        # Cloudflare Tunnel domain for public exec URLs (e.g., "example.com")
        # When set, uses instanceId-based URL pattern: port-{port}-{instanceId}.{cf_domain}
        # Falls back to legacy vmid-based URLs if hostname cannot be resolved.
        self.cf_domain = cf_domain
        self._http_host_ids: dict[int, str] = {}

        # Parse token: user@realm!tokenid=secret
        token_parts = api_token.split("=", 1)
        if len(token_parts) != 2:
            raise ValueError(
                "Invalid PVE_API_TOKEN format. Expected 'user@realm!tokenid=secret'"
            )
        self.token_id = token_parts[0]
        self.token_secret = token_parts[1]

        # SSH host for pct commands - only set if explicitly provided
        # When None, SSH fallback is disabled and HTTP exec is required
        self.ssh_host = ssh_host
        self._ssh_host_explicit = ssh_host is not None

        # SSH ControlMaster socket path for connection multiplexing
        # This allows multiple SSH sessions to share a single TCP connection
        self._ssh_control_path: str | None = None

        # Create SSL context
        self._ssl_context: ssl.SSLContext | None = None
        if not verify_ssl:
            self._ssl_context = ssl.create_default_context()
            self._ssl_context.check_hostname = False
            self._ssl_context.verify_mode = ssl.CERT_NONE

    def _request(
        self,
        method: str,
        endpoint: str,
        data: dict[str, t.Any] | None = None,
    ) -> dict[str, t.Any]:
        """Make authenticated API request."""
        url = f"{self.api_url}{endpoint}"
        headers = {
            "Authorization": f"PVEAPIToken={self.token_id}={self.token_secret}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        }

        body: bytes | None = None
        if data:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            body = urllib.parse.urlencode(data).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=body,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(
                req,
                context=self._ssl_context,
                timeout=60,
            ) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8", errors="replace")
            raise RuntimeError(
                f"PVE API error {e.code}: {e.reason}\n{error_body}"
            ) from e

    async def _arequest(
        self,
        method: str,
        endpoint: str,
        data: dict[str, t.Any] | None = None,
    ) -> dict[str, t.Any]:
        """Async wrapper for API request."""
        return await asyncio.to_thread(self._request, method, endpoint, data)

    def get_version(self) -> dict[str, t.Any]:
        """Get PVE version info."""
        return self._request("GET", "/api2/json/version")

    def get_node(self) -> str:
        """Get the target node (auto-detect if not set)."""
        if self.node:
            return self.node
        result = self._request("GET", "/api2/json/nodes")
        nodes = result.get("data", [])
        if not nodes:
            raise RuntimeError("No nodes found in PVE cluster")
        self.node = nodes[0]["node"]
        return self.node

    async def aget_node(self) -> str:
        """Async get node."""
        return await asyncio.to_thread(self.get_node)

    def list_lxc(self, node: str | None = None) -> list[dict[str, t.Any]]:
        """List LXC containers on a node."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc")
        return result.get("data", [])

    async def alist_lxc(self, node: str | None = None) -> list[dict[str, t.Any]]:
        """Async list LXC containers."""
        return await asyncio.to_thread(self.list_lxc, node)

    def get_lxc_status(self, vmid: int, node: str | None = None) -> dict[str, t.Any]:
        """Get LXC container status."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc/{vmid}/status/current")
        return result.get("data", {})

    async def aget_lxc_status(
        self, vmid: int, node: str | None = None
    ) -> dict[str, t.Any]:
        """Async get LXC status."""
        return await asyncio.to_thread(self.get_lxc_status, vmid, node)

    def get_lxc_config(self, vmid: int, node: str | None = None) -> dict[str, t.Any]:
        """Get LXC container config."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc/{vmid}/config")
        return result.get("data", {})

    async def aget_lxc_config(
        self, vmid: int, node: str | None = None
    ) -> dict[str, t.Any]:
        """Async get LXC config."""
        return await asyncio.to_thread(self.get_lxc_config, vmid, node)

    def clone_lxc(
        self,
        source_vmid: int,
        new_vmid: int,
        *,
        hostname: str | None = None,
        full: bool = False,  # Linked clone by default (fast)
        node: str | None = None,
    ) -> str:
        """Clone an LXC container. Returns task UPID. Default is linked clone (full=False)."""
        node = node or self.get_node()
        data: dict[str, t.Any] = {
            "newid": new_vmid,
            "full": 1 if full else 0,
        }
        if hostname:
            data["hostname"] = hostname
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{source_vmid}/clone",
            data,
        )
        return result.get("data", "")

    async def aclone_lxc(
        self,
        source_vmid: int,
        new_vmid: int,
        *,
        hostname: str | None = None,
        full: bool = False,  # Linked clone by default (fast)
        node: str | None = None,
    ) -> str:
        """Async clone LXC. Default is linked clone (full=False)."""
        return await asyncio.to_thread(
            self.clone_lxc, source_vmid, new_vmid,
            hostname=hostname, full=full, node=node
        )

    def start_lxc(self, vmid: int, node: str | None = None) -> str:
        """Start LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/status/start",
        )
        return result.get("data", "")

    async def astart_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async start LXC."""
        return await asyncio.to_thread(self.start_lxc, vmid, node)

    def stop_lxc(self, vmid: int, node: str | None = None) -> str:
        """Stop LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/status/stop",
        )
        return result.get("data", "")

    async def astop_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async stop LXC."""
        return await asyncio.to_thread(self.stop_lxc, vmid, node)

    def shutdown_lxc(self, vmid: int, node: str | None = None) -> str:
        """Gracefully shutdown LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/status/shutdown",
        )
        return result.get("data", "")

    async def ashutdown_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async shutdown LXC."""
        return await asyncio.to_thread(self.shutdown_lxc, vmid, node)

    def delete_lxc(self, vmid: int, node: str | None = None) -> str:
        """Delete LXC container. Returns task UPID."""
        node = node or self.get_node()
        result = self._request(
            "DELETE",
            f"/api2/json/nodes/{node}/lxc/{vmid}",
        )
        return result.get("data", "")

    async def adelete_lxc(self, vmid: int, node: str | None = None) -> str:
        """Async delete LXC."""
        return await asyncio.to_thread(self.delete_lxc, vmid, node)

    def set_lxc_config(
        self,
        vmid: int,
        *,
        cores: int | None = None,
        memory: int | None = None,
        description: str | None = None,
        tags: str | None = None,
        node: str | None = None,
    ) -> None:
        """Update LXC container configuration."""
        node = node or self.get_node()
        data: dict[str, t.Any] = {}
        if cores is not None:
            data["cores"] = cores
        if memory is not None:
            data["memory"] = memory
        if description is not None:
            data["description"] = description
        if tags is not None:
            data["tags"] = tags
        if data:
            self._request(
                "PUT",
                f"/api2/json/nodes/{node}/lxc/{vmid}/config",
                data,
            )

    async def aset_lxc_config(
        self,
        vmid: int,
        *,
        cores: int | None = None,
        memory: int | None = None,
        description: str | None = None,
        tags: str | None = None,
        node: str | None = None,
    ) -> None:
        """Async set LXC config."""
        await asyncio.to_thread(
            self.set_lxc_config,
            vmid,
            cores=cores,
            memory=memory,
            description=description,
            tags=tags,
            node=node,
        )

    def resize_lxc_disk(
        self,
        vmid: int,
        disk: str,
        size: str,
        node: str | None = None,
    ) -> str:
        """Resize LXC container disk. Returns task UPID."""
        node = node or self.get_node()
        data = {
            "disk": disk,
            "size": size,
        }
        result = self._request(
            "PUT",
            f"/api2/json/nodes/{node}/lxc/{vmid}/resize",
            data,
        )
        return result.get("data", "")

    async def aresize_lxc_disk(
        self,
        vmid: int,
        disk: str,
        size: str,
        node: str | None = None,
    ) -> None:
        """Async resize LXC disk and wait for completion."""
        upid = await asyncio.to_thread(
            self.resize_lxc_disk, vmid, disk, size, node=node
        )
        if upid:
            await self.await_task(upid, node=node)

    def create_snapshot(
        self,
        vmid: int,
        snapname: str,
        *,
        description: str | None = None,
        node: str | None = None,
    ) -> str:
        """Create LXC snapshot. Returns task UPID."""
        node = node or self.get_node()
        data: dict[str, t.Any] = {"snapname": snapname}
        if description:
            data["description"] = description
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/snapshot",
            data,
        )
        return result.get("data", "")

    async def acreate_snapshot(
        self,
        vmid: int,
        snapname: str,
        *,
        description: str | None = None,
        node: str | None = None,
    ) -> str:
        """Async create snapshot."""
        return await asyncio.to_thread(
            self.create_snapshot, vmid, snapname, description=description, node=node
        )

    def list_snapshots(
        self, vmid: int, node: str | None = None
    ) -> list[dict[str, t.Any]]:
        """List snapshots for LXC container."""
        node = node or self.get_node()
        result = self._request("GET", f"/api2/json/nodes/{node}/lxc/{vmid}/snapshot")
        return result.get("data", [])

    def convert_to_template(
        self,
        vmid: int,
        node: str | None = None,
    ) -> None:
        """Convert an LXC container to a template.

        The container must be stopped and have no snapshots.
        Once converted, the container becomes read-only and can only
        be used as a source for cloning.
        """
        node = node or self.get_node()
        result = self._request(
            "POST",
            f"/api2/json/nodes/{node}/lxc/{vmid}/template",
        )
        # Check for error message in response
        if result.get("message"):
            raise RuntimeError(f"Failed to convert to template: {result['message']}")

    async def aconvert_to_template(
        self,
        vmid: int,
        node: str | None = None,
    ) -> None:
        """Async convert to template."""
        await asyncio.to_thread(self.convert_to_template, vmid, node)

    def get_task_status(self, upid: str, node: str | None = None) -> dict[str, t.Any]:
        """Get task status."""
        node = node or self.get_node()
        # URL-encode the UPID since it contains special characters
        encoded_upid = urllib.parse.quote(upid, safe="")
        result = self._request("GET", f"/api2/json/nodes/{node}/tasks/{encoded_upid}/status")
        return result.get("data", {})

    async def aget_task_status(
        self, upid: str, node: str | None = None
    ) -> dict[str, t.Any]:
        """Async get task status."""
        return await asyncio.to_thread(self.get_task_status, upid, node)

    async def await_task(
        self,
        upid: str,
        *,
        timeout: int = 600,
        poll_interval: float = 2.0,
        node: str | None = None,
    ) -> dict[str, t.Any]:
        """Wait for a task to complete."""
        node = node or await self.aget_node()
        elapsed = 0.0
        while elapsed < timeout:
            status = await self.aget_task_status(upid, node)
            if status.get("status") == "stopped":
                exitstatus = status.get("exitstatus", "")
                if exitstatus == "OK":
                    return status
                raise RuntimeError(f"Task failed: {exitstatus}")
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
        raise TimeoutError(f"Task {upid} timed out after {timeout}s")

    def find_next_vmid(self, node: str | None = None, start: int = 100) -> int:
        """Find the next available VMID starting from `start`.

        Args:
            node: PVE node name (auto-detected if not set)
            start: Starting VMID to search from (default: 100)

        Returns:
            The first available VMID >= start
        """
        node = node or self.get_node()
        containers = self.list_lxc(node)
        used_vmids = {c["vmid"] for c in containers}

        # Also check QEMU VMs
        try:
            result = self._request("GET", f"/api2/json/nodes/{node}/qemu")
            vms = result.get("data", [])
            used_vmids.update(v["vmid"] for v in vms)
        except Exception:
            pass

        vmid = start
        while vmid in used_vmids:
            vmid += 1
        return vmid

    async def afind_next_vmid(self, node: str | None = None, start: int = 100) -> int:
        """Async find next VMID starting from `start`."""
        return await asyncio.to_thread(self.find_next_vmid, node, start)

    # -----------------------------------------------------------------------
    # SSH-based operations for pct commands
    # -----------------------------------------------------------------------

    def start_ssh_control_master(self) -> None:
        """Start SSH ControlMaster for connection multiplexing.

        This creates a persistent SSH connection that subsequent SSH commands
        can reuse, avoiding the overhead and connection limits of opening
        many separate TCP connections.
        """
        if self._ssh_control_path:
            return  # Already started

        # Create control socket in temp directory
        control_dir = tempfile.mkdtemp(prefix="pve_ssh_")
        self._ssh_control_path = os.path.join(control_dir, "control.sock")

        # Start ControlMaster in background
        cmd = [
            "ssh",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ControlMaster=yes",
            "-o", f"ControlPath={self._ssh_control_path}",
            "-o", "ControlPersist=600",  # Keep alive for 10 minutes
            "-N",  # No command, just open connection
            "-f",  # Go to background
            self.ssh_host,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            self._ssh_control_path = None
            raise RuntimeError(
                f"Failed to start SSH ControlMaster: {result.stderr}"
            )

    def stop_ssh_control_master(self) -> None:
        """Stop SSH ControlMaster and clean up."""
        if not self._ssh_control_path:
            return

        # Send exit command to control master
        cmd = [
            "ssh",
            "-o", f"ControlPath={self._ssh_control_path}",
            "-O", "exit",
            self.ssh_host,
        ]
        subprocess.run(cmd, capture_output=True, timeout=10)

        # Clean up control directory
        control_dir = os.path.dirname(self._ssh_control_path)
        try:
            shutil.rmtree(control_dir, ignore_errors=True)
        except Exception:
            pass
        self._ssh_control_path = None

    def ssh_exec(
        self,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Execute command on PVE host via SSH."""
        ssh_cmd = [
            "ssh",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
        ]
        # Use ControlMaster if available
        if self._ssh_control_path:
            ssh_cmd.extend([
                "-o", f"ControlPath={self._ssh_control_path}",
            ])
        ssh_cmd.extend([self.ssh_host, command])

        result = subprocess.run(
            ssh_cmd,
            capture_output=True,
            text=True,
            timeout=timeout or 600,
        )
        if check and result.returncode != 0:
            raise RuntimeError(
                f"SSH command failed (exit {result.returncode}):\n"
                f"Command: {command}\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )
        return result

    async def assh_exec(
        self,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Async SSH exec."""
        return await asyncio.to_thread(
            self.ssh_exec, command, timeout=timeout, check=check
        )

    def pct_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Execute command inside container via SSH + pct exec."""
        # Escape single quotes in command for remote shell
        escaped_cmd = command.replace("'", "'\"'\"'")
        remote_cmd = f"pct exec {vmid} -- bash -lc '{escaped_cmd}'"
        return self.ssh_exec(remote_cmd, timeout=timeout, check=check)

    async def apct_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Async pct exec."""
        return await asyncio.to_thread(
            self.pct_exec, vmid, command, timeout=timeout, check=check
        )

    def pct_push(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Push a file to container via SSH + pct push.

        First SCPs file to PVE host, then uses pct push to push into container.
        """
        import uuid
        tmp_name = f"/tmp/pct_push_{vmid}_{uuid.uuid4().hex[:8]}"

        # SCP local file to PVE host (uses ControlMaster if available)
        scp_cmd = [
            "scp",
            "-o", "BatchMode=yes",
            "-o", "StrictHostKeyChecking=accept-new",
        ]
        if self._ssh_control_path:
            scp_cmd.extend(["-o", f"ControlPath={self._ssh_control_path}"])
        scp_cmd.extend([local_path, f"{self.ssh_host}:{tmp_name}"])

        result = subprocess.run(
            scp_cmd,
            capture_output=True,
            text=True,
            timeout=timeout or 300,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"SCP failed (exit {result.returncode}): {result.stderr}"
            )

        # Push from PVE host to container
        try:
            self.ssh_exec(
                f"pct push {vmid} {tmp_name} {remote_path}",
                timeout=timeout,
            )
        finally:
            # Clean up temp file on PVE host
            try:
                self.ssh_exec(f"rm -f {tmp_name}", timeout=30, check=False)
            except Exception:
                pass

    async def apct_push(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Async pct push."""
        await asyncio.to_thread(
            self.pct_push, vmid, local_path, remote_path, timeout=timeout
        )

    # -----------------------------------------------------------------------
    # HTTP exec operations via cmux-execd (no SSH required)
    # -----------------------------------------------------------------------

    def _normalize_host_id(self, value: str) -> str:
        return value.strip().lower().replace("_", "-")

    def resolve_http_host_id(self, vmid: int) -> str | None:
        cached = self._http_host_ids.get(vmid)
        if cached:
            return cached
        try:
            config = self.get_lxc_config(vmid)
        except Exception:
            return None
        hostname = config.get("hostname")
        if isinstance(hostname, str) and hostname.strip():
            host_id = self._normalize_host_id(hostname)
            self._http_host_ids[vmid] = host_id
            return host_id
        return None

    def build_exec_url(self, vmid: int) -> str | None:
        """Build the HTTP exec URL for a container.

        Returns None if cf_domain is not configured.
        URL pattern (instanceId-based): https://port-{port}-{instanceId}.{cf_domain}
        """
        if not self.cf_domain:
            return None
        host_id = self.resolve_http_host_id(vmid)
        if not host_id:
            return None
        return f"https://port-39375-{host_id}.{self.cf_domain}/exec"

    def http_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str] | None:
        """Execute command inside container via HTTP exec (cmux-execd).

        Returns None if HTTP exec is not available (cf_domain not set).
        Falls back to SSH+pct exec if HTTP exec fails.

        The cmux-execd daemon runs on port 39375 inside containers and is
        exposed via Cloudflare Tunnel using instanceId-based URL pattern:
        https://port-{port}-{instanceId}.{cf_domain}
        """
        exec_url = self.build_exec_url(vmid)
        if not exec_url:
            return None

        timeout_ms = int((timeout or 600) * 1000)
        body = json.dumps({
            "command": f"HOME=/root {command}",
            "timeout_ms": timeout_ms,
        }).encode("utf-8")

        req = urllib.request.Request(
            exec_url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            method="POST",
        )

        stdout_lines: list[str] = []
        stderr_lines: list[str] = []
        exit_code: int | None = None

        try:
            with urllib.request.urlopen(
                req,
                timeout=timeout or 600,
            ) as response:
                # Parse streaming JSON lines response
                for line in response:
                    line_str = line.decode("utf-8").strip()
                    if not line_str:
                        continue
                    try:
                        event = json.loads(line_str)
                        if not isinstance(event, dict):
                            stderr_lines.append(f"Invalid JSON event (not a dict): {line_str}")
                            continue
                        event_type = event.get("type")
                        if event_type == "stdout":
                            stdout_lines.append(event.get("data", ""))
                        elif event_type == "stderr":
                            stderr_lines.append(event.get("data", ""))
                        elif event_type == "exit":
                            exit_code = event.get("code", 0)
                        elif event_type == "error":
                            stderr_lines.append(event.get("message", "Unknown error"))
                            exit_code = 1
                    except json.JSONDecodeError:
                        stderr_lines.append(line_str)
        except urllib.error.HTTPError as e:
            # Gateway errors (502, 503, 504) and Cloudflare timeout (524) indicate
            # cmux-execd is not available or the request timed out.
            # Return None to trigger fallback to SSH+pct exec if available.
            if e.code in (502, 503, 504, 524):
                return None
            error_body = e.read().decode("utf-8", errors="replace")
            stderr_lines.append(f"HTTP exec error {e.code}: {e.reason}\n{error_body}")
            exit_code = 1
        except urllib.error.URLError as e:
            # Connection failed - HTTP exec not available
            return None
        except TimeoutError:
            stderr_lines.append(f"HTTP exec timed out after {timeout}s")
            exit_code = 124
        except (ConnectionResetError, BrokenPipeError, http.client.IncompleteRead) as e:
            # Connection dropped during streaming response - treat as timeout/failure
            # This can happen when Cloudflare Tunnel drops the connection mid-stream
            stderr_lines.append(f"HTTP exec connection error: {e}")
            exit_code = 125
        except OSError as e:
            # Other OS errors (e.g., network unreachable, connection refused)
            # Return None to trigger SSH fallback if available
            return None

        if exit_code is None:
            exit_code = 0

        result = subprocess.CompletedProcess(
            args=command,
            returncode=exit_code,
            stdout="".join(stdout_lines),
            stderr="".join(stderr_lines),
        )

        if check and result.returncode != 0:
            raise RuntimeError(
                f"HTTP exec failed (exit {result.returncode}):\n"
                f"Command: {command}\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )

        return result

    async def ahttp_exec(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str] | None:
        """Async HTTP exec."""
        return await asyncio.to_thread(
            self.http_exec, vmid, command, timeout=timeout, check=check
        )

    def exec_in_container(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Execute command inside container, preferring HTTP exec over SSH.

        Tries HTTP exec first (via cmux-execd), falls back to SSH+pct exec
        only if PVE_SSH_HOST was explicitly provided.

        Raises RuntimeError if HTTP exec is not available and SSH is not configured.
        """
        # Try HTTP exec first if available
        result = self.http_exec(vmid, command, timeout=timeout, check=False)
        if result is not None:
            if check and result.returncode != 0:
                raise RuntimeError(
                    f"Command failed (exit {result.returncode}):\n"
                    f"Command: {command}\n"
                    f"stdout: {result.stdout}\n"
                    f"stderr: {result.stderr}"
                )
            return result

        # HTTP exec not available - check if SSH fallback is configured
        if not self._ssh_host_explicit:
            raise RuntimeError(
                f"HTTP exec (cmux-execd) not available for container {vmid} and "
                f"SSH fallback not configured.\n"
                f"Options:\n"
                f"  1. Set PVE_SSH_HOST=root@<pve-host-ip> to enable SSH fallback\n"
                f"  2. Ensure cmux-execd is running in the container for HTTP exec"
            )

        # Fall back to SSH+pct exec
        return self.pct_exec(vmid, command, timeout=timeout, check=check)

    async def aexec_in_container(
        self,
        vmid: int,
        command: str,
        *,
        timeout: float | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        """Async exec in container with HTTP/SSH fallback."""
        return await asyncio.to_thread(
            self.exec_in_container, vmid, command, timeout=timeout, check=check
        )

    def http_push_file(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> bool:
        """Push a file to container via HTTP exec using base64 encoding.

        Returns True if successful, False if HTTP exec is not available.
        """
        import base64

        exec_url = self.build_exec_url(vmid)
        if not exec_url:
            return False

        # Read local file and encode as base64
        with open(local_path, "rb") as f:
            file_data = f.read()
        b64_data = base64.b64encode(file_data).decode("ascii")

        # Escape the remote path for shell
        escaped_path = shlex.quote(remote_path)
        parent_dir = shlex.quote(str(Path(remote_path).parent))

        # Initialize the remote file
        init_cmd = f"mkdir -p {parent_dir} && : > {escaped_path}"
        result = self.http_exec(vmid, init_cmd, timeout=timeout, check=False)
        if result is None:
            return False

        if result.returncode != 0:
            # Fall back to SSH for payload too large errors (Cloudflare limit)
            if "413" in result.stderr or "Payload Too Large" in result.stderr:
                return False
            raise RuntimeError(
                f"HTTP file push failed (exit {result.returncode}):\n"
                f"stdout: {result.stdout}\n"
                f"stderr: {result.stderr}"
            )

        # Append base64 in chunks to avoid shell argument limits
        chunk_size = 8192  # multiple of 4 for base64 alignment
        for offset in range(0, len(b64_data), chunk_size):
            chunk = b64_data[offset: offset + chunk_size]
            append_cmd = (
                f"printf '%s' '{chunk}' | base64 -d >> {escaped_path}"
            )
            result = self.http_exec(vmid, append_cmd, timeout=timeout, check=False)
            if result is None:
                return False
            if result.returncode != 0:
                if "413" in result.stderr or "Payload Too Large" in result.stderr:
                    return False
                raise RuntimeError(
                    f"HTTP file push failed (exit {result.returncode}):\n"
                    f"stdout: {result.stdout}\n"
                    f"stderr: {result.stderr}"
                )

        return True

    async def ahttp_push_file(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> bool:
        """Async HTTP file push."""
        return await asyncio.to_thread(
            self.http_push_file, vmid, local_path, remote_path, timeout=timeout
        )

    def push_file_to_container(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Push file to container, preferring HTTP over SSH.

        Tries HTTP push first (via cmux-execd), falls back to SSH+pct push
        only if PVE_SSH_HOST was explicitly provided.

        Raises RuntimeError if HTTP push is not available and SSH is not configured.
        """
        # Try HTTP push first if available
        if self.http_push_file(vmid, local_path, remote_path, timeout=timeout):
            return

        # HTTP push not available - check if SSH fallback is configured
        if not self._ssh_host_explicit:
            raise RuntimeError(
                f"HTTP exec (cmux-execd) not available for container {vmid} and "
                f"SSH fallback not configured.\n"
                f"Options:\n"
                f"  1. Set PVE_SSH_HOST=root@<pve-host-ip> to enable SSH fallback\n"
                f"  2. Ensure cmux-execd is running in the container for HTTP exec"
            )

        # Fall back to SSH+pct push
        self.pct_push(vmid, local_path, remote_path, timeout=timeout)

    async def apush_file_to_container(
        self,
        vmid: int,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Async push file to container with HTTP/SSH fallback."""
        await asyncio.to_thread(
            self.push_file_to_container, vmid, local_path, remote_path, timeout=timeout
        )


# ---------------------------------------------------------------------------
# Manifest types and helpers
# ---------------------------------------------------------------------------


class PveTemplateVersionEntry(t.TypedDict):
    """A version entry for a preset template (schema v2)."""
    version: int
    snapshotId: str
    templateVmid: int  # The VMID of the template container
    capturedAt: str


class PveTemplatePresetEntry(t.TypedDict):
    """A preset entry in the manifest (schema v2)."""
    presetId: str
    label: str
    cpu: str
    memory: str
    disk: str
    versions: list[PveTemplateVersionEntry]
    description: t.NotRequired[str]


class PveTemplateManifestEntry(t.TypedDict):
    """The manifest file structure (schema v2).

    Schema v2 uses templates instead of snapshots for linked-clone support.
    Each preset's 'versions' contains snapshotId and templateVmid for
    instanceId-based snapshot selection.
    """
    schemaVersion: int
    updatedAt: str
    baseTemplateVmid: int  # The base template used to create preset templates
    node: str
    presets: list[PveTemplatePresetEntry]


@dataclass(slots=True, frozen=True)
class TemplatePresetPlan:
    """Configuration for a preset to be created."""
    preset_id: str
    label: str
    cpu_display: str
    memory_display: str
    disk_display: str
    vcpus: int
    memory_mib: int
    disk_size_mib: int


@dataclass(slots=True)
class TemplateRunResult:
    """Result of creating a preset template."""
    preset: TemplatePresetPlan
    snapshot_id: str
    template_vmid: int  # The VMID of the created template
    captured_at: str
    node: str


def _iso_timestamp() -> str:
    return (
        datetime.now(tz=timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _generate_instance_id(prefix: str = "pvelxc") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _generate_snapshot_id() -> str:
    return f"snapshot_{uuid.uuid4().hex[:8]}"


def _preset_id_to_tag(preset_id: str) -> str:
    return f"preset-{preset_id.replace('_', '-')}"


def _build_template_tags(preset_id: str | None) -> str:
    tags = ["cmux"]
    if preset_id:
        tags.append(_preset_id_to_tag(preset_id))
    return ";".join(tags)


def _build_template_description(
    *,
    snapshot_id: str,
    preset_id: str | None,
    captured_at: str,
    source_vmid: int,
    hostname: str | None,
) -> str:
    lines = [
        "cmux template snapshot",
        f"snapshotId: {snapshot_id}",
        f"presetId: {preset_id}" if preset_id else "presetId: unknown",
        f"capturedAt: {captured_at}",
        f"sourceVmid: {source_vmid}",
    ]
    if hostname:
        lines.append(f"hostname: {hostname}")
    return "\n".join(lines)


def _format_cpu_display(vcpus: int) -> str:
    return f"{vcpus} vCPU"


def _format_memory_display(memory_mib: int) -> str:
    memory_gb = max(memory_mib // 1024, 1)
    return f"{memory_gb} GB RAM"


def _format_disk_display(disk_size_mib: int) -> str:
    disk_gb = max(disk_size_mib // 1024, 1)
    return f"{disk_gb} GB SSD"


def _preset_id_from_resources(
    vcpus: int,
    memory_mib: int,
    disk_size_mib: int,
) -> str:
    memory_gb = max(memory_mib // 1024, 1)
    disk_gb = max(disk_size_mib // 1024, 1)
    return f"{vcpus}vcpu_{memory_gb}gb_{disk_gb}gb"


def _build_preset_plans(args: argparse.Namespace) -> tuple[TemplatePresetPlan, ...]:
    standard_plan = TemplatePresetPlan(
        preset_id=_preset_id_from_resources(
            args.standard_vcpus, args.standard_memory, args.standard_disk_size
        ),
        label="Standard workspace",
        cpu_display=_format_cpu_display(args.standard_vcpus),
        memory_display=_format_memory_display(args.standard_memory),
        disk_display=_format_disk_display(args.standard_disk_size),
        vcpus=args.standard_vcpus,
        memory_mib=args.standard_memory,
        disk_size_mib=args.standard_disk_size,
    )
    boosted_plan = TemplatePresetPlan(
        preset_id=_preset_id_from_resources(
            args.boosted_vcpus, args.boosted_memory, args.boosted_disk_size
        ),
        label="Performance workspace",
        cpu_display=_format_cpu_display(args.boosted_vcpus),
        memory_display=_format_memory_display(args.boosted_memory),
        disk_display=_format_disk_display(args.boosted_disk_size),
        vcpus=args.boosted_vcpus,
        memory_mib=args.boosted_memory,
        disk_size_mib=args.boosted_disk_size,
    )
    return (standard_plan, boosted_plan)


def _ensure_manifest_snapshot_ids(manifest: PveTemplateManifestEntry) -> None:
    for preset in manifest.get("presets", []):
        for version in preset.get("versions", []):
            if not version.get("snapshotId"):
                version["snapshotId"] = _generate_snapshot_id()


def _load_manifest() -> PveTemplateManifestEntry:
    if not PVE_SNAPSHOT_MANIFEST_PATH.exists():
        return {
            "schemaVersion": CURRENT_MANIFEST_SCHEMA_VERSION,
            "updatedAt": _iso_timestamp(),
            "baseTemplateVmid": DEFAULT_TEMPLATE_VMID,
            "node": "",
            "presets": [],
        }
    try:
        raw_manifest = json.loads(PVE_SNAPSHOT_MANIFEST_PATH.read_text())
    except Exception as exc:
        raise RuntimeError(
            f"Failed to read PVE template manifest at {PVE_SNAPSHOT_MANIFEST_PATH}: {exc}"
        ) from exc
    _ensure_manifest_snapshot_ids(raw_manifest)
    return raw_manifest


def _write_manifest(manifest: PveTemplateManifestEntry) -> None:
    PVE_SNAPSHOT_MANIFEST_PATH.write_text(
        json.dumps(manifest, indent=2, sort_keys=False) + "\n"
    )


def _find_preset_for_vmid(manifest: PveTemplateManifestEntry, vmid: int) -> PveTemplatePresetEntry | None:
    """Find the preset entry that contains a given template VMID."""
    for preset in manifest.get("presets", []):
        for version in preset.get("versions", []):
            if version.get("templateVmid") == vmid:
                return preset
    return None


def _add_version_to_preset(
    preset_entry: PveTemplatePresetEntry,
    template_vmid: int,
    snapshot_id: str,
    captured_at: str,
) -> None:
    """Add a new version entry to an existing preset."""
    next_version = 1
    if preset_entry["versions"]:
        next_version = max(entry["version"] for entry in preset_entry["versions"]) + 1

    version_entry: PveTemplateVersionEntry = {
        "version": next_version,
        "snapshotId": snapshot_id,
        "templateVmid": template_vmid,
        "capturedAt": captured_at,
    }
    preset_entry["versions"].append(version_entry)
    preset_entry["versions"].sort(key=lambda entry: entry["version"])


def _update_manifest_with_template(
    manifest: PveTemplateManifestEntry,
    preset: TemplatePresetPlan,
    template_vmid: int,
    snapshot_id: str,
    captured_at: str,
    node: str,
) -> PveTemplateManifestEntry:
    """Update manifest with a new template version for a preset."""
    manifest["node"] = node
    manifest["updatedAt"] = captured_at

    preset_entry: PveTemplatePresetEntry | None = None
    for candidate in manifest["presets"]:
        if candidate.get("presetId") == preset.preset_id:
            preset_entry = candidate
            break

    if preset_entry is None:
        preset_entry = {
            "presetId": preset.preset_id,
            "label": preset.label,
            "cpu": preset.cpu_display,
            "memory": preset.memory_display,
            "disk": preset.disk_display,
            "versions": [],
        }
        manifest["presets"].append(preset_entry)
    else:
        preset_entry["label"] = preset.label
        preset_entry["cpu"] = preset.cpu_display
        preset_entry["memory"] = preset.memory_display
        preset_entry["disk"] = preset.disk_display

    next_version = 1
    if preset_entry["versions"]:
        next_version = max(entry["version"] for entry in preset_entry["versions"]) + 1

    version_entry: PveTemplateVersionEntry = {
        "version": next_version,
        "snapshotId": snapshot_id,
        "templateVmid": template_vmid,
        "capturedAt": captured_at,
    }
    preset_entry["versions"].append(version_entry)
    preset_entry["versions"].sort(key=lambda entry: entry["version"])

    return manifest


# ---------------------------------------------------------------------------
# PVE Task Context - executes via pct exec
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class PveExecResponse:
    """Response from pct exec command."""
    exit_code: int
    stdout: str
    stderr: str


@dataclass(slots=True)
class PveTaskContext:
    """Execution context for PVE LXC tasks using SSH + pct exec."""

    vmid: int
    client: PveLxcClient
    repo_root: Path
    remote_repo_root: str
    remote_repo_tar: str
    console: Console
    timings: TimingsCollector
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
    ) -> PveExecResponse:
        """Run a command inside the LXC container via SSH + pct exec."""
        command_with_env = self._apply_environment(command)
        return await self._run_pct_exec(label, command_with_env, timeout=timeout)

    def _apply_environment(self, command: Command) -> str:
        """Apply environment prelude to command."""
        if isinstance(command, str):
            cmd_str = command
        else:
            cmd_str = " ".join(shlex.quote(str(part)) for part in command)
        if self.environment_prelude:
            return f"{self.environment_prelude}\n{cmd_str}"
        return cmd_str

    async def _run_pct_exec(
        self,
        label: str,
        command: str,
        *,
        timeout: float | None = None,
    ) -> PveExecResponse:
        """Execute command via HTTP exec (cmux-execd) or SSH + pct exec fallback."""
        self.console.info(f"[{label}] running...")

        # Wrap command in bash explicitly to ensure pipefail support
        # This handles the case where execd may use /bin/sh (dash) which doesn't support pipefail
        # We invoke bash explicitly so the script works regardless of execd's shell
        escaped_command = command.replace("'", "'\"'\"'")
        script = f"/bin/bash -c '{escaped_command}'"

        attempts = 0
        max_attempts = 3
        while True:
            attempts += 1
            try:
                # Use aexec_in_container which prefers HTTP exec over SSH
                result = await self.client.aexec_in_container(
                    self.vmid,
                    script,
                    timeout=timeout,
                    check=False,  # We handle errors ourselves
                )
                break
            except subprocess.TimeoutExpired as e:
                raise TimeoutError(f"Command timed out after {timeout}s") from e
            except (OSError, RuntimeError) as exc:
                if attempts < max_attempts:
                    delay = float(min(2**attempts, 8))
                    self.console.info(
                        f"[{label}] retrying after exec failure ({exc}) (attempt {attempts}/{max_attempts}) in {delay}s"
                    )
                    await asyncio.sleep(delay)
                    continue
                raise

        # Log output
        for line in result.stdout.splitlines():
            self.console.info(f"[{label}] {line}")
        for line in result.stderr.splitlines():
            self.console.info(f"[{label}][stderr] {line}")

        if result.returncode != 0:
            error_parts = [f"{label} failed with exit code {result.returncode}"]
            if result.stdout.strip():
                error_parts.append(f"stdout:\n{result.stdout.rstrip()}")
            if result.stderr.strip():
                error_parts.append(f"stderr:\n{result.stderr.rstrip()}")
            raise RuntimeError("\n".join(error_parts))

        return PveExecResponse(
            exit_code=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
        )

    async def push_file(
        self,
        local_path: str,
        remote_path: str,
        *,
        timeout: float | None = None,
    ) -> None:
        """Push a file to the container via HTTP exec or SSH + pct push."""
        await self.client.apush_file_to_container(
            self.vmid, local_path, remote_path, timeout=timeout
        )


# ---------------------------------------------------------------------------
# Git / repo helpers
# ---------------------------------------------------------------------------


def _exec_git(repo_root: Path, args: list[str]) -> str | None:
    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")
    git_candidates = [env.get("GIT_EXE"), env.get("GIT_BINARY"), "git"]
    errors: list[str] = []
    for candidate in git_candidates:
        if not candidate:
            continue
        try:
            completed = subprocess.run(
                [candidate, *args],
                cwd=str(repo_root),
                env=env,
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError:
            errors.append(f"{candidate}: not found")
            continue
        if completed.returncode == 0:
            return completed.stdout
        errors.append(
            completed.stderr.strip() or f"{candidate}: exit code {completed.returncode}"
        )
    if errors:
        raise RuntimeError(f"git command {' '.join(args)} failed: {'; '.join(errors)}")
    return None


def list_repo_files(repo_root: Path) -> list[Path]:
    output = _exec_git(
        repo_root,
        ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    )
    if output is None:
        files: list[Path] = []
        for path in repo_root.rglob("*"):
            if path.is_file() and ".git" not in path.parts:
                files.append(path.relative_to(repo_root))
        return files
    entries = [entry for entry in output.split("\0") if entry]
    return [Path(entry) for entry in entries]


def create_repo_archive(repo_root: Path) -> Path:
    files = list_repo_files(repo_root)
    tmp = tempfile.NamedTemporaryFile(prefix="cmux-repo-", suffix=".tar", delete=False)
    tmp_path = Path(tmp.name)
    tmp.close()
    with tarfile.open(tmp_path, "w") as tar:
        for rel_path in files:
            full_path = repo_root / rel_path
            if not full_path.exists():
                continue
            tar.add(full_path, arcname=str(rel_path))
    return tmp_path


def get_git_remote_url(repo_root: Path) -> str | None:
    """Get the git remote origin URL."""
    try:
        output = _exec_git(repo_root, ["remote", "get-url", "origin"])
        if output:
            return output.strip()
    except RuntimeError:
        pass
    return None


def get_current_branch(repo_root: Path) -> str | None:
    """Get the current branch name."""
    try:
        output = _exec_git(repo_root, ["rev-parse", "--abbrev-ref", "HEAD"])
        if output:
            branch = output.strip()
            if branch != "HEAD":  # Not detached HEAD
                return branch
    except RuntimeError:
        pass
    return None


def get_upstream_branch(repo_root: Path) -> str | None:
    """Get the upstream tracking branch (e.g., 'origin/main')."""
    try:
        output = _exec_git(repo_root, ["rev-parse", "--abbrev-ref", "@{upstream}"])
        if output:
            return output.strip()
    except RuntimeError:
        pass
    return None


def get_remote_branch_commit(repo_root: Path, remote_branch: str) -> str | None:
    """Get the commit hash of a remote branch (e.g., 'origin/main')."""
    try:
        output = _exec_git(repo_root, ["rev-parse", remote_branch])
        if output:
            return output.strip()
    except RuntimeError:
        pass
    return None


def create_full_diff_patch(repo_root: Path, base_ref: str) -> Path | None:
    """Create a git diff patch that includes ALL local changes relative to base_ref.

    This includes:
    - Unpushed commits (commits between base_ref and HEAD)
    - Staged changes
    - Unstaged changes

    Returns the path to the patch file, or None if no changes.
    """
    tmp = tempfile.NamedTemporaryFile(
        suffix=".patch", delete=False, mode="wb"
    )
    tmp_path = Path(tmp.name)
    tmp.close()

    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")

    try:
        # Create diff from base_ref to current working tree (includes everything)
        # --binary: include binary files
        # base_ref: the reference point (e.g., origin/branch)
        # No second ref means "working tree" (includes uncommitted changes)
        completed = subprocess.run(
            ["git", "diff", "--binary", base_ref],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            check=False,
        )

        diff_output = completed.stdout

        # Also get staged changes that might not be captured by the above
        # (in case there are staged changes not yet committed)
        # This is redundant with the above, but just to be safe
        if not diff_output.strip():
            print(f"[git-diff] No differences from {base_ref}")
            tmp_path.unlink(missing_ok=True)
            return None

        tmp_path.write_bytes(diff_output)
        patch_size = tmp_path.stat().st_size
        print(f"[git-diff] Created full patch from {base_ref}: {patch_size} bytes")
        return tmp_path

    except Exception as e:
        print(f"[git-diff] Failed to create full diff patch: {e}")
        tmp_path.unlink(missing_ok=True)
        return None


def create_local_changes_patch(repo_root: Path) -> Path | None:
    """Create a git diff patch for local uncommitted changes only.

    Returns the path to the patch file, or None if no local changes.
    This captures staged + unstaged changes in the working directory.
    """
    tmp = tempfile.NamedTemporaryFile(
        prefix="cmux-local-", suffix=".patch", delete=False
    )
    tmp_path = Path(tmp.name)
    tmp.close()

    env = dict(os.environ)
    env.setdefault("LC_ALL", "C")

    try:
        # Get staged changes
        completed_staged = subprocess.run(
            ["git", "diff", "--binary", "--cached"],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            check=False,
        )
        staged_diff = completed_staged.stdout if completed_staged.returncode == 0 else b""

        # Get unstaged changes (working directory)
        completed_unstaged = subprocess.run(
            ["git", "diff", "--binary"],
            cwd=str(repo_root),
            env=env,
            capture_output=True,
            check=False,
        )
        unstaged_diff = completed_unstaged.stdout if completed_unstaged.returncode == 0 else b""

        # Combine diffs
        combined_diff = b""
        if staged_diff:
            combined_diff = staged_diff
        if unstaged_diff:
            if combined_diff:
                combined_diff += b"\n"
            combined_diff += unstaged_diff

        if not combined_diff.strip():
            print("[git-diff] No local uncommitted changes")
            tmp_path.unlink(missing_ok=True)
            return None

        tmp_path.write_bytes(combined_diff)
        patch_size = tmp_path.stat().st_size
        print(f"[git-diff] Created local changes patch: {patch_size} bytes")
        return tmp_path

    except Exception as e:
        print(f"[git-diff] Failed to create local changes patch: {e}")
        tmp_path.unlink(missing_ok=True)
        return None


async def upload_repo_via_diff(
    vmid: int,
    client: PveLxcClient,
    repo_root: Path,
    remote_repo_root: str,
    console: Console,
) -> bool:
    """Upload repository via git clone from GitHub + local changes patch.

    New approach:
    1. Get git remote URL and current branch name
    2. Get upstream tracking branch (e.g., origin/feature/branch)
    3. In container: git clone + checkout the tracking branch
    4. Create diff from tracking branch to local working tree (includes unpushed commits + uncommitted changes)
    5. Upload and apply the diff patch

    This is much faster than uploading full archive because:
    - The base repo comes from GitHub (fast, no upload needed)
    - Only local changes (unpushed + uncommitted) need to be uploaded as a patch

    Returns True if successful, False if fallback to full upload is needed.
    """
    # Get git remote URL
    remote_url = await asyncio.to_thread(get_git_remote_url, repo_root)
    if not remote_url:
        console.info("[git-diff] No git remote URL found, falling back to full upload")
        return False

    # Get current branch
    current_branch = await asyncio.to_thread(get_current_branch, repo_root)
    if not current_branch:
        console.info("[git-diff] Not on a branch (detached HEAD), falling back to full upload")
        return False

    # Get upstream tracking branch (e.g., origin/feature/branch)
    upstream_branch = await asyncio.to_thread(get_upstream_branch, repo_root)
    if not upstream_branch:
        # If no tracking branch, assume origin/<current_branch>
        upstream_branch = f"origin/{current_branch}"
        console.info(f"[git-diff] No upstream tracking branch, assuming {upstream_branch}")

    # Get the commit hash of the upstream branch
    upstream_commit = await asyncio.to_thread(get_remote_branch_commit, repo_root, upstream_branch)
    if not upstream_commit:
        console.info(f"[git-diff] Cannot find upstream branch {upstream_branch}, falling back to full upload")
        return False

    console.info(f"[git-diff] Remote: {remote_url}")
    console.info(f"[git-diff] Branch: {current_branch}")
    console.info(f"[git-diff] Upstream: {upstream_branch} ({upstream_commit[:12]})")

    # Step 1: Clone or fetch repo in container at the upstream branch
    # Use bash explicitly for pipefail support (dash/sh doesn't support it)
    # Extract branch name from upstream_branch (e.g., "origin/feature/foo" -> "feature/foo")
    remote_branch_name = "/".join(upstream_branch.split("/")[1:])  # "feature/foo"

    clone_cmd = textwrap.dedent(
        f"""
        bash -c 'set -euo pipefail
        REPO_DIR={shlex.quote(remote_repo_root)}
        REMOTE_URL={shlex.quote(remote_url)}
        BRANCH={shlex.quote(remote_branch_name)}
        TARGET_COMMIT={shlex.quote(upstream_commit)}

        if [ -d "$REPO_DIR/.git" ]; then
            echo "[git-diff] Existing repo found, fetching updates..."
            cd "$REPO_DIR"
            git fetch origin "$BRANCH"
            git checkout -f "$TARGET_COMMIT"
            git clean -fd
        else
            echo "[git-diff] Cloning repository from GitHub..."
            rm -rf "$REPO_DIR"
            # Clone the specific branch
            git clone --branch "$BRANCH" --single-branch "$REMOTE_URL" "$REPO_DIR" || {{
                # If branch clone fails, try full clone
                echo "[git-diff] Branch clone failed, trying full clone..."
                git clone "$REMOTE_URL" "$REPO_DIR"
            }}
            cd "$REPO_DIR"
            git checkout -f "$TARGET_COMMIT"
            git clean -fd
        fi
        echo "[git-diff] Repository at commit $(git rev-parse --short HEAD)"
        '
        """
    ).strip()

    console.info(f"[git-diff] Cloning/fetching branch {remote_branch_name} from GitHub in container...")

    # Retry clone operation a few times to handle transient HTTP errors (502, etc.)
    max_clone_attempts = 3
    clone_delay = 5.0
    result = None
    for attempt in range(1, max_clone_attempts + 1):
        result = await client.aexec_in_container(vmid, clone_cmd, timeout=300, check=False)
        if result.returncode == 0:
            break
        # Check for transient errors that are worth retrying
        is_transient = any(
            err in result.stderr
            for err in ["502", "503", "504", "Bad Gateway", "Service Unavailable", "Gateway Timeout"]
        )
        if not is_transient or attempt >= max_clone_attempts:
            console.info(f"[git-diff] Clone/fetch failed: {result.stderr}")
            console.info(f"[git-diff] stdout: {result.stdout}")
            return False
        console.info(f"[git-diff] Clone attempt {attempt}/{max_clone_attempts} failed with transient error, retrying in {clone_delay}s...")
        await asyncio.sleep(clone_delay)
        clone_delay *= 2  # Exponential backoff

    if result is None or result.returncode != 0:
        return False

    for line in result.stdout.splitlines():
        if line.strip():
            console.info(f"  {line}")

    # Step 2: Create full diff patch (unpushed commits + uncommitted changes)
    # This diffs from the upstream branch to the current working tree
    patch_path = await asyncio.to_thread(create_full_diff_patch, repo_root, upstream_branch)

    if patch_path is not None:
        try:
            patch_size = patch_path.stat().st_size
            console.info(f"[git-diff] Full patch size (unpushed + uncommitted): {patch_size} bytes")

            # Upload patch file
            remote_patch_path = "/tmp/cmux-full.patch"
            if client.cf_domain:
                console.info(f"[git-diff] Uploading patch to container {vmid} via HTTP exec...")
            else:
                console.info(f"[git-diff] Uploading patch to container {vmid} via SSH...")
            await client.apush_file_to_container(vmid, str(patch_path), remote_patch_path)

            # Apply patch in container
            # Use bash explicitly for pipefail support (dash/sh doesn't support it)
            console.info("[git-diff] Applying full patch...")
            apply_cmd = textwrap.dedent(
                f"""
                bash -c 'set -euo pipefail
                cd {shlex.quote(remote_repo_root)}
                git apply --whitespace=nowarn {remote_patch_path}
                rm -f {remote_patch_path}
                echo "[git-diff] Patch applied successfully"
                '
                """
            ).strip()

            result = await client.aexec_in_container(vmid, apply_cmd, timeout=120, check=False)
            if result.returncode != 0:
                console.info(f"[git-diff] Patch apply failed: {result.stderr}")
                console.info("[git-diff] Continuing with upstream branch only (no local changes)")
            else:
                console.info("[git-diff] Full patch applied (unpushed commits + uncommitted changes)")
        finally:
            patch_path.unlink(missing_ok=True)
    else:
        console.info("[git-diff] No local changes to apply (working tree matches upstream)")

    console.info("[git-diff] Repository updated via git clone + patch")
    return True


async def upload_repo_to_container(
    vmid: int,
    client: PveLxcClient,
    repo_root: Path,
    remote_tar_path: str,
    console: Console,
) -> None:
    """Upload repository archive to container via HTTP exec or SSH + pct push."""
    console.info("Creating repository archive...")
    archive = await asyncio.to_thread(create_repo_archive, repo_root)
    try:
        if client.cf_domain:
            console.info(f"Uploading repository to container {vmid} via HTTP exec...")
        else:
            console.info(f"Uploading repository to container {vmid} via SSH...")
        await client.apush_file_to_container(vmid, str(archive), remote_tar_path)
        console.info(f"Repository uploaded to {remote_tar_path}")
    finally:
        archive.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# Task registry and task definitions
# ---------------------------------------------------------------------------

dotenv.load_dotenv()

registry = TaskRegistry()
update_registry = TaskRegistry()  # Subset of tasks for --update mode


# Shell helper to wait for apt/dpkg lock before running apt commands.
# This prevents race conditions when multiple tasks try to use apt concurrently.
# Uses apt-get options to wait for locks instead of fuser (which may not be installed).
APT_WAIT_LOCK_HELPER = """
# Configure apt to wait for locks instead of failing immediately
export APT_LOCK_WAIT_OPTS="-o DPkg::Lock::Timeout=120"
"""


@registry.task(
    name="apt-bootstrap",
    description="Install core apt utilities and set up package sources",
)
async def task_apt_bootstrap(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux

        # Configure APT for parallel downloads
        cat > /etc/apt/apt.conf.d/99parallel << 'EOF'
        Acquire::Queue-Mode "host";
        APT::Acquire::Max-Parallel-Downloads "16";
        Acquire::http::Pipeline-Depth "10";
        Acquire::https::Pipeline-Depth "10";
        EOF

        # Update and install core utilities
        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            ca-certificates curl wget jq git gnupg lsb-release \
            tar unzip xz-utils zip bzip2 gzip htop lsof

        # Setup GitHub CLI repository
        install -m 0755 -d /usr/share/keyrings
        curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
            | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
        chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
        arch="$(dpkg --print-architecture)"
        echo "deb [arch=${arch} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
            > /etc/apt/sources.list.d/github-cli.list

        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("apt-bootstrap", cmd)


@registry.task(
    name="install-base-packages",
    deps=("apt-bootstrap",),
    description="Install build-essential tooling and utilities",
)
async def task_install_base_packages(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux

        DEBIAN_FRONTEND=noninteractive apt-get update
        DEBIAN_FRONTEND=noninteractive apt-get install -y \
            build-essential make pkg-config g++ libssl-dev \
            ruby-full perl software-properties-common \
            tigervnc-standalone-server tigervnc-common \
            xvfb \
            x11-xserver-utils xterm novnc \
            dbus-x11 openbox \
            tmux \
            gh \
            zsh \
            zsh-autosuggestions \
            ripgrep ffmpeg xdotool

        # Download and install Chrome
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64)
            chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
            ;;
          arm64)
            chrome_url="https://dl.google.com/linux/direct/google-chrome-stable_current_arm64.deb"
            ;;
          *)
            echo "Unsupported architecture: ${arch}" >&2
            exit 1
            ;;
        esac
        cd /tmp
        curl -fsSL -o chrome.deb "${chrome_url}"
        DEBIAN_FRONTEND=noninteractive apt-get install -y ./chrome.deb || true
        DEBIAN_FRONTEND=noninteractive apt-get install -yf
        rm -f chrome.deb

        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("install-base-packages", cmd)


@registry.task(
    name="ensure-docker",
    deps=("install-base-packages",),
    description="Install Docker engine and CLI plugins",
)
async def task_ensure_docker(ctx: PveTaskContext) -> None:
    install_cmd = APT_WAIT_LOCK_HELPER + textwrap.dedent(
        """
        set -euo pipefail

        echo "[docker] ensuring Docker APT repository"
        # Use DPkg::Lock::Timeout to wait for locks instead of failing immediately
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS update
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS install -y ca-certificates curl
        os_release="/etc/os-release"
        if [ ! -f "$os_release" ]; then
          echo "Missing /etc/os-release; unable to determine distribution" >&2
          exit 1
        fi
        . "$os_release"
        distro_codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-stable}}"
        distro_id="${ID:-debian}"
        case "$distro_id" in
          ubuntu|Ubuntu|UBUNTU)
            repo_id="ubuntu"
            ;;
          debian|Debian|DEBIAN)
            repo_id="debian"
            ;;
          *)
            echo "Unrecognized distro id '$distro_id'; defaulting to debian" >&2
            repo_id="debian"
            ;;
        esac
        install -m 0755 -d /etc/apt/keyrings
        curl -fsSL "https://download.docker.com/linux/${repo_id}/gpg" -o /etc/apt/keyrings/docker.asc
        chmod a+r /etc/apt/keyrings/docker.asc
        printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\\n' \
          "$(dpkg --print-architecture)" "$repo_id" "$distro_codename" \
          > /etc/apt/sources.list.d/docker.list

        echo "[docker] installing engine and CLI plugins"
        # Retry apt-get update up to 3 times
        for i in 1 2 3; do
          DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS update && break || {
            if [ $i -eq 3 ]; then
              echo "apt-get update failed after 3 attempts" >&2
              exit 1
            fi
            echo "apt-get update failed, retrying in 5s..." >&2
            sleep 5
          }
        done
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS install -y \
          docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

        # Disable standard Docker services to avoid race condition with cmux-dockerd.service
        # cmux-dockerd.service has fallback logic to run dockerd directly
        systemctl disable docker.service docker.socket || true
        systemctl stop docker.service docker.socket || true

        for attempt in $(seq 1 30); do
          if docker info >/dev/null 2>&1; then
            echo "[docker] daemon is ready"
            break
          fi
          if [ "$attempt" -eq 30 ]; then
            echo "[docker] daemon failed to start within expected window" >&2
            # Don't fail - Docker may need container restart for full functionality
            exit 0
          fi
          sleep 2
        done

        docker --version || true
        docker compose version || true
        docker buildx version || true
        """
    )
    await ctx.run("ensure-docker-install", install_cmd)


@registry.task(
    name="install-node-runtime",
    deps=("install-base-packages",),
    description="Install Node.js runtime and pnpm via corepack",
)
async def task_install_node(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        NODE_VERSION="24.9.0"
        arch="$(uname -m)"
        case "${arch}" in
          x86_64) node_arch="x64" ;;
          aarch64|arm64) node_arch="arm64" ;;
          *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;;
        esac
        tmp_dir="$(mktemp -d)"
        trap 'rm -rf "${tmp_dir}"' EXIT
        cd "${tmp_dir}"
        curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
        curl -fsSLO "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
        grep " node-v${NODE_VERSION}-linux-${node_arch}.tar.xz$" SHASUMS256.txt | sha256sum -c -
        tar -xJf "node-v${NODE_VERSION}-linux-${node_arch}.tar.xz" -C /usr/local --strip-components=1
        cd /
        ln -sf /usr/local/bin/node /usr/bin/node
        ln -sf /usr/local/bin/npm /usr/bin/npm
        ln -sf /usr/local/bin/npx /usr/bin/npx
        ln -sf /usr/local/bin/corepack /usr/bin/corepack
        npm install -g node-gyp
        corepack enable
        corepack prepare pnpm@10.14.0 --activate
        """
    )
    await ctx.run("install-node-runtime", cmd)


@registry.task(
    name="install-nvm",
    deps=("install-node-runtime",),
    description="Install nvm for runtime use",
)
async def task_install_nvm(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        export NVM_DIR="/root/.nvm"
        mkdir -p "${NVM_DIR}"
        curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh" | bash
        cat <<'PROFILE' > /etc/profile.d/nvm.sh
        export NVM_DIR="$HOME/.nvm"
        [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
        [ -s "$NVM_DIR/bash_completion" ] && . "$NVM_DIR/bash_completion"
        PROFILE
        bash -lc 'source /etc/profile.d/nvm.sh && nvm --version'
        """
    )
    await ctx.run("install-nvm", cmd)


@registry.task(
    name="install-bun",
    deps=("install-base-packages",),
    description="Install Bun runtime (background download to avoid Cloudflare timeout)",
)
async def task_install_bun(ctx: PveTaskContext) -> None:
    # Check if bun is already installed (base template may have it)
    check_result = await ctx.client.aexec_in_container(
        ctx.vmid,
        "command -v bun && bun --version",
        timeout=15,
        check=False,
    )
    if check_result.returncode == 0 and "bun" in check_result.stdout.lower():
        version = check_result.stdout.strip().split("\n")[-1]
        ctx.console.info(f"[install-bun] Bun already installed: {version}")
        return

    # Step 1: Detect architecture and start bun download in background
    # The background download avoids Cloudflare Tunnel's ~100s timeout
    cmd = textwrap.dedent(
        """
        set -eux
        arch="$(uname -m)"
        case "${arch}" in
          x86_64) bun_arch="x64" ;;
          aarch64|arm64) bun_arch="aarch64" ;;
          *) echo "Unsupported architecture: ${arch}" >&2; exit 1 ;;
        esac

        # Get latest bun version
        BUN_VERSION="$(curl -fsSL https://api.github.com/repos/oven-sh/bun/releases/latest | jq -r '.tag_name' | sed 's/^bun-v//')"
        echo "Installing bun v${BUN_VERSION} for ${bun_arch}..."

        # Save arch for installation step
        echo "${bun_arch}" > /tmp/bun-arch

        # Download in background to avoid Cloudflare timeout
        url="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}/bun-linux-${bun_arch}.zip"
        nohup sh -c "curl -fsSL --retry 3 --retry-delay 5 -o /tmp/bun.zip '${url}' && touch /tmp/bun-download-done" > /tmp/bun-download.log 2>&1 &
        echo "Background download started (PID: $!)"
        """
    )
    await ctx.run("start-bun-download", cmd, timeout=60)

    # Step 2: Poll for download completion
    ctx.console.info("[install-bun] Waiting for background download to complete...")
    max_wait = 600  # 10 minutes max
    poll_interval = 10
    elapsed = 0

    while elapsed < max_wait:
        try:
            result = await ctx.client.aexec_in_container(
                ctx.vmid,
                "[ -f /tmp/bun-download-done ] && echo done || echo waiting",
                timeout=15,
                check=False,
            )
        except (RuntimeError, TimeoutError) as e:
            # Transient failure in exec connection (e.g. Cloudflare tunnel hiccup)
            ctx.console.info(f"[install-bun] Polling check failed ({e}), retrying in {poll_interval}s...")
            await asyncio.sleep(poll_interval)
            elapsed += poll_interval
            continue

        if "done" in result.stdout:
            ctx.console.info("[install-bun] Download completed")
            break
        # Check for download failure
        if elapsed > 30:  # Give it some time to start
            check_result = await ctx.client.aexec_in_container(
                ctx.vmid,
                "pgrep -f 'curl.*bun.zip' > /dev/null && echo running || echo stopped",
                timeout=15,
                check=False,
            )
            if "stopped" in check_result.stdout and "done" not in result.stdout:
                # Download process stopped but didn't complete
                log_result = await ctx.client.aexec_in_container(
                    ctx.vmid,
                    "cat /tmp/bun-download.log 2>/dev/null || echo 'no log'",
                    timeout=15,
                    check=False,
                )
                raise RuntimeError(f"Bun download failed:\n{log_result.stdout}")
        await asyncio.sleep(poll_interval)
        elapsed += poll_interval
        if elapsed % 30 == 0:
            ctx.console.info(f"[install-bun] Still downloading... ({elapsed}s)")
    else:
        # Timeout - get the log for debugging
        try:
            log_result = await ctx.client.aexec_in_container(
                ctx.vmid,
                "cat /tmp/bun-download.log 2>/dev/null || echo 'no log'",
                timeout=15,
                check=False,
            )
            log_content = log_result.stdout
        except Exception as e:
            log_content = f"Could not retrieve log: {e}"
        
        raise TimeoutError(f"Bun download timed out after {max_wait}s\nLog: {log_content}")

    # Step 3: Extract and install bun
    cmd = textwrap.dedent(
        """
        set -eux
        bun_arch="$(cat /tmp/bun-arch)"
        cd /tmp
        unzip -o bun.zip
        install -m 0755 "bun-linux-${bun_arch}/bun" /usr/local/bin/bun
        ln -sf /usr/local/bin/bun /usr/local/bin/bunx

        # Cleanup
        rm -rf /tmp/bun.zip /tmp/bun-linux-* /tmp/bun-arch /tmp/bun-download-done /tmp/bun-download.log

        # Verify
        bun --version
        bunx --version
        """
    )
    await ctx.run("install-bun-binary", cmd, timeout=600)


@registry.task(
    name="install-go-toolchain",
    deps=("install-base-packages",),
    description="Install Go toolchain for building CMux helpers",
)
async def task_install_go_toolchain(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        GO_VERSION="1.25.5"
        ARCH="$(uname -m)"
        case "${ARCH}" in
          x86_64)
            GO_ARCH="amd64"
            ;;
          aarch64|arm64)
            GO_ARCH="arm64"
            ;;
          *)
            echo "Unsupported architecture for Go: ${ARCH}" >&2
            exit 1
            ;;
        esac
        TMP_DIR="$(mktemp -d)"
        trap 'rm -rf "${TMP_DIR}"' EXIT
        cd "${TMP_DIR}"
        curl -fsSLo go.tar.gz "https://go.dev/dl/go${GO_VERSION}.linux-${GO_ARCH}.tar.gz"
        rm -rf /usr/local/go
        tar -C /usr/local -xzf go.tar.gz
        install -d /usr/local/bin
        install -d -m 0755 /usr/local/go-workspace/bin
        install -d -m 0755 /usr/local/go-workspace/pkg/mod
        install -d -m 0755 /usr/local/go-workspace/pkg/sumdb
        install -d -m 0755 /usr/local/go-cache
        ln -sf /usr/local/go/bin/go /usr/local/bin/go
        ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt
        /usr/local/go/bin/go version
        """
    )
    await ctx.run("install-go-toolchain", cmd)


@registry.task(
    name="install-uv-python",
    deps=("ensure-docker",),
    description="Install uv CLI and provision default Python runtime",
)
async def task_install_uv_python(ctx: PveTaskContext) -> None:
    cmd = APT_WAIT_LOCK_HELPER + textwrap.dedent(
        """
        set -eux
        # Use DPkg::Lock::Timeout to wait for locks instead of failing immediately
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS update
        DEBIAN_FRONTEND=noninteractive apt-get $APT_LOCK_WAIT_OPTS install -y python3-pip
        python3 -m pip install --break-system-packages uv
        export PATH="${HOME}/.local/bin:/usr/local/cargo/bin:${PATH}"
        uv python install --default
        PIP_VERSION="$(curl -fsSL https://pypi.org/pypi/pip/json | jq -r '.info.version')"
        python3 -m pip install --break-system-packages --upgrade "pip==${PIP_VERSION}"
        ln -sf /usr/bin/python3 /usr/bin/python
        rm -rf /var/lib/apt/lists/*
        """
    )
    await ctx.run("install-uv-python", cmd)


@registry.task(
    name="install-rust-toolchain",
    deps=("install-base-packages",),
    description="Install Rust toolchain via rustup",
)
async def task_install_rust_toolchain(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        install -d -m 0755 "${RUSTUP_HOME}" "${CARGO_HOME}"
        install -d -m 0755 "${CARGO_HOME}/bin"
        export PATH="${CARGO_HOME}/bin:${PATH}"
        ARCH="$(uname -m)"
        case "${ARCH}" in
          x86_64)
            RUST_HOST_TARGET="x86_64-unknown-linux-gnu"
            ;;
          aarch64|arm64)
            RUST_HOST_TARGET="aarch64-unknown-linux-gnu"
            ;;
          *)
            echo "Unsupported architecture: ${ARCH}" >&2
            exit 1
            ;;
        esac
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | \
          sh -s -- -y --no-modify-path --profile minimal
        source "${CARGO_HOME}/env"
        rustup component add rustfmt
        rustup target add "${RUST_HOST_TARGET}"
        rustup default stable
        """
    )
    await ctx.run("install-rust-toolchain", cmd)


@registry.task(
    name="install-openvscode",
    deps=("apt-bootstrap",),
    description="Install OpenVSCode server",
)
async def task_install_openvscode(ctx: PveTaskContext) -> None:
    if get_ide_provider() != IDE_PROVIDER_OPENVSCODE:
        ctx.console.info("Skipping install-openvscode (IDE provider is not openvscode)")
        return
    cmd = textwrap.dedent(
        """
        set -eux
        CODE_RELEASE="$(curl -fsSL https://api.github.com/repos/gitpod-io/openvscode-server/releases/latest | jq -r '.tag_name' | sed 's|^openvscode-server-v||')"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="x64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/openvscode-server
        url="https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v${CODE_RELEASE}/openvscode-server-v${CODE_RELEASE}-linux-${ARCH}.tar.gz"
        curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/openvscode-server.tar.gz "${url}" || \
          curl -fSL4 --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/openvscode-server.tar.gz "${url}"
        tar xf /tmp/openvscode-server.tar.gz -C /app/openvscode-server --strip-components=1
        rm -f /tmp/openvscode-server.tar.gz
        """
    )
    await ctx.run("install-openvscode", cmd)


@registry.task(
    name="install-coder",
    deps=("apt-bootstrap",),
    description="Install Coder (code-server)",
)
async def task_install_coder(ctx: PveTaskContext) -> None:
    if get_ide_provider() != IDE_PROVIDER_CODER:
        ctx.console.info("Skipping install-coder (IDE provider is not coder)")
        return
    cmd = textwrap.dedent(
        """
        set -eux
        CODER_RELEASE="$(curl -fsSL https://api.github.com/repos/coder/code-server/releases/latest | jq -r '.tag_name' | sed 's|^v||')"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="amd64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/code-server
        url="https://github.com/coder/code-server/releases/download/v${CODER_RELEASE}/code-server-${CODER_RELEASE}-linux-${ARCH}.tar.gz"
        curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/code-server.tar.gz "${url}" || \
          curl -fSL4 --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/code-server.tar.gz "${url}"
        tar xf /tmp/code-server.tar.gz -C /app/code-server --strip-components=1
        rm -f /tmp/code-server.tar.gz

        mkdir -p /root/.config/code-server
        cat > /root/.config/code-server/config.yaml << 'EOF'
bind-addr: 0.0.0.0:39378
auth: none
cert: false
EOF

        mkdir -p /root/.code-server/User
        cat > /root/.code-server/User/settings.json << 'EOF'
{
  "workbench.startupEditor": "none"
}
EOF
        """
    )
    await ctx.run("install-coder", cmd)


@registry.task(
    name="install-cmux-code",
    deps=("apt-bootstrap", "restart-execd-early"),
    description="Install Cmux Code (VSCode fork with OpenVSIX)",
)
async def task_install_cmux_code(ctx: PveTaskContext) -> None:
    if get_ide_provider() != IDE_PROVIDER_CMUX_CODE:
        ctx.console.info("Skipping install-cmux-code (IDE provider is not cmux-code)")
        return
    cmd = textwrap.dedent(
        """
        set -eux
        CODE_RELEASE="$(curl -fsSL https://api.github.com/repos/karlorz/vscode-1/releases/latest | jq -r '.tag_name' | sed 's|^v||')"
        if [ -z "${CODE_RELEASE}" ] || [ "${CODE_RELEASE}" = "null" ]; then
          echo "ERROR: Failed to get cmux-code release version from GitHub API" >&2
          exit 1
        fi
        echo "Installing cmux-code version: ${CODE_RELEASE}"
        arch="$(dpkg --print-architecture)"
        case "${arch}" in
          amd64) ARCH="x64" ;;
          arm64) ARCH="arm64" ;;
          *) echo "Unsupported architecture ${arch}" >&2; exit 1 ;;
        esac
        mkdir -p /app/cmux-code
        url="https://github.com/karlorz/vscode-1/releases/download/v${CODE_RELEASE}/vscode-server-linux-${ARCH}-web.tar.gz"
        echo "Downloading ${url}..."
        curl -fSL --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/cmux-code.tar.gz "${url}" || \
          curl -fSL4 --retry 6 --retry-all-errors --retry-delay 2 --connect-timeout 20 --max-time 600 -o /tmp/cmux-code.tar.gz "${url}"
        
        ls -lh /tmp/cmux-code.tar.gz
        
        tar xf /tmp/cmux-code.tar.gz -C /app/cmux-code --strip-components=1
        rm -f /tmp/cmux-code.tar.gz

        echo "Contents of /app/cmux-code:"
        ls -R /app/cmux-code

        mkdir -p /root/.vscode-server-oss/data/User
        cat > /root/.vscode-server-oss/data/User/settings.json << 'EOF'
{
  "workbench.startupEditor": "none",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "security.workspace.trust.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.verifySignature": false,
  "editor.formatOnSave": true,
  "editor.formatOnSaveMode": "file",
  "files.autoSave": "afterDelay",
  "files.autoSaveDelay": 1000
}
EOF

        # Verify binary exists after extraction
        bin_path="/app/cmux-code/bin/code-server-oss"
        if [ ! -x "${bin_path}" ]; then
          echo "ERROR: cmux-code binary not found at ${bin_path} after extraction" >&2
          echo "Checking /app/cmux-code contents:" >&2
          find /app/cmux-code -type f -name "code-server*" 2>/dev/null || echo "No code-server binaries found"
          ls -la /app/cmux-code/bin/ 2>/dev/null || echo "bin directory missing or empty"
          exit 1
        fi
        echo "cmux-code binary verified at ${bin_path}"
        """
    )
    # Write the script to a local temp file, push it to the container,
    # then execute it. This avoids shell escaping issues with large scripts.
    import tempfile
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sh", delete=False
    ) as script_file:
        script_file.write(cmd)
        script_file.flush()
        local_script_path = script_file.name

    try:
        remote_script_path = "/tmp/install-cmux-code.sh"
        await ctx.push_file(local_script_path, remote_script_path)
        # Note: Don't use 'exec' here - it replaces the shell process which can
        # cause the HTTP exec daemon to think the command completed prematurely
        await ctx.run(
            "install-cmux-code",
            f"chmod +x {remote_script_path} && bash {remote_script_path}",
        )
    finally:
        import os
        os.unlink(local_script_path)


@registry.task(
    name="upload-repo",
    deps=("apt-bootstrap",),
    description="Upload repository to the container",
)
@update_registry.task(
    name="upload-repo",
    deps=(),  # No deps in update mode - tools already installed
    description="Upload repository to the container",
)
async def task_upload_repo(ctx: PveTaskContext) -> None:
    use_diff = get_git_diff_mode()

    # Try git diff mode if enabled (clones from GitHub + applies local changes)
    if use_diff:
        ctx.console.info("[upload-repo] Git diff mode enabled (clone from GitHub + local changes)")
        diff_success = await upload_repo_via_diff(
            ctx.vmid,
            ctx.client,
            ctx.repo_root,
            ctx.remote_repo_root,
            ctx.console,
        )
        if diff_success:
            ctx.console.info("[upload-repo] Repository updated via git clone + local patch")
            return
        ctx.console.info("[upload-repo] Git diff failed, falling back to full upload")

    # Full upload mode (default or fallback)
    await upload_repo_to_container(
        ctx.vmid, ctx.client, ctx.repo_root, ctx.remote_repo_tar, ctx.console
    )
    extract_cmd = textwrap.dedent(
        f"""
        rm -rf {shlex.quote(ctx.remote_repo_root)}
        mkdir -p {shlex.quote(ctx.remote_repo_root)}
        tar -xf {shlex.quote(ctx.remote_repo_tar)} -C {shlex.quote(ctx.remote_repo_root)}
        rm -f {shlex.quote(ctx.remote_repo_tar)}
        """
    )
    await ctx.run("extract-repo", extract_cmd)


@registry.task(
    name="install-repo-dependencies",
    deps=("upload-repo", "install-bun", "install-node-runtime"),
    description="Install workspace dependencies via bun",
)
@update_registry.task(
    name="install-repo-dependencies",
    deps=("upload-repo",),  # bun/node already installed
    description="Install workspace dependencies via bun",
)
async def task_install_repo_dependencies(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        f"""
        export PATH="/usr/local/bin:$PATH"
        cd {shlex.quote(ctx.remote_repo_root)}
        bun install --frozen-lockfile
        """
    )
    await ctx.run("install-repo-dependencies", cmd)


@registry.task(
    name="package-vscode-extension",
    deps=("install-repo-dependencies", "restart-execd-early"),
    description="Package the cmux VS Code extension for installation",
)
@update_registry.task(
    name="package-vscode-extension",
    deps=("install-repo-dependencies", "restart-execd-early"),
    description="Package the cmux VS Code extension for installation",
)
async def task_package_vscode_extension(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/bin:$PATH"
        cd {repo}/packages/vscode-extension
        # Compile the extension first (bun:prepublish runs compile-bun)
        bun run compile
        # Use local vsce binary from node_modules instead of bunx
        # This avoids bunx auto-install issues through proxy
        vsce_bin="{repo}/node_modules/.bin/vsce"
        if [ ! -x "$vsce_bin" ]; then
          echo "[package-vscode-extension] vsce not found in node_modules, trying bun install..."
          bun install
          if [ ! -x "$vsce_bin" ]; then
            echo "[package-vscode-extension] ERROR: vsce still not found after bun install" >&2
            exit 1
          fi
        fi
        "$vsce_bin" package --allow-missing-repository --no-dependencies --allow-star-activation || true
        echo "[package-vscode-extension] Looking for vsix file..."
        ls -la *.vsix 2>/dev/null || true
        latest_vsix="$(ls -1t cmux-vscode-extension-*.vsix 2>/dev/null | head -n 1)"
        if [ -z "${{latest_vsix}}" ] || [ ! -f "${{latest_vsix}}" ]; then
          echo "[package-vscode-extension] ERROR: cmux VS Code extension package not found" >&2
          exit 1
        fi
        echo "[package-vscode-extension] Found: ${{latest_vsix}}"
        install -Dm0644 "${{latest_vsix}}" /tmp/cmux-vscode-extension.vsix
        echo "[package-vscode-extension] Installed to /tmp/cmux-vscode-extension.vsix"
        ls -la /tmp/cmux-vscode-extension.vsix
        """
    )
    await ctx.run("package-vscode-extension", cmd)


@registry.task(
    name="install-ide-extensions",
    deps=("install-openvscode", "install-coder", "install-cmux-code", "package-vscode-extension", "restart-execd-early"),
    description="Preinstall language extensions for the IDE",
)
@update_registry.task(
    name="install-ide-extensions",
    # Depends on restart-execd-early to ensure the new execd is running before this task
    deps=("package-vscode-extension", "restart-execd-early"),
    description="Preinstall language extensions for the IDE",
)
async def task_install_ide_extensions(ctx: PveTaskContext) -> None:
    # Note: restart-execd-early has already restarted execd with the streaming fix,
    # so we don't need to restart it again here.
    ide_provider = get_ide_provider()
    if ide_provider == IDE_PROVIDER_CODER:
        server_root = "/app/code-server"
        bin_path = f"{server_root}/bin/code-server"
        extensions_dir = "/root/.code-server/extensions"
        user_data_dir = "/root/.code-server"
    elif ide_provider == IDE_PROVIDER_CMUX_CODE:
        server_root = "/app/cmux-code"
        bin_path = f"{server_root}/bin/code-server-oss"
        extensions_dir = "/root/.vscode-server-oss/extensions"
        user_data_dir = "/root/.vscode-server-oss/data"
    else:
        server_root = "/app/openvscode-server"
        bin_path = f"{server_root}/bin/openvscode-server"
        extensions_dir = "/root/.openvscode-server/extensions"
        user_data_dir = "/root/.openvscode-server/data"

    ide_deps_path = Path(__file__).resolve().parent.parent / "configs/ide-deps.json"
    try:
        ide_deps_raw = ide_deps_path.read_text(encoding="utf-8")
        ide_deps = json.loads(ide_deps_raw)
    except Exception as exc:
        raise RuntimeError(f"Failed to read {ide_deps_path}") from exc

    extensions = ide_deps.get("extensions")
    if not isinstance(extensions, list):
        raise RuntimeError("configs/ide-deps.json extensions must be an array.")

    # Validate extensions
    for ext in extensions:
        if not isinstance(ext, dict):
            raise RuntimeError(f"Invalid extension entry {ext!r}")
        publisher = ext.get("publisher")
        name = ext.get("name")
        version = ext.get("version")
        if (
            not isinstance(publisher, str)
            or not isinstance(name, str)
            or not isinstance(version, str)
        ):
            raise RuntimeError(f"Invalid extension entry {ext!r}")

    if not extensions:
        raise RuntimeError("No extensions found in configs/ide-deps.json.")

    # Install extensions using smaller inline commands instead of a large script file.
    # This works around HTTP exec streaming issues where large scripts get truncated.

    # Step 1: Install the bundled cmux extension
    cmux_vsix = "/tmp/cmux-vscode-extension.vsix"
    install_cmd = textwrap.dedent(
        f"""
        set -eux
        export HOME=/root
        echo "[install-ide-extensions] checking cmux extension"
        ls -la {cmux_vsix}
        echo "[install-ide-extensions] installing bundled cmux extension"
        {bin_path} --install-extension {cmux_vsix} --force --extensions-dir {extensions_dir} --user-data-dir {user_data_dir} </dev/null || true
        echo "[install-ide-extensions] cmux extension installed"
        rm -f {cmux_vsix}
        """
    )
    await ctx.run("install-cmux-ext", install_cmd)

    # Step 2: Download and install marketplace extensions one at a time
    for ext in extensions:
        publisher = ext.get("publisher")
        name = ext.get("name")
        version = ext.get("version")
        ext_id = f"{publisher}.{name}"
        vsix_path = f"/tmp/{ext_id}.vsix"
        url = f"https://marketplace.visualstudio.com/_apis/public/gallery/publishers/{publisher}/vsextensions/{name}/{version}/vspackage"

        download_cmd = textwrap.dedent(
            f"""
            set -eux
            export HOME=/root
            echo "[install-ide-extensions] downloading {ext_id}@{version}"
            curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 --max-time 300 -o {vsix_path}.tmp "{url}"
            if gzip -t {vsix_path}.tmp 2>/dev/null; then
                gunzip -c {vsix_path}.tmp > {vsix_path}
                rm -f {vsix_path}.tmp
            else
                mv {vsix_path}.tmp {vsix_path}
            fi
            echo "[install-ide-extensions] downloaded {ext_id}"
            """
        )
        await ctx.run(f"download-{ext_id}", download_cmd)

        install_ext_cmd = textwrap.dedent(
            f"""
            set -eux
            export HOME=/root
            echo "[install-ide-extensions] installing {ext_id}"
            {bin_path} --install-extension {vsix_path} --force --extensions-dir {extensions_dir} --user-data-dir {user_data_dir} </dev/null || true
            echo "[install-ide-extensions] installed {ext_id}"
            rm -f {vsix_path}
            """
        )
        await ctx.run(f"install-{ext_id}", install_ext_cmd)


@registry.task(
    name="install-cursor-cli",
    deps=("apt-bootstrap",),
    description="Install Cursor CLI",
)
async def task_install_cursor(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        curl https://cursor.com/install -fsS | bash
        /root/.local/bin/cursor-agent --version
        """
    )
    await ctx.run("install-cursor-cli", cmd)


@registry.task(
    name="install-global-cli",
    deps=("install-bun", "install-node-runtime"),
    description="Install global agent CLIs with bun",
)
async def task_install_global_cli(ctx: PveTaskContext) -> None:
    ide_deps_path = Path(__file__).resolve().parent.parent / "configs/ide-deps.json"
    try:
        ide_deps_raw = ide_deps_path.read_text(encoding="utf-8")
        ide_deps = json.loads(ide_deps_raw)
    except Exception as exc:
        raise RuntimeError(f"Failed to read {ide_deps_path}") from exc

    packages = ide_deps.get("packages")
    if not isinstance(packages, dict):
        raise RuntimeError("configs/ide-deps.json packages must be an object.")

    package_args: list[str] = []
    for name, version in packages.items():
        if not isinstance(name, str) or not isinstance(version, str):
            raise RuntimeError(f"Invalid package entry {name!r}: {version!r}")
        package_args.append(f"{name}@{version}")

    if not package_args:
        raise RuntimeError("No packages found in configs/ide-deps.json.")

    # Install each package individually with retries for resilience
    max_retries = 3
    retry_delay = 5  # seconds

    for i, pkg in enumerate(package_args, 1):
        ctx.console.info(f"Installing package {i}/{len(package_args)}: {pkg}")
        last_error: Exception | None = None

        for attempt in range(1, max_retries + 1):
            try:
                cmd = f"bun add -g {pkg}"
                await ctx.run(f"install-pkg-{pkg.split('@')[0].replace('/', '-')}", cmd)
                ctx.console.info(f"Successfully installed {pkg}")
                break
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    ctx.console.info(
                        f"Attempt {attempt}/{max_retries} failed for {pkg}, "
                        f"retrying in {retry_delay}s..."
                    )
                    await asyncio.sleep(retry_delay)
                else:
                    ctx.console.info(f"All {max_retries} attempts failed for {pkg}")

        if last_error is not None:
            raise RuntimeError(f"Failed to install {pkg} after {max_retries} attempts") from last_error

    # Verify critical binaries are installed
    verify_cmd = textwrap.dedent(
        """
        set -e
        echo "Verifying installed CLIs..."
        which claude && claude --version || echo "claude not found"
        which codex && codex --version || echo "codex not found"
        which opencode && opencode --version || echo "opencode not found"
        which gemini && gemini --version || echo "gemini not found"
        # amp and codebuff may not have --version, just check existence
        which amp || echo "amp not found"
        which codebuff || echo "codebuff not found"
        which devcontainer && devcontainer --version || echo "devcontainer not found"
        echo "CLI verification complete"
        """
    )
    await ctx.run("verify-global-cli", verify_cmd)


@registry.task(
    name="setup-claude-oauth-wrappers",
    deps=("install-global-cli",),
    description="Create wrapper scripts for claude/npx to support OAuth token injection",
)
@update_registry.task(
    name="setup-claude-oauth-wrappers",
    deps=(),  # No deps - global-cli already installed
    description="Create wrapper scripts for claude/npx to support OAuth token injection",
)
async def task_setup_claude_oauth_wrappers(ctx: PveTaskContext) -> None:
    script_path = Path(__file__).parent.parent / "configs" / "setup-claude-oauth-wrappers.sh"
    script_content = script_path.read_text()
    await ctx.run("setup-claude-oauth-wrappers", script_content)


@registry.task(
    name="configure-zsh",
    deps=("upload-repo", "install-base-packages"),
    description="Install zsh configuration and default prompt",
)
async def task_configure_zsh(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        r"""
        set -eux
        zsh_path="$(command -v zsh)"
        if [ -z "${zsh_path}" ]; then
          echo "zsh not found" >&2
          exit 1
        fi
        current_shell="$(getent passwd root | cut -d: -f7 || true)"
        if [ "${current_shell}" != "${zsh_path}" ]; then
          if command -v chsh >/dev/null 2>&1; then
            chsh -s "${zsh_path}" root
          else
            usermod -s "${zsh_path}" root
          fi
        fi
        mkdir -p /root
        autosuggestions="/usr/share/zsh-autosuggestions/zsh-autosuggestions.zsh"
        cat > /root/.zshrc <<EOF
export SHELL="${zsh_path}"
export PATH="/usr/local/bin:/usr/local/cargo/bin:\$HOME/.local/bin:\$HOME/.bun/bin:\$PATH"
export XDG_RUNTIME_DIR="/run/user/0"
export NVM_DIR="\$HOME/.nvm"
if [ -s /etc/profile.d/nvm.sh ]; then
  . /etc/profile.d/nvm.sh
fi

alias code='/usr/local/bin/code'
alias c='code'
alias g='git'

autoload -Uz colors vcs_info
colors
setopt PROMPT_SUBST

zstyle ':vcs_info:*' enable git
zstyle ':vcs_info:*' check-for-changes true
zstyle ':vcs_info:git*:*' formats '%F{yellow}git:%b%f'
zstyle ':vcs_info:git*:*' actionformats '%F{yellow}git:%b*%f'

precmd() {
  vcs_info
}

PROMPT='%F{cyan}%n%f %F{green}%~%f\${vcs_info_msg_0_:+ \${vcs_info_msg_0_}} %# '
EOF
        if [ -f "${autosuggestions}" ]; then
          cat >> /root/.zshrc <<'EOF'

if [ -f "${autosuggestions}" ]; then
  source "${autosuggestions}"
  bindkey '^ ' autosuggest-accept
fi
EOF
        fi
        cat >> /root/.zshrc <<'EOF'
HISTFILE=~/.zsh_history
setopt HIST_IGNORE_DUPS HIST_VERIFY
EOF
        cat > /root/.zprofile <<'EOF'
[[ -f ~/.zshrc ]] && source ~/.zshrc
EOF
        mkdir -p /etc/profile.d
        cat <<'EOF' > /etc/profile.d/cmux-paths.sh
export RUSTUP_HOME=/usr/local/rustup
export CARGO_HOME=/usr/local/cargo
export PATH="/usr/local/bin:/usr/local/cargo/bin:$HOME/.local/bin:$HOME/.bun/bin:$PATH"
EOF
        if ! grep -q "alias g='git'" /root/.bashrc 2>/dev/null; then
          echo "alias g='git'" >> /root/.bashrc
        fi
        """
    )
    # Install cmux-env.sh from repo (separate command to allow f-string substitution)
    install_cmd = f"install -Dm0644 {repo}/configs/profile.d/cmux-env.sh /etc/profile.d/cmux-env.sh"
    await ctx.run("configure-zsh", cmd + "\n" + install_cmd)


@registry.task(
    name="configure-openbox",
    deps=("upload-repo", "install-base-packages"),
    description="Install openbox configuration for desktop menu",
)
async def task_configure_openbox(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -eux
        mkdir -p /root/.config/openbox
        install -Dm0644 {repo}/configs/openbox/menu.xml /root/.config/openbox/menu.xml
        """
    )
    await ctx.run("configure-openbox", cmd)


@registry.task(
    name="install-service-scripts",
    deps=("upload-repo", "install-base-packages"),
    description="Install VNC startup script (includes Chrome DevTools)",
)
@update_registry.task(
    name="install-service-scripts",
    deps=("upload-repo",),  # base packages already installed
    description="Install VNC startup script (includes Chrome DevTools)",
)
async def task_install_service_scripts(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -d /usr/local/lib/cmux
        install -m 0755 {repo}/configs/systemd/bin/cmux-start-chrome /usr/local/lib/cmux/cmux-start-chrome
        install -m 0755 {repo}/configs/systemd/bin/cmux-manage-dockerd /usr/local/lib/cmux/cmux-manage-dockerd
        install -m 0755 {repo}/configs/systemd/bin/cmux-stop-dockerd /usr/local/lib/cmux/cmux-stop-dockerd
        install -m 0755 {repo}/configs/systemd/bin/cmux-configure-memory /usr/local/sbin/cmux-configure-memory
        """
    )
    await ctx.run("install-service-scripts", cmd)


@registry.task(
    name="build-cdp-proxy",
    deps=("install-service-scripts", "install-go-toolchain"),
    description="Build and install Chrome DevTools and VNC proxy binaries",
)
@update_registry.task(
    name="build-cdp-proxy",
    deps=("install-service-scripts",),  # Go toolchain already installed
    description="Build and install Chrome DevTools and VNC proxy binaries",
)
async def task_build_cdp_proxy(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/go/bin:${{PATH}}"
        install -d /usr/local/lib/cmux
        cd {repo}/scripts/cdp-proxy
        go build -trimpath -o /usr/local/lib/cmux/{CDP_PROXY_BINARY_NAME} .
        if [ ! -x /usr/local/lib/cmux/{CDP_PROXY_BINARY_NAME} ]; then
          echo "Failed to build {CDP_PROXY_BINARY_NAME}" >&2
          exit 1
        fi
        cd {repo}/scripts/vnc-proxy
        go build -trimpath -o /usr/local/lib/cmux/{VNC_PROXY_BINARY_NAME} .
        if [ ! -x /usr/local/lib/cmux/{VNC_PROXY_BINARY_NAME} ]; then
          echo "Failed to build {VNC_PROXY_BINARY_NAME}" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-cdp-proxy", cmd)


@registry.task(
    name="build-execd",
    deps=("install-service-scripts", "install-go-toolchain"),
    description="Build cmux-execd HTTP exec daemon",
)
@update_registry.task(
    name="build-execd",
    deps=("install-service-scripts",),  # Go toolchain already installed
    description="Build cmux-execd HTTP exec daemon",
)
async def task_build_execd(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/go/bin:${{PATH}}"
        install -d /usr/local/bin
        cd {repo}/scripts/execd
        # Force rebuild by touching source files (git apply doesn't always update timestamps)
        touch main.go
        go build -trimpath -o /usr/local/bin/{EXECD_BINARY_NAME} .
        if [ ! -x /usr/local/bin/{EXECD_BINARY_NAME} ]; then
          echo "Failed to build {EXECD_BINARY_NAME}" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-execd", cmd)


@registry.task(
    name="build-worker-daemon",
    deps=("install-service-scripts", "install-go-toolchain"),
    description="Build Go worker-daemon for SSH/PTY proxy (port 39377)",
)
@update_registry.task(
    name="build-worker-daemon",
    deps=("install-service-scripts",),  # Go toolchain already installed
    description="Build Go worker-daemon for SSH/PTY proxy (port 39377)",
)
async def task_build_worker_daemon(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/go/bin:${{PATH}}"
        install -d /usr/local/bin
        cd {repo}/packages/cloudrouter
        # Force rebuild by touching source files (git apply doesn't always update timestamps)
        touch cmd/worker/main.go
        CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /usr/local/bin/worker-daemon ./cmd/worker
        if [ ! -x /usr/local/bin/worker-daemon ]; then
          echo "Failed to build worker-daemon" >&2
          exit 1
        fi
        """
    )
    await ctx.run("build-worker-daemon", cmd)


@registry.task(
    name="restart-execd-early",
    deps=("build-execd",),
    description="Restart execd service to use newly-built binary for long-running tasks",
)
@update_registry.task(
    name="restart-execd-early",
    deps=("build-execd",),
    description="Restart execd service to use newly-built binary for long-running tasks",
)
async def task_restart_execd_early(ctx: PveTaskContext) -> None:
    """Restart execd to use the newly-built binary with streaming fixes.

    This must run after build-execd and before any long-running tasks (like
    build-rust-binaries) to ensure they use the fixed execd that properly
    streams output to completion.

    We use nohup with a small delay because the current HTTP request is being
    handled by the old execd - we need to let the restart happen after this
    request returns.
    """
    import asyncio

    await ctx.run(
        "restart-execd-early",
        "nohup sh -c 'sleep 0.5 && systemctl restart cmux-execd.service' >/dev/null 2>&1 &",
    )
    # Wait for the background restart to complete
    await asyncio.sleep(2)


@registry.task(
    name="build-worker",
    deps=("install-repo-dependencies",),
    description="Build worker bundle and install helper scripts",
)
@update_registry.task(
    name="build-worker",
    deps=("install-repo-dependencies",),
    description="Build worker bundle and install helper scripts",
)
async def task_build_worker(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export PATH="/usr/local/bin:$PATH"
        cd {repo}
        bun build ./apps/worker/src/index.ts \\
          --target node \\
          --outdir ./apps/worker/build \\
          --external @cmux/convex \\
          --external 'node:*'
        if [ ! -f ./apps/worker/build/index.js ]; then
          echo "Worker build output missing at ./apps/worker/build/index.js" >&2
          exit 1
        fi
        install -d ./apps/worker/build/node_modules
        # Install express-compatible path-to-regexp 0.1.x explicitly
        # bun hoisting can place dependencies differently, so we install directly
        cd ./apps/worker/build/node_modules
        # npm pack with retry logic for network resilience
        for i in 1 2 3; do
          if npm pack path-to-regexp@0.1.12 --silent; then
            break
          fi
          echo "npm pack attempt $i failed, retrying in $((i * 2))s..."
          sleep $((i * 2))
          if [ $i -eq 3 ]; then
            echo "npm pack failed after 3 attempts" >&2
            exit 1
          fi
        done
        tar -xzf path-to-regexp-0.1.12.tgz
        mv package path-to-regexp
        rm -f path-to-regexp-0.1.12.tgz
        cd {repo}
        install -d /builtins
        cat <<'JSON' > /builtins/package.json
{{"name":"builtins","type":"module","version":"1.0.0"}}
JSON
        rm -rf /builtins/build
        cp -r ./apps/worker/build /builtins/build
        install -Dm0755 ./apps/worker/wait-for-docker.sh /usr/local/bin/wait-for-docker.sh
        """
    )
    await ctx.run("build-worker", cmd)


@registry.task(
    name="build-rust-binaries",
    deps=("upload-repo", "install-rust-toolchain", "restart-execd-early"),
    description="Build Rust binaries with a shared target dir",
)
@update_registry.task(
    name="build-rust-binaries",
    deps=("upload-repo", "restart-execd-early"),  # Rust toolchain already installed
    description="Build Rust binaries with a shared target dir",
)
async def task_build_rust_binaries(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        set -euo pipefail
        export RUSTUP_HOME=/usr/local/rustup
        export CARGO_HOME=/usr/local/cargo
        export CARGO_TARGET_DIR={repo}/target
        export PATH="${{CARGO_HOME}}/bin:$PATH"
        export CARGO_BUILD_JOBS="$(nproc)"
        cargo build --locked --release --manifest-path {repo}/crates/cmux-env/Cargo.toml
        cargo build --locked --release --manifest-path {repo}/crates/cmux-proxy/Cargo.toml
        cargo build --locked --release --manifest-path {repo}/crates/cmux-pty/Cargo.toml
        """
    )
    await ctx.run("build-rust-binaries", cmd, timeout=60 * 30)


@registry.task(
    name="link-rust-binaries",
    deps=("build-rust-binaries",),
    description="Symlink built Rust binaries into /usr/local/bin",
)
@update_registry.task(
    name="link-rust-binaries",
    deps=("build-rust-binaries",),
    description="Symlink built Rust binaries into /usr/local/bin",
)
async def task_link_rust_binaries(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -m 0755 {repo}/target/release/envd /usr/local/bin/envd
        install -m 0755 {repo}/target/release/envctl /usr/local/bin/envctl
        install -m 0755 {repo}/target/release/cmux-proxy /usr/local/bin/cmux-proxy
        install -m 0755 {repo}/target/release/cmux-pty /usr/local/bin/cmux-pty
        """
    )
    await ctx.run("link-rust-binaries", cmd)


@registry.task(
    name="install-systemd-units",
    deps=(
        "upload-repo",
        "install-ide-extensions",
        "install-service-scripts",
        "build-worker",
        "build-worker-daemon",
        "build-cdp-proxy",
        "build-execd",
        "link-rust-binaries",
        "configure-zsh",
    ),
    description="Install cmux systemd units and helpers",
)
@update_registry.task(
    name="install-systemd-units",
    deps=(
        "install-ide-extensions",
        "install-service-scripts",
        "build-worker",
        "build-worker-daemon",
        "build-cdp-proxy",
        "build-execd",
        "link-rust-binaries",
    ),
    description="Install cmux systemd units and helpers",
)
async def task_install_systemd_units(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    ide_provider = get_ide_provider()

    if ide_provider == IDE_PROVIDER_CODER:
        ide_service = "cmux-coder.service"
        ide_configure_script = "configure-coder"
        ide_env_file = "ide.env.coder"
    elif ide_provider == IDE_PROVIDER_CMUX_CODE:
        ide_service = "cmux-cmux-code.service"
        ide_configure_script = "configure-cmux-code"
        ide_env_file = "ide.env.cmux-code"
    else:
        ide_service = "cmux-openvscode.service"
        ide_configure_script = "configure-openvscode"
        ide_env_file = "ide.env.openvscode"

    cmd = textwrap.dedent(
        f"""
        set -euo pipefail

        install -d /usr/local/lib/cmux
        install -d /etc/cmux
        install -Dm0644 {repo}/configs/systemd/cmux.target /usr/lib/systemd/system/cmux.target
        install -Dm0644 {repo}/configs/systemd/{ide_service} /usr/lib/systemd/system/cmux-ide.service
        # Remove old Go worker service from base template (conflicts with Node.js worker)
        # The Go worker now uses cmux-worker-daemon.service instead
        rm -f /etc/systemd/system/cmux-worker.service
        rm -f /etc/systemd/system/cmux.target.wants/cmux-worker.service
        install -Dm0644 {repo}/configs/systemd/cmux-worker.service /usr/lib/systemd/system/cmux-worker.service
        # Override Node.js worker port to 39376 for PVE-LXC (Go worker uses 39377)
        sed -i 's/WORKER_PORT=39377/WORKER_PORT=39376/' /usr/lib/systemd/system/cmux-worker.service
        install -Dm0644 {repo}/configs/systemd/cmux-proxy.service /usr/lib/systemd/system/cmux-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-dockerd.service /usr/lib/systemd/system/cmux-dockerd.service
        install -Dm0644 {repo}/configs/systemd/cmux-devtools.service /usr/lib/systemd/system/cmux-devtools.service
        install -Dm0644 {repo}/configs/systemd/cmux-xvfb.service /usr/lib/systemd/system/cmux-xvfb.service
        install -Dm0644 {repo}/configs/systemd/cmux-tigervnc.service /usr/lib/systemd/system/cmux-tigervnc.service
        install -Dm0644 {repo}/configs/systemd/cmux-openbox.service /usr/lib/systemd/system/cmux-openbox.service
        install -Dm0644 {repo}/configs/systemd/cmux-vnc-proxy.service /usr/lib/systemd/system/cmux-vnc-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-cdp-proxy.service /usr/lib/systemd/system/cmux-cdp-proxy.service
        install -Dm0644 {repo}/configs/systemd/cmux-pty.service /usr/lib/systemd/system/cmux-pty.service
        install -Dm0644 {repo}/configs/systemd/cmux-execd.service /usr/lib/systemd/system/cmux-execd.service
        install -Dm0644 {repo}/configs/systemd/cmux-token-generator.service /usr/lib/systemd/system/cmux-token-generator.service
        install -Dm0755 {repo}/configs/systemd/bin/cmux-token-init /usr/local/bin/cmux-token-init
        rm -f /etc/systemd/system/cmux-worker-daemon.service
        rm -f /etc/systemd/system/cmux.target.wants/cmux-worker-daemon.service
        rm -f /etc/systemd/system/multi-user.target.wants/cmux-worker-daemon.service
        install -Dm0644 {repo}/configs/systemd/cmux-worker-daemon.service /usr/lib/systemd/system/cmux-worker-daemon.service
        install -Dm0644 {repo}/configs/systemd/cmux-memory-setup.service /usr/lib/systemd/system/cmux-memory-setup.service
        install -Dm0755 {repo}/configs/systemd/bin/{ide_configure_script} /usr/local/lib/cmux/{ide_configure_script}
        install -Dm0644 {repo}/configs/systemd/{ide_env_file} /etc/cmux/ide.env
        install -Dm0755 {repo}/configs/systemd/bin/code /usr/local/bin/code
        touch /usr/local/lib/cmux/dockerd.flag
        mkdir -p /var/log/cmux
        mkdir -p /root/workspace
        mkdir -p /etc/systemd/system/multi-user.target.wants
        mkdir -p /etc/systemd/system/cmux.target.wants
        mkdir -p /etc/systemd/system/swap.target.wants
        ln -sf /usr/lib/systemd/system/cmux.target /etc/systemd/system/multi-user.target.wants/cmux.target
        ln -sf /usr/lib/systemd/system/cmux-ide.service /etc/systemd/system/cmux.target.wants/cmux-ide.service
        ln -sf /usr/lib/systemd/system/cmux-worker.service /etc/systemd/system/cmux.target.wants/cmux-worker.service
        ln -sf /usr/lib/systemd/system/cmux-proxy.service /etc/systemd/system/cmux.target.wants/cmux-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-dockerd.service /etc/systemd/system/cmux.target.wants/cmux-dockerd.service
        ln -sf /usr/lib/systemd/system/cmux-devtools.service /etc/systemd/system/cmux.target.wants/cmux-devtools.service
        ln -sf /usr/lib/systemd/system/cmux-tigervnc.service /etc/systemd/system/cmux.target.wants/cmux-tigervnc.service
        ln -sf /usr/lib/systemd/system/cmux-openbox.service /etc/systemd/system/cmux.target.wants/cmux-openbox.service
        ln -sf /usr/lib/systemd/system/cmux-vnc-proxy.service /etc/systemd/system/cmux.target.wants/cmux-vnc-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-cdp-proxy.service /etc/systemd/system/cmux.target.wants/cmux-cdp-proxy.service
        ln -sf /usr/lib/systemd/system/cmux-pty.service /etc/systemd/system/cmux.target.wants/cmux-pty.service
        ln -sf /usr/lib/systemd/system/cmux-execd.service /etc/systemd/system/cmux.target.wants/cmux-execd.service
        ln -sf /usr/lib/systemd/system/cmux-token-generator.service /etc/systemd/system/multi-user.target.wants/cmux-token-generator.service
        ln -sf /usr/lib/systemd/system/cmux-worker-daemon.service /etc/systemd/system/cmux.target.wants/cmux-worker-daemon.service
        ln -sf /usr/lib/systemd/system/cmux-memory-setup.service /etc/systemd/system/multi-user.target.wants/cmux-memory-setup.service
        ln -sf /usr/lib/systemd/system/cmux-memory-setup.service /etc/systemd/system/swap.target.wants/cmux-memory-setup.service
        {{ systemctl daemon-reload || true; }}
        {{ systemctl enable cmux.target || true; }}
        chown root:root /usr/local
        chown root:root /usr/local/bin
        chmod 0755 /usr/local
        chmod 0755 /usr/local/bin
        {{ systemctl restart ssh || true; }}
        {{ systemctl is-active --quiet ssh || true; }}
        {{ systemctl start cmux.target 2>/dev/null || true; }}
        """
    )
    await ctx.run("install-systemd-units", cmd)


@registry.task(
    name="install-prompt-wrapper",
    deps=("upload-repo",),
    description="Install prompt-wrapper helper",
)
@update_registry.task(
    name="install-prompt-wrapper",
    deps=("upload-repo",),
    description="Install prompt-wrapper helper",
)
async def task_install_prompt_wrapper(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -m 0755 {repo}/prompt-wrapper.sh /usr/local/bin/prompt-wrapper
        """
    )
    await ctx.run("install-prompt-wrapper", cmd)


@registry.task(
    name="install-tmux-conf",
    deps=("upload-repo",),
    description="Install tmux configuration",
)
@update_registry.task(
    name="install-tmux-conf",
    deps=("upload-repo",),
    description="Install tmux configuration",
)
async def task_install_tmux_conf(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -Dm0644 {repo}/configs/tmux.conf /etc/tmux.conf
        """
    )
    await ctx.run("install-tmux-conf", cmd)


@registry.task(
    name="install-collect-scripts",
    deps=("upload-repo",),
    description="Install worker helper scripts",
)
@update_registry.task(
    name="install-collect-scripts",
    deps=("upload-repo",),
    description="Install worker helper scripts",
)
async def task_install_collect_scripts(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    cmd = textwrap.dedent(
        f"""
        install -Dm0755 {repo}/apps/worker/scripts/collect-relevant-diff.sh /usr/local/bin/cmux-collect-relevant-diff.sh
        install -Dm0755 {repo}/apps/worker/scripts/collect-crown-diff.sh /usr/local/bin/cmux-collect-crown-diff.sh
        """
    )
    await ctx.run("install-collect-scripts", cmd)


@registry.task(
    name="configure-envctl",
    deps=("link-rust-binaries", "configure-zsh"),
    description="Configure envctl defaults",
)
@update_registry.task(
    name="configure-envctl",
    deps=("link-rust-binaries",),
    description="Configure envctl defaults",
)
async def task_configure_envctl(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -eux
        envctl --version
        envctl install-hook bash
        envctl install-hook zsh
        cat <<'PROFILE' > /root/.profile
if [ -n "${ZSH_VERSION:-}" ]; then
  if [ -f ~/.zshrc ]; then
    . ~/.zshrc
  fi
elif [ -n "${BASH_VERSION:-}" ]; then
  if [ -f ~/.bashrc ]; then
    . ~/.bashrc
  fi
elif [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi
PROFILE
        cat <<'PROFILE' > /root/.bash_profile
if [ -n "${ZSH_VERSION:-}" ]; then
  if [ -f ~/.zshrc ]; then
    . ~/.zshrc
  fi
elif [ -n "${BASH_VERSION:-}" ]; then
  if [ -f ~/.bashrc ]; then
    . ~/.bashrc
  fi
elif [ -f ~/.bashrc ]; then
  . ~/.bashrc
fi
PROFILE
        mkdir -p /run/user/0
        chmod 700 /run/user/0
        if ! grep -q 'XDG_RUNTIME_DIR=/run/user/0' /root/.bashrc 2>/dev/null; then
          echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.bashrc
        fi
        if ! grep -q 'cmux-paths.sh' /root/.bashrc 2>/dev/null; then
          echo '[ -f /etc/profile.d/cmux-paths.sh ] && . /etc/profile.d/cmux-paths.sh' >> /root/.bashrc
        fi
        if ! grep -q 'nvm.sh' /root/.bashrc 2>/dev/null; then
          echo '[ -f /etc/profile.d/nvm.sh ] && . /etc/profile.d/nvm.sh' >> /root/.bashrc
        fi
        if ! grep -q 'XDG_RUNTIME_DIR=/run/user/0' /root/.zshrc 2>/dev/null; then
          echo 'export XDG_RUNTIME_DIR=/run/user/0' >> /root/.zshrc
        fi
        """
    )
    await ctx.run("configure-envctl", cmd)


@registry.task(
    name="cleanup-build-artifacts",
    deps=(
        "configure-envctl",
        "configure-openbox",
        "install-prompt-wrapper",
        "install-tmux-conf",
        "install-collect-scripts",
        "setup-claude-oauth-wrappers",
        "install-systemd-units",
    ),
    description="Remove repository upload and toolchain caches prior to final validation",
)
@update_registry.task(
    name="cleanup-build-artifacts",
    deps=(
        "configure-envctl",
        "install-prompt-wrapper",
        "install-tmux-conf",
        "install-collect-scripts",
        "setup-claude-oauth-wrappers",
        "install-systemd-units",
    ),
    description="Remove repository upload and toolchain caches prior to final validation",
)
async def task_cleanup_build_artifacts(ctx: PveTaskContext) -> None:
    repo = shlex.quote(ctx.remote_repo_root)
    tar_path = shlex.quote(ctx.remote_repo_tar)
    cleanup_script = textwrap.dedent(
        f"""
        set -euo pipefail
        rm -rf {repo}
        rm -f {tar_path}
        if [ -d /usr/local/cargo ]; then
            rm -rf /usr/local/cargo/registry
            rm -rf /usr/local/cargo/git
            install -d -m 0755 /usr/local/cargo/registry
            install -d -m 0755 /usr/local/cargo/git
        fi
        if [ -d /usr/local/rustup ]; then
            rm -rf /usr/local/rustup/tmp
            rm -rf /usr/local/rustup/downloads
            install -d -m 0755 /usr/local/rustup/tmp
            install -d -m 0755 /usr/local/rustup/downloads
        fi
        if [ -d /root/.cache ]; then
            rm -rf /root/.cache/go-build
            rm -rf /root/.cache/pip
            rm -rf /root/.cache/uv
            rm -rf /root/.cache/bun
        fi
        if [ -d /root/.bun ]; then
            rm -rf /root/.bun/install/cache
        fi
        rm -rf /root/.npm
        rm -rf /root/.pnpm-store
        rm -rf /root/go
        rm -rf /usr/local/go-workspace/bin
        rm -rf /usr/local/go-workspace/pkg/mod
        rm -rf /usr/local/go-workspace/pkg/sumdb
        rm -rf /usr/local/go-cache
        install -d -m 0755 /root/.cache
        install -d -m 0755 /root/.cache/go-build
        install -d -m 0755 /root/.cache/pip
        install -d -m 0755 /root/.cache/uv
        install -d -m 0755 /root/.cache/bun
        install -d -m 0755 /usr/local/go-workspace
        install -d -m 0755 /usr/local/go-workspace/bin
        install -d -m 0755 /usr/local/go-workspace/pkg/mod
        install -d -m 0755 /usr/local/go-workspace/pkg/sumdb
        install -d -m 0755 /usr/local/go-cache
        if [ -d /var/cache/apt ]; then
            rm -rf /var/cache/apt/archives/*.deb
            rm -rf /var/cache/apt/archives/partial
            install -d -m 0755 /var/cache/apt/archives/partial
        fi
        if [ -d /var/lib/apt/lists ]; then
            find /var/lib/apt/lists -mindepth 1 -maxdepth 1 -type f -delete
            rm -rf /var/lib/apt/lists/partial
            install -d -m 0755 /var/lib/apt/lists/partial
        fi
        # Stop Chrome before cleaning profile locks to prevent it from recreating them
        # Chrome exits with code 21 if it sees stale lock files from snapshot
        systemctl stop cmux-devtools.service 2>/dev/null || true
        # Use killall instead of pkill -f to avoid matching the bash script itself
        # (pkill -f chrome would match this script since it contains "chrome" in cmd line)
        killall -9 google-chrome chrome chromium chromium-browser 2>/dev/null || true
        sleep 1
        # Clean Chrome profile locks to prevent crash-loop on fresh clones
        rm -f /root/.config/chrome/SingletonLock
        rm -f /root/.config/chrome/SingletonCookie
        rm -f /root/.config/chrome/SingletonSocket
        rm -f /root/.config/google-chrome/SingletonLock
        rm -f /root/.config/google-chrome/SingletonCookie
        rm -f /root/.config/google-chrome/SingletonSocket
        # Also clean any temp socket directories Chrome may have created
        rm -rf /tmp/.com.google.Chrome.*
        """
    ).strip()
    await ctx.run("cleanup-disk-artifacts", cleanup_script)


# ---------------------------------------------------------------------------
# Verification tasks
# ---------------------------------------------------------------------------


@registry.task(
    name="check-cargo",
    deps=("install-rust-toolchain", "cleanup-build-artifacts"),
    description="Verify cargo is installed and working",
)
async def task_check_cargo(ctx: PveTaskContext) -> None:
    await ctx.run("check-cargo", "PATH=/usr/local/cargo/bin:$PATH cargo --version")


@registry.task(
    name="check-node",
    deps=("install-node-runtime", "cleanup-build-artifacts"),
    description="Verify node is installed and working",
)
async def task_check_node(ctx: PveTaskContext) -> None:
    await ctx.run("check-node", "node --version")


@registry.task(
    name="check-bun",
    deps=("install-bun", "cleanup-build-artifacts"),
    description="Verify bun is installed and working",
)
async def task_check_bun(ctx: PveTaskContext) -> None:
    await ctx.run("check-bun", "bun --version && bunx --version")


@registry.task(
    name="check-uv",
    deps=("install-uv-python", "cleanup-build-artifacts"),
    description="Verify uv is installed and working",
)
async def task_check_uv(ctx: PveTaskContext) -> None:
    await ctx.run("check-uv", "uv --version && uvx --version")


@registry.task(
    name="check-gh",
    deps=("install-base-packages", "cleanup-build-artifacts"),
    description="Verify GitHub CLI is installed and working",
)
async def task_check_gh(ctx: PveTaskContext) -> None:
    await ctx.run("check-gh", "gh --version")


@registry.task(
    name="check-envctl",
    deps=("configure-envctl", "cleanup-build-artifacts"),
    description="Verify envctl is installed and working",
)
async def task_check_envctl(ctx: PveTaskContext) -> None:
    await ctx.run("check-envctl", "envctl --version && command -v envd")


@registry.task(
    name="check-systemd-services",
    deps=("install-systemd-units", "cleanup-build-artifacts"),
    description="Verify systemd services are configured",
)
async def task_check_systemd_services(ctx: PveTaskContext) -> None:
    cmd = textwrap.dedent(
        """
        set -euo pipefail
        echo "Checking cmux.target..."
        systemctl list-unit-files cmux.target
        echo "Checking installed services..."
        for svc in cmux-ide cmux-worker cmux-worker-daemon cmux-token-generator cmux-proxy cmux-pty cmux-execd; do
          if [ -f "/usr/lib/systemd/system/${svc}.service" ]; then
            echo "  ${svc}.service: installed"
          else
            echo "  ${svc}.service: MISSING" >&2
          fi
        done
        """
    )
    await ctx.run("check-systemd-services", cmd)


# ---------------------------------------------------------------------------
# Task graph execution for PVE
# ---------------------------------------------------------------------------


import time


async def _run_task_with_timing(ctx: PveTaskContext, task: t.Any) -> None:
    """Run a task and record timing."""
    start = time.perf_counter()
    await task.func(ctx)
    duration = time.perf_counter() - start
    ctx.timings.add(f"task:{task.name}", duration)
    ctx.console.info(f"[OK] {task.name} completed in {duration:.2f}s")


async def run_pve_task_graph(registry: TaskRegistry, ctx: PveTaskContext) -> None:
    """Execute all tasks in the registry respecting dependencies."""
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
            ctx.console.info(f"-> starting task {task.name}")

        start = time.perf_counter()
        await asyncio.gather(
            *(_run_task_with_timing(ctx, task) for task in tasks_to_run)
        )
        duration = time.perf_counter() - start
        layer_label = f"layer:{'+'.join(ready)}"
        ctx.timings.add(layer_label, duration)
        ctx.console.info(
            f"[OK] Layer completed in {duration:.2f}s (tasks: {', '.join(ready)})"
        )

        for task in tasks_to_run:
            completed.add(task.name)
            remaining.pop(task.name, None)


# ---------------------------------------------------------------------------
# Main provisioning flow
# ---------------------------------------------------------------------------


async def wait_for_container_ready(
    vmid: int,
    client: PveLxcClient,
    *,
    console: Console,
    timeout: int = 180,
    require_http_exec: bool = True,
) -> None:
    """Wait for container to be running and ready for commands.

    Uses HTTP exec (cmux-execd) when cf_domain is configured and require_http_exec=True,
    otherwise falls back to checking container status via PVE API only.

    Args:
        vmid: Container VMID to wait for
        client: PVE client instance
        console: Console for logging
        timeout: Max seconds to wait
        require_http_exec: If True and cf_domain is set, wait for cmux-execd to be ready.
            Should typically be True since base templates have cmux-execd installed.
    """
    console.info(f"Waiting for container {vmid} to be ready...")

    elapsed = 0
    container_running = False
    while elapsed < timeout:
        status = await client.aget_lxc_status(vmid)
        if status.get("status") == "running":
            if not container_running:
                container_running = True
                console.info(f"Container {vmid} is running, waiting for services...")

            # Try HTTP exec first if cf_domain is configured AND require_http_exec is True
            if client.cf_domain and require_http_exec:
                try:
                    result = await client.ahttp_exec(
                        vmid,
                        "echo ready",
                        timeout=10,
                        check=False,
                    )
                    if result is not None and result.returncode == 0 and "ready" in result.stdout:
                        console.info(f"Container {vmid} is ready (HTTP exec)")
                        return
                except Exception:
                    pass
                # HTTP exec not ready yet, keep waiting
                if elapsed > 0 and elapsed % 30 == 0:
                    console.info(f"Still waiting for cmux-execd on container {vmid}... ({elapsed}s)")
            else:
                # No cf_domain configured or require_http_exec=False
                # Just verify container is running via API
                console.info(f"Container {vmid} is running (API verified)")
                return
        await asyncio.sleep(2)
        elapsed += 2

    raise TimeoutError(f"Container {vmid} did not become ready within {timeout}s")


@dataclass
class ToolchainStatus:
    """Status of required toolchains in the container."""
    has_go: bool = False
    has_rust: bool = False
    has_bun: bool = False
    has_node: bool = False

    @property
    def all_present(self) -> bool:
        return self.has_go and self.has_rust and self.has_bun and self.has_node

    @property
    def missing(self) -> list[str]:
        missing = []
        if not self.has_go:
            missing.append("go")
        if not self.has_rust:
            missing.append("rust")
        if not self.has_bun:
            missing.append("bun")
        if not self.has_node:
            missing.append("node")
        return missing


async def detect_toolchains(
    vmid: int,
    client: PveLxcClient,
    console: Console,
) -> ToolchainStatus:
    """Detect which toolchains are installed in the container.

    Uses HTTP exec (cmux-execd) when available, falls back to SSH+pct exec.
    """
    status = ToolchainStatus()

    # Check Go
    try:
        result = await client.aexec_in_container(vmid, "which go", timeout=10, check=False)
        status.has_go = result.returncode == 0
    except Exception:
        pass

    # Check Rust
    try:
        result = await client.aexec_in_container(vmid, "which cargo", timeout=10, check=False)
        status.has_rust = result.returncode == 0
    except Exception:
        pass

    # Check Bun
    try:
        result = await client.aexec_in_container(vmid, "which bun", timeout=10, check=False)
        status.has_bun = result.returncode == 0
    except Exception:
        pass

    # Check Node
    try:
        result = await client.aexec_in_container(vmid, "which node", timeout=10, check=False)
        status.has_node = result.returncode == 0
    except Exception:
        pass

    return status


def create_dynamic_update_registry(toolchain_status: ToolchainStatus) -> TaskRegistry:
    """Create a dynamic task registry for update mode based on detected toolchains.

    If toolchains are missing, we add the installation tasks to the registry.
    This allows update mode to work on older templates that don't have all toolchains.
    """
    dynamic_registry = TaskRegistry()

    # Always include these base tasks from update_registry
    # We'll copy tasks from update_registry and optionally add toolchain installation

    # If Go is missing, we need to add install-go-toolchain task
    # If Rust is missing, we need to add install-rust-toolchain task
    # etc.

    # For now, if any toolchain is missing, use the full registry instead
    # This is simpler and ensures all dependencies are met
    if not toolchain_status.all_present:
        return registry  # Use full registry for templates missing toolchains

    return update_registry  # Use optimized update registry


async def update_existing_template(
    args: argparse.Namespace,
    *,
    console: Console,
    client: PveLxcClient,
    repo_root: Path,
) -> int:
    """Update an existing template container by cloning, updating, and converting to new template.

    This skips heavy dependency installation (apt, rust, go, node, etc.) and only
    runs tasks that rebuild binaries and update configs from the repo.

    Flow:
    1. Check if source VMID is a template (via config template=1)
    2. If template, linked clone to new auto-allocated VMID (full clone as fallback)
    3. Start the clone and run update tasks
    4. Stop and convert to new template
    5. Return new template VMID

    Returns the new template VMID (or original VMID if it was a regular container).
    """
    source_vmid = args.update_vmid
    console.always(f"\n=== Update mode: source container {source_vmid} ===")
    timings = TimingsCollector()

    node = await client.aget_node()

    # Check if container exists
    try:
        config = await client.aget_lxc_config(source_vmid, node)
        console.info(f"Container {source_vmid} config loaded")
    except Exception as e:
        console.always(f"ERROR: Container {source_vmid} not found: {e}")
        sys.exit(1)

    # Check if source is a template (template=1 in config)
    is_template = config.get("template", 0) == 1
    console.info(f"Container {source_vmid} is_template: {is_template}")

    if is_template:
        # Clone from template to new VMID (starting from CLONE_BASE_VMID)
        new_vmid = await client.afind_next_vmid(node, start=CLONE_BASE_VMID)
        hostname = _generate_instance_id()

        # Try linked clone first (faster), fall back to full clone if it fails
        try:
            console.always(f"Source {source_vmid} is a template, linked-cloning to new container {new_vmid}...")
            upid = await client.aclone_lxc(
                source_vmid,
                new_vmid,
                hostname=hostname,
                full=False,  # Linked clone (fast)
                node=node,
            )
            await client.await_task(upid, timeout=300, node=node)
            console.info(f"Linked clone complete: {source_vmid} -> {new_vmid}")
        except Exception as e:
            console.always(f"Linked clone failed ({e}), falling back to full clone...")
            upid = await client.aclone_lxc(
                source_vmid,
                new_vmid,
                hostname=hostname,
                full=True,  # Full clone (fallback)
                node=node,
            )
            await client.await_task(upid, timeout=600, node=node)
            console.info(f"Full clone complete: {source_vmid} -> {new_vmid}")

        work_vmid = new_vmid
    else:
        # Source is a regular container, work on it directly
        work_vmid = source_vmid
        hostname = config.get("hostname")
        console.info(f"Container {source_vmid} is not a template, updating directly")

    # Start the container
    status = await client.aget_lxc_status(work_vmid, node)
    if status.get("status") != "running":
        console.info(f"Starting container {work_vmid}...")
        upid = await client.astart_lxc(work_vmid, node)
        await client.await_task(upid, timeout=120, node=node)
        # Base templates created with pve-lxc-setup.sh have cmux-execd installed,
        # so we wait for HTTP exec to be ready before running provisioning tasks
        await wait_for_container_ready(work_vmid, client, console=console, require_http_exec=True)
    else:
        console.info(f"Container {work_vmid} is already running")

    # Detect which toolchains are installed
    console.always("\nDetecting installed toolchains...")
    toolchain_status = await detect_toolchains(work_vmid, client, console)

    if toolchain_status.all_present:
        console.always("All toolchains present - using optimized update registry")
        active_registry = update_registry
        registry_name = "Update Mode"
    else:
        missing = ", ".join(toolchain_status.missing)
        console.always(f"Missing toolchains: {missing} - using full registry to install them")
        active_registry = registry
        registry_name = "Full Build"

    # Create task context
    ctx = PveTaskContext(
        vmid=work_vmid,
        client=client,
        repo_root=repo_root,
        remote_repo_root="/cmux",
        remote_repo_tar="/tmp/cmux-repo.tar",
        console=console,
        timings=timings,
    )

    # Run task graph (uses detected registry)
    console.always(f"\nRunning {registry_name} tasks...")
    await run_pve_task_graph(active_registry, ctx)

    graph = format_dependency_graph(active_registry)
    if graph:
        console.always(f"\n{registry_name} Dependency Graph")
        for line in graph.splitlines():
            console.always(line)

    summary = timings.summary()
    if summary:
        console.always("\nTiming Summary")
        for line in summary:
            console.always(line)

    # Verify critical artifacts exist before converting to template
    console.info("Verifying critical build artifacts...")
    await _verify_template_artifacts(work_vmid, client, console)

    # Gracefully shutdown container before converting to template
    console.info(f"Shutting down container {work_vmid} for template conversion...")
    upid = await client.ashutdown_lxc(work_vmid, node)
    await client.await_task(upid, timeout=120, node=node)

    # Convert to template
    console.info(f"Converting container {work_vmid} to template...")
    await client.aconvert_to_template(work_vmid, node)

    console.always(f"\n=== Update complete: new template VMID {work_vmid} ===")

    # Update manifest with new template version
    manifest = _load_manifest()
    captured_at = _iso_timestamp()
    snapshot_id = _generate_snapshot_id()

    # Find the preset for the source VMID
    preset_entry = _find_preset_for_vmid(manifest, source_vmid)
    preset_id = preset_entry.get("presetId") if preset_entry else None
    description = _build_template_description(
        snapshot_id=snapshot_id,
        preset_id=preset_id,
        captured_at=captured_at,
        source_vmid=source_vmid,
        hostname=hostname if isinstance(hostname, str) else None,
    )
    tags = _build_template_tags(preset_id)
    await client.aset_lxc_config(
        work_vmid,
        node=node,
        description=description,
        tags=tags,
    )

    if preset_entry:
        _add_version_to_preset(preset_entry, work_vmid, snapshot_id, captured_at)
        manifest["updatedAt"] = captured_at
        manifest["node"] = node
        _write_manifest(manifest)
        console.always(f"\nManifest updated: {PVE_SNAPSHOT_MANIFEST_PATH}")
        console.always(f"  Preset: {preset_entry.get('presetId')} ({preset_entry.get('label')})")
        console.always(f"  New version added with template VMID {work_vmid}")
        console.always(f"  Snapshot ID: {snapshot_id}")
    else:
        console.always(f"\nWARNING: Source VMID {source_vmid} not found in manifest")
        console.always(f"  Manifest not updated. Manually add template {work_vmid} to the manifest if needed.")

    if is_template:
        console.always(f"\nOld template: {source_vmid}")
        console.always(f"New template: {work_vmid}")
        console.always("\nTo use the new template, clone from it:")
        console.always(f"  pct clone {work_vmid} <new-vmid>")
    else:
        console.always(f"\nContainer {work_vmid} converted to template")

    return work_vmid


async def _verify_template_artifacts(
    vmid: int,
    client: PveLxcClient,
    console: Console,
) -> None:
    """Verify critical build artifacts exist in the container before converting to template.

    Raises RuntimeError if critical artifacts are missing to prevent creating broken templates.
    """
    ide_provider = get_ide_provider()

    # Define critical artifacts that must exist based on IDE provider
    artifacts: list[tuple[str, str]] = []

    if ide_provider == IDE_PROVIDER_CODER:
        artifacts = [
            ("/app/code-server/bin/code-server", "code-server binary"),
            ("/root/.code-server/extensions", "code-server extensions directory"),
        ]
    elif ide_provider == IDE_PROVIDER_CMUX_CODE:
        artifacts = [
            ("/app/cmux-code/bin/code-server-oss", "cmux-code binary"),
            ("/root/.vscode-server-oss/extensions", "VS Code extensions directory"),
        ]
    else:  # openvscode
        artifacts = [
            ("/app/openvscode-server/bin/openvscode-server", "openvscode-server binary"),
            ("/root/.openvscode-server/extensions", "VS Code extensions directory"),
        ]

    # Also check for common critical artifacts regardless of IDE provider
    artifacts.extend([
        ("/root/.nvm/nvm.sh", "Node Version Manager"),
        ("/usr/local/cargo/bin/cargo", "Rust/Cargo"),
        ("/usr/local/go/bin/go", "Go toolchain"),
        ("/root/.bun/bin/bun", "Bun runtime"),
        ("/builtins/build/index.js", "cmux-worker service"),
        ("/usr/local/bin/worker-daemon", "Go worker-daemon (SSH/PTY proxy)"),
        ("/usr/local/bin/cmux-token-init", "Auth token generator script"),
    ])

    # Verify artifacts exist
    missing: list[str] = []
    for path, description in artifacts:
        check_cmd = f"test -e {shlex.quote(path)} && echo exists || echo missing"
        try:
            result = await client.aexec_in_container(vmid, check_cmd, timeout=30, check=False)
            if result.returncode != 0 or "missing" in result.stdout:
                missing.append(f"  - {description}: {path}")
                console.info(f"[verify] MISSING: {description} at {path}")
            else:
                console.info(f"[verify] OK: {description}")
        except Exception as e:
            missing.append(f"  - {description}: {path} (check failed: {e})")
            console.info(f"[verify] ERROR checking {description}: {e}")

    # Check for cmux extension specifically (critical for IDE functionality)
    ext_dir = (
        "/root/.code-server/extensions" if ide_provider == IDE_PROVIDER_CODER
        else "/root/.vscode-server-oss/extensions" if ide_provider == IDE_PROVIDER_CMUX_CODE
        else "/root/.openvscode-server/extensions"
    )
    ext_check_cmd = f"ls {shlex.quote(ext_dir)} 2>/dev/null | grep -q cmux && echo found || echo notfound"
    try:
        result = await client.aexec_in_container(vmid, ext_check_cmd, timeout=30, check=False)
        if "notfound" in result.stdout or result.returncode != 0:
            missing.append(f"  - cmux VS Code extension: not found in {ext_dir}")
            console.info(f"[verify] MISSING: cmux VS Code extension in {ext_dir}")
        else:
            console.info("[verify] OK: cmux VS Code extension")
    except Exception as e:
        missing.append(f"  - cmux VS Code extension: check failed ({e})")
        console.info(f"[verify] ERROR checking cmux extension: {e}")

    if missing:
        error_msg = (
            "Template verification failed - critical artifacts are missing:\n"
            + "\n".join(missing)
            + "\n\nThis indicates the build tasks did not complete successfully. "
            "Refusing to create a broken template."
        )
        raise RuntimeError(error_msg)

    console.info("[verify] All critical artifacts verified successfully")


async def provision_and_create_template(
    args: argparse.Namespace,
    *,
    preset: TemplatePresetPlan,
    console: Console,
    client: PveLxcClient,
    repo_root: Path,
    created_containers: list[int],
    show_dependency_graph: bool,
    source_vmid: int | None = None,
    run_tasks: bool = True,
) -> TemplateRunResult:
    """Provision a container for a preset and convert to template."""
    console.always(f"\n=== Provisioning preset {preset.preset_id} ({preset.label}) ===")
    timings = TimingsCollector()

    # Determine source VMID: use override if provided, else fall back to args
    src_vmid = source_vmid if source_vmid is not None else args.template_vmid

    node = await client.aget_node()
    # Find next available VMID starting from CLONE_BASE_VMID (9000, 9001, etc.)
    new_vmid = await client.afind_next_vmid(node, start=CLONE_BASE_VMID)
    hostname = _generate_instance_id()

    # Try linked clone first (faster), fall back to full clone if it fails
    try:
        console.info(f"Linked-cloning template {src_vmid} to new container {new_vmid}...")
        upid = await client.aclone_lxc(
            src_vmid,
            new_vmid,
            hostname=hostname,
            full=False,  # Linked clone (fast)
            node=node,
        )
        await client.await_task(upid, timeout=300, node=node)
        console.info(f"Linked clone complete: {src_vmid} -> {new_vmid}")
    except Exception as e:
        console.always(f"Linked clone failed ({e}), falling back to full clone...")
        upid = await client.aclone_lxc(
            src_vmid,
            new_vmid,
            hostname=hostname,
            full=True,  # Full clone (fallback)
            node=node,
        )
        await client.await_task(upid, timeout=600, node=node)
        console.info(f"Full clone complete: {src_vmid} -> {new_vmid}")

    created_containers.append(new_vmid)

    # Configure resources
    console.info(f"Configuring container {new_vmid} with {preset.vcpus} cores, {preset.memory_mib}MB RAM...")
    await client.aset_lxc_config(
        new_vmid,
        cores=preset.vcpus,
        memory=preset.memory_mib,
        node=node,
    )

    # Resize disk if needed
    # Get current disk size first to compare (optimization)
    config = await client.aget_lxc_config(new_vmid, node)
    rootfs = config.get("rootfs", "")
    current_size_gb = 0
    if "size=" in rootfs:
        try:
            # format: volume=local-lvm:vm-9000-disk-0,size=8G
            size_part = [p for p in rootfs.split(",") if p.startswith("size=")][0]
            size_str = size_part.split("=")[1]
            if size_str.endswith("G"):
                current_size_gb = float(size_str[:-1])
            elif size_str.endswith("M"):
                current_size_gb = float(size_str[:-1]) / 1024
        except Exception:
            pass

    target_size_gb = preset.disk_size_mib / 1024
    if target_size_gb > current_size_gb:
        console.info(f"Resizing disk for container {new_vmid} to {target_size_gb}GB (current: {current_size_gb}GB)...")
        # Ensure container is stopped/unmounted if needed (PVE handles this for live resize usually,
        # but for initial setup safety we do it before start)
        # Note: resize requires volume to be available. PVE handles online resize too.
        # Since we just cloned it and haven't started it yet, it's safe.
        await client.aresize_lxc_disk(
            new_vmid,
            "rootfs",
            f"{int(target_size_gb)}G",
            node=node,
        )
    else:
        console.info(f"Disk size {current_size_gb}GB is sufficient for target {target_size_gb}GB")

    if run_tasks:
        # Start container
        console.info(f"Starting container {new_vmid}...")
        upid = await client.astart_lxc(new_vmid, node)
        await client.await_task(upid, timeout=120, node=node)

        # Wait for container to be ready
        # Base templates created with pve-lxc-setup.sh have cmux-execd installed,
        # so we wait for HTTP exec to be ready before running provisioning tasks
        await wait_for_container_ready(new_vmid, client, console=console, require_http_exec=True)

        # Create task context
        ctx = PveTaskContext(
            vmid=new_vmid,
            client=client,
            repo_root=repo_root,
            remote_repo_root="/cmux",
            remote_repo_tar="/tmp/cmux-repo.tar",
            console=console,
            timings=timings,
        )

        # Run task graph
        await run_pve_task_graph(registry, ctx)

        if show_dependency_graph:
            graph = format_dependency_graph(registry)
            if graph:
                console.always("\nDependency Graph")
                for line in graph.splitlines():
                    console.always(line)

        summary = timings.summary()
        if summary:
            console.always("\nTiming Summary")
            for line in summary:
                console.always(line)

        # Verify critical artifacts exist before converting to template
        console.info("Verifying critical build artifacts...")
        await _verify_template_artifacts(new_vmid, client, console)

        # Gracefully shutdown container before converting to template
        console.info(f"Shutting down container {new_vmid} for template conversion...")
        upid = await client.ashutdown_lxc(new_vmid, node)
        await client.await_task(upid, timeout=120, node=node)

    # Convert to template (this enables fast linked-clone)
    console.info(f"Converting container {new_vmid} to template...")
    await client.aconvert_to_template(new_vmid, node)

    captured_at = _iso_timestamp()
    snapshot_id = _generate_snapshot_id()
    tags = _build_template_tags(preset.preset_id)
    description = _build_template_description(
        snapshot_id=snapshot_id,
        preset_id=preset.preset_id,
        captured_at=captured_at,
        source_vmid=src_vmid,
        hostname=hostname,
    )
    await client.aset_lxc_config(
        new_vmid,
        node=node,
        description=description,
        tags=tags,
    )

    console.always(f"[{preset.preset_id}] Container {new_vmid} converted to template")

    return TemplateRunResult(
        preset=preset,
        snapshot_id=snapshot_id,
        template_vmid=new_vmid,
        captured_at=captured_at,
        node=node,
    )


async def provision_and_snapshot(args: argparse.Namespace) -> None:
    """Main provisioning flow."""
    # Set IDE provider before running tasks
    set_ide_provider(args.ide_provider)

    console = Console()

    # Validate environment
    api_url = os.environ.get("PVE_API_URL")
    api_token = os.environ.get("PVE_API_TOKEN")

    if not api_url or not api_token:
        console.always("ERROR: PVE_API_URL and PVE_API_TOKEN must be set")
        console.always("")
        console.always("Example:")
        console.always("  export PVE_API_URL=https://pve.example.com:8006")
        console.always("  export PVE_API_TOKEN=root@pam!cmux=your-secret")
        sys.exit(1)

    cf_domain = os.environ.get("PVE_PUBLIC_DOMAIN")

    client = PveLxcClient(
        api_url=api_url,
        api_token=api_token,
        node=os.environ.get("PVE_NODE"),
        ssh_host=os.environ.get("PVE_SSH_HOST"),
        cf_domain=cf_domain,
    )

    if cf_domain:
        console.info(
            "Using HTTP exec via Cloudflare Tunnel: port-{port}-{instanceId}.{cf_domain}"
        )
        if client._ssh_host_explicit:
            console.info(f"SSH fallback enabled: {client.ssh_host}")
        else:
            console.info("SSH fallback disabled (set PVE_SSH_HOST to enable)")
    else:
        if client._ssh_host_explicit:
            console.info(f"Using SSH host: {client.ssh_host}")
        else:
            console.always("ERROR: No exec method configured. Set PVE_PUBLIC_DOMAIN or PVE_SSH_HOST")
            sys.exit(1)

    # Test connection
    try:
        version = client.get_version()
        console.always(f"Connected to Proxmox VE v{version['data']['version']}")
    except Exception as e:
        console.always(f"ERROR: Failed to connect to PVE API: {e}")
        sys.exit(1)

    node = client.get_node()
    console.always(f"Using node: {node}")

    # Verify template exists
    try:
        template_status = client.get_lxc_status(args.template_vmid)
        console.always(f"Template container {args.template_vmid}: {template_status.get('status', 'unknown')}")
    except Exception as e:
        console.always(f"ERROR: Template container {args.template_vmid} not found: {e}")
        console.always("")
        console.always("Create a template first:")
        console.always(f"  ./scripts/pve/pve-lxc-template.sh create {args.template_vmid}")
        console.always(f"  ./scripts/pve/pve-lxc-template.sh configure {args.template_vmid}")
        console.always(f"  ./scripts/pve/pve-lxc-template.sh convert {args.template_vmid}")
        sys.exit(1)

    # Bump IDE deps if requested
    if getattr(args, "bump_ide_deps", False):
        bun_path = shutil.which("bun")
        if bun_path is None:
            raise RuntimeError(
                "bun not found on host; install bun or rerun with --no-bump-ide-deps."
            )
        # Support both --ide-deps-channel flag and IDE_DEPS_CHANNEL env var
        ide_channel = os.environ.get("IDE_DEPS_CHANNEL") or getattr(args, "ide_deps_channel", "stable")
        console.always(
            f"Bumping IDE deps (channel: {ide_channel}) (bun run bump-ide-deps)..."
        )
        bump_result = subprocess.run(
            [bun_path, "run", "bump-ide-deps", "--channel", ide_channel],
            cwd=str(Path(args.repo_root).resolve()),
            text=True,
        )
        if bump_result.returncode != 0:
            raise RuntimeError(
                f"bun run bump-ide-deps failed with exit code {bump_result.returncode}"
            )

    manifest = _load_manifest()
    manifest["baseTemplateVmid"] = args.template_vmid
    repo_root = Path(args.repo_root).resolve()
    preset_plans = _build_preset_plans(args)
    created_containers: list[int] = []
    results: list[TemplateRunResult] = []

    console.always(
        f"Starting template creation for presets "
        f"{', '.join(plan.preset_id for plan in preset_plans)} "
        f"from base template {args.template_vmid} "
        f"(IDE provider: {args.ide_provider})"
    )

    # Start SSH ControlMaster if SSH is configured
    if client._ssh_host_explicit:
        console.info("Starting SSH ControlMaster for connection multiplexing...")
        client.start_ssh_control_master()

    last_template_vmid: int | None = None
    last_template_disk_mib: int = 0

    try:
        for index, preset_plan in enumerate(preset_plans):
            # Default to using base template and running tasks
            source_vmid = args.template_vmid
            run_tasks = True

            # Optimization: Use previous template if available and disk requirement is met.
            # This allows creating "boosted" templates by cloning "standard" and just resizing resources,
            # avoiding a full rebuild of dependencies.
            # We only chain if the new disk size is >= previous disk size (can't shrink easily).
            if last_template_vmid and preset_plan.disk_size_mib >= last_template_disk_mib:
                source_vmid = last_template_vmid
                run_tasks = False
                console.info(
                    f"Optimization: Building {preset_plan.label} from previous template {last_template_vmid} "
                    f"(skips task execution)"
                )

            result = await provision_and_create_template(
                args,
                preset=preset_plan,
                source_vmid=source_vmid,
                run_tasks=run_tasks,
                console=console,
                client=client,
                repo_root=repo_root,
                created_containers=created_containers,
                show_dependency_graph=(index == 0 and run_tasks),
            )
            results.append(result)

            # Update last template for chaining
            last_template_vmid = result.template_vmid
            last_template_disk_mib = preset_plan.disk_size_mib

    except Exception as e:
        console.always(f"\nERROR: Provisioning failed: {e}")
        traceback.print_exc()

        # Cleanup on failure
        if args.cleanup_on_failure:
            console.always("\nCleaning up created containers...")
            for vmid in created_containers:
                try:
                    # Gracefully shutdown before deletion
                    client.shutdown_lxc(vmid)
                    # Give it a moment to shutdown
                    import time
                    time.sleep(2)
                    client.delete_lxc(vmid)
                    console.always(f"  Deleted container {vmid}")
                except Exception:
                    pass
        raise
    finally:
        # Clean up SSH ControlMaster if we started one
        if client._ssh_host_explicit:
            client.stop_ssh_control_master()

    # Update manifest
    for result in results:
        manifest = _update_manifest_with_template(
            manifest,
            result.preset,
            result.template_vmid,
            result.snapshot_id,
            result.captured_at,
            result.node,
        )
    _write_manifest(manifest)

    # Summary
    console.always("\n" + "=" * 60)
    console.always("PVE LXC Template Summary")
    console.always("=" * 60)
    console.always(f"Manifest updated: {PVE_SNAPSHOT_MANIFEST_PATH}")
    console.always("")

    for result in results:
        console.always(f"Preset: {result.preset.preset_id}")
        console.always(f"  Snapshot ID: {result.snapshot_id}")
        console.always(f"  Template VMID: {result.template_vmid}")
        console.always(f"  Node: {result.node}")
        console.always(f"  Captured: {result.captured_at}")
        console.always("")

    console.always("To use these templates:")
    console.always("  1. Linked-clone: pct clone <template-vmid> <new-vmid>")
    console.always("  2. Start clone: pct start <new-vmid>")
    console.always("  3. Enter clone: pct enter <new-vmid>")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Provision PVE LXC containers with parallel setup"
    )
    parser.add_argument(
        "--template-vmid",
        type=int,
        default=DEFAULT_TEMPLATE_VMID,
        help=f"Template VMID to clone from (default: {DEFAULT_TEMPLATE_VMID})",
    )
    parser.add_argument(
        "--repo-root",
        default=".",
        help="Repository root (default: current directory)",
    )
    parser.add_argument(
        "--standard-vcpus",
        "--vcpus",
        dest="standard_vcpus",
        type=int,
        default=4,
        help="vCPU count for the standard preset",
    )
    parser.add_argument(
        "--standard-memory",
        "--memory",
        dest="standard_memory",
        type=int,
        default=8192,
        help="Memory (MiB) for the standard preset",
    )
    parser.add_argument(
        "--standard-disk-size",
        "--disk-size",
        dest="standard_disk_size",
        type=int,
        default=32768,
        help="Disk size (MiB) for the standard preset",
    )
    parser.add_argument(
        "--boosted-vcpus",
        type=int,
        default=6,
        help="vCPU count for the boosted preset",
    )
    parser.add_argument(
        "--boosted-memory",
        type=int,
        default=8192,
        help="Memory (MiB) for the boosted preset",
    )
    parser.add_argument(
        "--boosted-disk-size",
        type=int,
        default=40960,
        help="Disk size (MiB) for the boosted preset",
    )
    parser.add_argument(
        "--cleanup-on-failure",
        action="store_true",
        default=True,
        help="Delete created containers on failure",
    )
    parser.add_argument(
        "--no-cleanup-on-failure",
        action="store_false",
        dest="cleanup_on_failure",
        help="Keep created containers on failure for debugging",
    )
    parser.add_argument(
        "--ide-provider",
        choices=(IDE_PROVIDER_CODER, IDE_PROVIDER_OPENVSCODE, IDE_PROVIDER_CMUX_CODE),
        default=DEFAULT_IDE_PROVIDER,
        help=f"IDE provider to install (default: {DEFAULT_IDE_PROVIDER})",
    )
    parser.add_argument(
        "--ide-deps-channel",
        choices=("stable", "latest", "beta"),
        default="stable",
        help="Dist-tag channel for IDE dependency bumping (default: stable, falls back to latest if missing)",
    )
    parser.add_argument(
        "--bump-ide-deps",
        dest="bump_ide_deps",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Update configs/ide-deps.json before snapshotting (uses --ide-deps-channel)",
    )
    parser.add_argument(
        "--print-deps",
        action="store_true",
        help="Print dependency graph and exit",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="Update mode: update an existing template container in-place (skips dependency installation)",
    )
    parser.add_argument(
        "--update-vmid",
        type=int,
        help="VMID of existing container to update (required with --update)",
    )
    parser.add_argument(
        "--use-git-diff",
        dest="use_git_diff",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Clone from GitHub + apply local changes (default: enabled, use --no-use-git-diff for full archive upload)",
    )
    return parser.parse_args()


def main() -> None:
    dotenv.load_dotenv()
    args = parse_args()
    if getattr(args, "print_deps", False):
        # Print appropriate registry based on mode
        target_registry = update_registry if getattr(args, "update", False) else registry
        graph = format_dependency_graph(target_registry)
        if graph:
            print(graph)
        return

    # Set up git diff mode if enabled
    # Git diff mode: clone from GitHub + apply local uncommitted changes
    if getattr(args, "use_git_diff", False):
        print("[git-diff] Enabled (clone from GitHub + apply local changes)")
        set_git_diff_mode(True)
    else:
        print("[git-diff] Disabled (full archive upload)")
        set_git_diff_mode(False)

    # Pre-flight check: validate MCP server script syntax before building snapshot
    print("[pre-flight] Validating MCP server script syntax...")
    import subprocess
    try:
        result = subprocess.run(
            ["bun", "test", "packages/shared/src/agent-memory-protocol.test.ts"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            print("[pre-flight] ERROR: MCP server script validation failed!")
            print(result.stdout)
            print(result.stderr)
            sys.exit(1)
        print("[pre-flight] MCP server script validation passed")
    except subprocess.TimeoutExpired:
        print("[pre-flight] WARNING: MCP server script validation timed out, continuing...")
    except FileNotFoundError:
        print("[pre-flight] WARNING: bun not found, skipping MCP server script validation")

    # Validate update mode arguments
    if getattr(args, "update", False):
        if not getattr(args, "update_vmid", None):
            print("ERROR: --update-vmid is required when using --update mode")
            sys.exit(1)
        try:
            asyncio.run(run_update_mode(args))
        except Exception:
            traceback.print_exc()
            sys.exit(1)
    else:
        try:
            asyncio.run(provision_and_snapshot(args))
        except Exception:
            traceback.print_exc()
            sys.exit(1)


async def run_update_mode(args: argparse.Namespace) -> None:
    """Run update mode to update an existing container."""
    # Set IDE provider before running tasks
    set_ide_provider(args.ide_provider)

    console = Console()

    # Validate environment
    api_url = os.environ.get("PVE_API_URL")
    api_token = os.environ.get("PVE_API_TOKEN")

    if not api_url or not api_token:
        console.always("ERROR: PVE_API_URL and PVE_API_TOKEN must be set")
        sys.exit(1)

    cf_domain = os.environ.get("PVE_PUBLIC_DOMAIN")

    client = PveLxcClient(
        api_url=api_url,
        api_token=api_token,
        node=os.environ.get("PVE_NODE"),
        ssh_host=os.environ.get("PVE_SSH_HOST"),
        cf_domain=cf_domain,
    )

    if cf_domain:
        console.info(
            "Using HTTP exec via Cloudflare Tunnel: port-{port}-{instanceId}.{cf_domain}"
        )
        if client._ssh_host_explicit:
            console.info(f"SSH fallback enabled: {client.ssh_host}")
        else:
            console.info("SSH fallback disabled (set PVE_SSH_HOST to enable)")
    else:
        if client._ssh_host_explicit:
            console.info(f"Using SSH host: {client.ssh_host}")
        else:
            console.always("ERROR: No exec method configured. Set PVE_PUBLIC_DOMAIN or PVE_SSH_HOST")
            sys.exit(1)

    # Test connection
    try:
        version = client.get_version()
        console.always(f"Connected to Proxmox VE v{version['data']['version']}")
    except Exception as e:
        console.always(f"ERROR: Failed to connect to PVE API: {e}")
        sys.exit(1)

    repo_root = Path(args.repo_root).resolve()

    # Start SSH ControlMaster if SSH is configured
    if client._ssh_host_explicit:
        console.info("Starting SSH ControlMaster for connection multiplexing...")
        client.start_ssh_control_master()

    try:
        await update_existing_template(
            args,
            console=console,
            client=client,
            repo_root=repo_root,
        )
    finally:
        if client._ssh_host_explicit:
            client.stop_ssh_control_master()


if __name__ == "__main__":
    main()
