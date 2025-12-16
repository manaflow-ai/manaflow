"""Abstract base classes for sandbox VM providers."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class ProviderType(Enum):
    """Supported sandbox providers."""

    MORPH = "morph"
    FREESTYLE = "freestyle"


@dataclass(slots=True, frozen=True)
class ExecResponse:
    """Standardized response from command execution."""

    stdout: str
    stderr: str
    exit_code: int | None


@dataclass(slots=True, frozen=True)
class PortMapping:
    """Mapping of internal port to exposed URL."""

    port: int
    url: str
    name: str | None = None


class BaseSnapshot(ABC):
    """Abstract base class for VM snapshots."""

    @property
    @abstractmethod
    def id(self) -> str:
        """Return the snapshot ID."""
        ...


class BaseInstance(ABC):
    """Abstract base class for VM instances."""

    @property
    @abstractmethod
    def id(self) -> str:
        """Return the instance/VM ID."""
        ...

    @abstractmethod
    async def await_until_ready(self) -> None:
        """Wait for the instance to be ready for commands."""
        ...

    @abstractmethod
    async def aexec(
        self,
        command: Sequence[str],
        *,
        timeout: float | None = None,
    ) -> ExecResponse:
        """Execute a command in the instance asynchronously.

        Args:
            command: The command to execute as a sequence of strings.
            timeout: Optional timeout in seconds.

        Returns:
            ExecResponse with stdout, stderr, and exit code.
        """
        ...

    @abstractmethod
    async def aupload(
        self,
        local_path: Path | str,
        remote_path: str,
    ) -> None:
        """Upload a file to the instance asynchronously.

        Args:
            local_path: Local file path to upload (Path or str).
            remote_path: Remote destination path.
        """
        ...

    @abstractmethod
    async def aexpose_http_service(
        self,
        *,
        name: str,
        port: int,
    ) -> str:
        """Expose an HTTP service on the given port.

        Args:
            name: Service name for identification.
            port: Internal port number to expose.

        Returns:
            The public URL for the exposed service.
        """
        ...

    @abstractmethod
    async def asnapshot(self) -> BaseSnapshot:
        """Create a snapshot of the current instance state.

        Returns:
            A BaseSnapshot representing the captured state.
        """
        ...

    @abstractmethod
    def stop(self) -> None:
        """Stop the instance synchronously."""
        ...

    @abstractmethod
    def get_http_service_url(self, port: int) -> str:
        """Get the URL for accessing an HTTP service on the given port.

        Unlike aexpose_http_service, this does not make any API calls -
        it just constructs the URL based on the provider's URL pattern.

        Args:
            port: Internal port number.

        Returns:
            The public URL for accessing the port.
        """
        ...

    @abstractmethod
    def get_dashboard_url(self) -> str:
        """Get the provider's dashboard URL for this instance.

        Returns:
            URL to the provider's web dashboard for this instance.
        """
        ...


class BaseProvider(ABC):
    """Abstract base class for sandbox VM providers."""

    @property
    @abstractmethod
    def provider_type(self) -> ProviderType:
        """Return the provider type."""
        ...

    @abstractmethod
    async def boot_instance(
        self,
        snapshot_id: str,
        *,
        vcpus: int | None = None,
        memory_mib: int | None = None,
        disk_size_mib: int | None = None,
        ttl_seconds: int | None = None,
    ) -> BaseInstance:
        """Boot a new instance from a snapshot.

        Args:
            snapshot_id: The snapshot ID to boot from.
            vcpus: Number of virtual CPUs (if supported).
            memory_mib: Memory in MiB (if supported).
            disk_size_mib: Disk size in MiB (if supported).
            ttl_seconds: Time-to-live in seconds (if supported).

        Returns:
            A BaseInstance representing the booted VM.
        """
        ...

    @abstractmethod
    async def list_snapshots(self) -> Sequence[BaseSnapshot]:
        """List available snapshots.

        Returns:
            A sequence of BaseSnapshot objects.
        """
        ...
