"""Morph provider implementation."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from pathlib import Path
from typing import Any, override

from morphcloud.api import Instance, MorphCloudClient, Snapshot

from .base import BaseInstance, BaseProvider, BaseSnapshot, ExecResponse, ProviderType


class MorphSnapshot(BaseSnapshot):
    """Morph snapshot wrapper."""

    _snapshot: Snapshot

    def __init__(self, snapshot: Snapshot) -> None:
        self._snapshot = snapshot

    @property
    @override
    def id(self) -> str:
        return self._snapshot.id

    @property
    def raw(self) -> Snapshot:
        """Return the underlying Morph Snapshot object."""
        return self._snapshot


class MorphInstance(BaseInstance):
    """Morph instance wrapper."""

    _instance: Instance

    def __init__(self, instance: Instance) -> None:
        self._instance = instance

    @property
    @override
    def id(self) -> str:
        return self._instance.id

    @property
    def raw(self) -> Instance:
        """Return the underlying Morph Instance object."""
        return self._instance

    @override
    async def await_until_ready(self) -> None:
        await self._instance.await_until_ready()

    @override
    async def aexec(
        self,
        command: Sequence[str],
        *,
        timeout: float | None = None,
    ) -> ExecResponse:
        result = await self._instance.aexec(list(command), timeout=timeout)
        return ExecResponse(
            stdout=result.stdout,
            stderr=result.stderr,
            exit_code=result.exit_code,
        )

    @override
    async def aupload(
        self,
        local_path: Path,
        remote_path: str,
    ) -> None:
        await self._instance.aupload(str(local_path), remote_path)

    @override
    async def aexpose_http_service(
        self,
        *,
        name: str,
        port: int,
    ) -> str:
        return await self._instance.aexpose_http_service(name=name, port=port)

    @override
    async def asnapshot(self) -> MorphSnapshot:
        snapshot = await self._instance.asnapshot()
        return MorphSnapshot(snapshot)

    @override
    def stop(self) -> None:
        self._instance.stop()


class MorphProvider(BaseProvider):
    """Morph sandbox provider."""

    _client: MorphCloudClient

    def __init__(self, client: MorphCloudClient | None = None) -> None:
        self._client = client or MorphCloudClient()

    @property
    @override
    def provider_type(self) -> ProviderType:
        return ProviderType.MORPH

    @property
    def client(self) -> MorphCloudClient:
        """Return the underlying Morph client."""
        return self._client

    @override
    async def boot_instance(
        self,
        snapshot_id: str,
        *,
        vcpus: int | None = None,
        memory_mib: int | None = None,
        disk_size_mib: int | None = None,
        ttl_seconds: int | None = None,
        ttl_action: str | None = None,
    ) -> MorphInstance:
        kwargs: dict[str, Any] = {}
        if vcpus is not None:
            kwargs["vcpus"] = vcpus
        if memory_mib is not None:
            kwargs["memory"] = memory_mib
        if disk_size_mib is not None:
            kwargs["disk_size"] = disk_size_mib
        if ttl_seconds is not None:
            kwargs["ttl_seconds"] = ttl_seconds
        if ttl_action is not None:
            kwargs["ttl_action"] = ttl_action

        instance = await self._client.instances.aboot(snapshot_id, **kwargs)
        return MorphInstance(instance)

    @override
    async def list_snapshots(self) -> Sequence[MorphSnapshot]:
        snapshots = await asyncio.to_thread(self._client.snapshots.list)
        return [MorphSnapshot(s) for s in snapshots]
