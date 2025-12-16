"""Freestyle provider implementation."""

from __future__ import annotations

import asyncio
import base64
import os
import shlex
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any, override

# Add freestyle-client-pkg to path for local imports
_freestyle_client_pkg = Path(__file__).resolve().parent.parent / "freestyle-client-pkg"
if str(_freestyle_client_pkg) not in sys.path:
    sys.path.insert(0, str(_freestyle_client_pkg))

from freestyle_client import ApiClient, Configuration, VMApi
from freestyle_client.exceptions import ApiException
from freestyle_client.models.create_snapshot_request import CreateSnapshotRequest
from freestyle_client.models.create_vm_request import CreateVmRequest
from freestyle_client.models.exec_await_request import ExecAwaitRequest
from freestyle_client.models.snapshot_info import SnapshotInfo
from freestyle_client.models.snapshot_vm_request import SnapshotVmRequest
from freestyle_client.models.snapshot_vm_response import SnapshotVmResponse
from freestyle_client.models.vm_template import VmTemplate
from freestyle_client.models.write_file_request import WriteFileRequest

from .base import BaseInstance, BaseProvider, BaseSnapshot, ExecResponse, ProviderType


FREESTYLE_DEFAULT_PORT = 3000
FREESTYLE_EXTERNAL_PORT = 443


class FreestyleSnapshot(BaseSnapshot):
    """Freestyle snapshot wrapper."""

    _snapshot_id: str
    _raw: SnapshotInfo | SnapshotVmResponse | None

    def __init__(self, snapshot_id: str, *, raw: SnapshotInfo | SnapshotVmResponse | None = None) -> None:
        self._snapshot_id = snapshot_id
        self._raw = raw

    @property
    @override
    def id(self) -> str:
        return self._snapshot_id

    @property
    def raw(self) -> SnapshotInfo | SnapshotVmResponse | None:
        """Return the underlying Freestyle snapshot object if available."""
        return self._raw


class FreestyleInstance(BaseInstance):
    """Freestyle VM instance wrapper."""

    _vm_id: str
    _vm_api: VMApi
    _domains: list[str]

    def __init__(
        self,
        vm_id: str,
        vm_api: VMApi,
        *,
        domains: list[str] | None = None,
    ) -> None:
        self._vm_id = vm_id
        self._vm_api = vm_api
        self._domains = domains or []

    @property
    @override
    def id(self) -> str:
        return self._vm_id

    @property
    def domains(self) -> list[str]:
        """Return the list of exposed domains for this VM."""
        return self._domains

    @override
    async def await_until_ready(self) -> None:
        # Freestyle fork with wait_for_ready_signal=True already waits for ready
        # So this is a no-op for most cases. But if needed, we can poll get_vm.
        pass

    @override
    async def aexec(
        self,
        command: Sequence[str],
        *,
        timeout: float | None = None,
    ) -> ExecResponse:
        # Freestyle exec_await takes a command string, not a list
        # Use shlex.join for proper shell escaping of arguments
        command_str = shlex.join(command)
        timeout_ms = int(timeout * 1000) if timeout else None
        request = ExecAwaitRequest(command=command_str)
        if timeout_ms is not None:
            request.timeout_ms = timeout_ms

        # Retry on transient API errors (500, 502, 503, 504)
        max_retries = 3
        last_exc: Exception | None = None
        for attempt in range(max_retries):
            try:
                result = await asyncio.to_thread(
                    self._vm_api.exec_await,
                    self._vm_id,
                    request,
                )
                return ExecResponse(
                    stdout=result.stdout or "",
                    stderr=result.stderr or "",
                    exit_code=result.status_code,
                )
            except ApiException as exc:
                last_exc = exc
                # Retry on server errors (5xx)
                if exc.status is not None and 500 <= exc.status < 600:
                    if attempt < max_retries - 1:
                        delay = 2 ** (attempt + 1)  # 2, 4 seconds
                        await asyncio.sleep(delay)
                        continue
                raise
            except Exception as exc:
                last_exc = exc
                raise

        # Should not reach here, but just in case
        if last_exc is not None:
            raise last_exc
        raise RuntimeError("aexec failed after retries")

    @override
    async def aupload(
        self,
        local_path: Path | str,
        remote_path: str,
    ) -> None:
        path = Path(local_path) if isinstance(local_path, str) else local_path
        content = path.read_bytes()

        # Try to upload as text if it's valid UTF-8
        try:
            content_str = content.decode("utf-8")
            await asyncio.to_thread(
                self._vm_api.put_file,
                self._vm_id,
                remote_path,
                WriteFileRequest(content=content_str),
            )
            return
        except UnicodeDecodeError:
            pass  # Fall through to base64 upload

        # For binary files, base64 encode and decode on the VM
        content_b64 = base64.b64encode(content).decode("ascii")
        b64_path = f"{remote_path}.b64"

        await asyncio.to_thread(
            self._vm_api.put_file,
            self._vm_id,
            b64_path,
            WriteFileRequest(content=content_b64),
        )

        # Decode using perl (shell redirects don't work in Freestyle exec)
        # Perl can write files directly without relying on shell stdout capture
        perl_decode = f"""
use MIME::Base64;
open(my $in, '<', '{b64_path}') or die "Cannot open input: $!";
my $b64 = do {{ local $/; <$in> }};
close($in);
open(my $out, '>', '{remote_path}') or die "Cannot open output: $!";
binmode($out);
print $out decode_base64($b64);
close($out);
unlink('{b64_path}');
"""
        result = await self.aexec(["perl", "-e", perl_decode])
        if result.exit_code != 0:
            raise RuntimeError(
                f"Failed to decode file on VM: exit={result.exit_code}, "
                f"stderr={result.stderr}"
            )

    @override
    async def aexpose_http_service(
        self,
        *,
        name: str,
        port: int,
    ) -> str:
        _ = name  # Unused but required by interface
        # Freestyle exposes port 3000 to port 443 by default during fork
        # Additional port exposure is not yet fully implemented per user's note
        # For now, return the domain URL if port 3000 is requested
        if port == FREESTYLE_DEFAULT_PORT and self._domains:
            return f"https://{self._domains[0]}"
        # For other ports, we can't expose them yet
        # Return a placeholder or raise an error
        raise NotImplementedError(
            f"Freestyle does not yet support exposing port {port}. "
            + f"Only port {FREESTYLE_DEFAULT_PORT} is exposed by default."
        )

    @override
    async def asnapshot(self) -> FreestyleSnapshot:
        request = SnapshotVmRequest()
        result = await asyncio.to_thread(
            self._vm_api.snapshot_vm,
            self._vm_id,
            request,
        )
        return FreestyleSnapshot(result.snapshot_id, raw=result)

    @override
    def stop(self) -> None:
        self._vm_api.stop_vm(self._vm_id)

    @override
    def get_http_service_url(self, port: int) -> str:
        # Freestyle URL pattern via proxy.cmux.sh
        return f"https://{self._vm_id}-{port}.proxy.cmux.sh"

    @override
    def get_dashboard_url(self) -> str:
        # Freestyle doesn't have a public dashboard yet
        return f"https://freestyle.sh/vm/{self._vm_id}"


class FreestyleProvider(BaseProvider):
    """Freestyle sandbox provider."""

    _api_key: str
    _base_url: str
    _config: Configuration
    _api_client: ApiClient | None

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
    ) -> None:
        self._api_key = api_key or os.environ.get("FREESTYLE_API_KEY", "")
        self._base_url = base_url or os.environ.get(
            "FREESTYLE_API_BASE_URL", "https://api.freestyle.sh"
        )
        if not self._api_key:
            raise ValueError(
                "FREESTYLE_API_KEY is required. Set it as an environment variable "
                + "or pass it to FreestyleProvider."
            )
        self._config = Configuration(host=self._base_url)
        self._api_client = None

    def _get_api_client(self) -> ApiClient:
        if self._api_client is None:
            self._api_client = ApiClient(self._config)
            self._api_client.set_default_header(  # type: ignore[reportUnknownMemberType]
                "Authorization", f"Bearer {self._api_key}"
            )
        return self._api_client

    def _get_vm_api(self) -> VMApi:
        return VMApi(self._get_api_client())

    @property
    @override
    def provider_type(self) -> ProviderType:
        return ProviderType.FREESTYLE

    @override
    async def boot_instance(
        self,
        snapshot_id: str,
        *,
        vcpus: int | None = None,
        memory_mib: int | None = None,
        disk_size_mib: int | None = None,
        ttl_seconds: int | None = None,
    ) -> FreestyleInstance:
        # Freestyle doesn't support vcpus/memory configuration yet
        _ = vcpus, memory_mib, disk_size_mib  # Unused - disk size is baked into snapshot

        vm_api = self._get_vm_api()

        # Use create_vm with snapshotId instead of fork_vm
        # (fork_vm endpoint has issues with snapshots created via create_snapshot)
        request_data: dict[str, Any] = {
            "snapshotId": snapshot_id,
            "waitForReadySignal": True,
            "readySignalTimeoutSeconds": 120,
        }
        if ttl_seconds is not None:
            request_data["idleTimeoutSeconds"] = ttl_seconds

        request = CreateVmRequest.model_validate(request_data)

        result = await asyncio.to_thread(
            vm_api.create_vm,
            request,
        )

        return FreestyleInstance(
            result.id,
            vm_api,
            domains=list(result.domains) if result.domains else [],
        )

    async def create_fresh_instance(
        self,
        *,
        ttl_seconds: int | None = None,
        ports: list[dict[str, int]] | None = None,
        disk_size_mib: int | None = None,
    ) -> FreestyleInstance:
        """Create a fresh VM without forking from a snapshot.

        Note: Unlike boot_instance which forks from a snapshot with init scripts,
        fresh VMs have no ready signal mechanism, so we don't wait for one.

        Args:
            ttl_seconds: Optional idle timeout in seconds.
            ports: Optional list of port mappings, e.g. [{"port": 443, "targetPort": 39379}].
                   Only external ports 443 and 8081 are supported.
            disk_size_mib: Disk size in MiB. Defaults to Freestyle's default (~2GB) if not provided.
        """
        vm_api = self._get_vm_api()

        # Fresh VMs don't have init scripts to send ready signals,
        # so we don't wait for one
        template_data: dict[str, Any] = {}
        if ttl_seconds is not None:
            template_data["idleTimeoutSeconds"] = ttl_seconds
        if ports is not None:
            template_data["ports"] = ports
        if disk_size_mib is not None:
            template_data["rootfsSizeMb"] = disk_size_mib

        template = VmTemplate.model_validate(template_data)
        request = CreateVmRequest(template=template)

        result = await asyncio.to_thread(
            vm_api.create_vm,
            request,
        )

        return FreestyleInstance(
            result.id,
            vm_api,
            domains=list(result.domains) if result.domains else [],
        )

    async def create_base_snapshot(
        self,
        *,
        disk_size_mib: int | None = None,
        name: str | None = None,
        ports: list[dict[str, int]] | None = None,
    ) -> FreestyleSnapshot:
        """Create a base snapshot with specified disk size.

        This uses the Freestyle create_snapshot endpoint which creates a temporary
        VM, starts it, snapshots it, then deletes the VM. The snapshot will have
        the specified rootfs size baked in.

        Args:
            disk_size_mib: Disk size in MiB. Defaults to 16000 (16GB) if not provided.
            name: Optional name for the snapshot.
            ports: Optional list of port mappings for the snapshot.
        """
        vm_api = self._get_vm_api()

        template_data: dict[str, Any] = {}
        if disk_size_mib is not None:
            template_data["rootfsSizeMb"] = disk_size_mib
        if ports is not None:
            template_data["ports"] = ports

        template = VmTemplate.model_validate(template_data)
        request_data: dict[str, Any] = {"template": template}
        if name is not None:
            request_data["name"] = name

        request = CreateSnapshotRequest.model_validate(request_data)

        result = await asyncio.to_thread(
            vm_api.create_snapshot,
            request,
        )

        return FreestyleSnapshot(result.snapshot_id)

    @override
    async def list_snapshots(self) -> Sequence[FreestyleSnapshot]:
        vm_api = self._get_vm_api()
        result = await asyncio.to_thread(vm_api.list_snapshots)
        return [
            FreestyleSnapshot(s.snapshot_id, raw=s)
            for s in result.snapshots
        ]

    def close(self) -> None:
        """Close the API client and release resources."""
        if self._api_client is not None:
            # ApiClient uses __enter__/__exit__ protocol
            self._api_client.__exit__(None, None, None)
            self._api_client = None
