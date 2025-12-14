#!/usr/bin/env python3
"""
Provider-agnostic provisioning script for sandbox VMs.

This is a unified entry point for provisioning snapshots across different
providers (Morph, Freestyle).

Examples:
    # Morph (default) - uses existing snapshot.py task graph
    uv run --env-file .env ./scripts/provision.py --provider morph

    # Freestyle
    uv run --env-file .env ./scripts/provision.py --provider freestyle --snapshot-id pytdi

    # List available snapshots
    uv run --env-file .env ./scripts/provision.py --provider morph --list-snapshots
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

try:
    import dotenv  # pyright: ignore[reportMissingImports]
except ImportError:
    dotenv = None  # type: ignore[assignment]

# Add scripts directory to path for providers import
scripts_dir = Path(__file__).resolve().parent
if str(scripts_dir) not in sys.path:
    sys.path.insert(0, str(scripts_dir))

from providers import get_provider  # pyright: ignore[reportImplicitRelativeImport]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Provider-agnostic provisioning for sandbox VMs"
    )
    parser.add_argument(
        "--provider",
        choices=["morph", "freestyle"],
        default="morph",
        help="Provider to use (default: morph)",
    )
    parser.add_argument(
        "--snapshot-id",
        help="Base snapshot ID to boot from",
    )
    parser.add_argument(
        "--list-snapshots",
        action="store_true",
        help="List available snapshots and exit",
    )
    parser.add_argument(
        "--vcpus",
        type=int,
        default=4,
        help="vCPU count (Morph only)",
    )
    parser.add_argument(
        "--memory",
        type=int,
        default=16_384,
        help="Memory in MiB (Morph only)",
    )
    parser.add_argument(
        "--disk-size",
        type=int,
        default=49_152,
        help="Disk size in MiB (Morph only)",
    )
    parser.add_argument(
        "--ttl-seconds",
        type=int,
        default=3600,
        help="TTL for created instances",
    )

    # Forward to snapshot.py for Morph
    parser.add_argument(
        "--require-verify",
        action="store_true",
        help="Require manual verification before snapshotting (Morph only)",
    )
    parser.add_argument(
        "--print-deps",
        action="store_true",
        help="Print task dependency graph and exit (Morph only)",
    )

    return parser.parse_args()


async def list_snapshots(provider_type: str) -> None:
    """List available snapshots for a provider."""
    provider = get_provider(provider_type)
    print(f"Listing snapshots for {provider_type}...")
    snapshots = await provider.list_snapshots()
    if not snapshots:
        print("  No snapshots found")
        return
    for snapshot in snapshots:
        print(f"  {snapshot.id}")


async def run_morph_provision(args: argparse.Namespace) -> None:
    """Delegate to existing snapshot.py for Morph provisioning."""
    import subprocess

    cmd = [
        sys.executable,
        str(scripts_dir / "snapshot.py"),
    ]

    if args.snapshot_id:
        cmd.extend(["--snapshot-id", args.snapshot_id])
    if args.require_verify:
        cmd.append("--require-verify")
    if args.print_deps:
        cmd.append("--print-deps")

    cmd.extend(["--standard-vcpus", str(args.vcpus)])
    cmd.extend(["--standard-memory", str(args.memory)])
    cmd.extend(["--standard-disk-size", str(args.disk_size)])
    cmd.extend(["--ttl-seconds", str(args.ttl_seconds)])

    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, check=False)
    sys.exit(result.returncode)


async def run_freestyle_provision(args: argparse.Namespace) -> None:
    """Run provisioning for Freestyle provider."""
    from providers import FreestyleProvider  # pyright: ignore[reportImplicitRelativeImport]

    if not args.snapshot_id:
        print("Error: --snapshot-id is required for Freestyle")
        sys.exit(1)

    provider = FreestyleProvider()
    print(f"Booting Freestyle instance from snapshot {args.snapshot_id}...")

    instance = await provider.boot_instance(
        args.snapshot_id,
        ttl_seconds=args.ttl_seconds,
    )
    print(f"Instance booted: {instance.id}")

    # For Freestyle, domains are exposed automatically
    if hasattr(instance, "domains") and instance.domains:
        for domain in instance.domains:
            print(f"  Domain: https://{domain}")

    # TODO: Run task graph for Freestyle
    # For now, just boot the instance and let user interact manually
    print("\nNote: Full task graph execution for Freestyle not yet implemented.")
    print("Use the instance directly or run tasks manually.")


async def main_async() -> None:
    args = parse_args()

    if args.list_snapshots:
        await list_snapshots(args.provider)
        return

    if args.provider == "morph":
        await run_morph_provision(args)
    elif args.provider == "freestyle":
        await run_freestyle_provision(args)
    else:
        print(f"Unknown provider: {args.provider}")
        sys.exit(1)


def main() -> None:
    if dotenv is not None:
        dotenv.load_dotenv()
    asyncio.run(main_async())


if __name__ == "__main__":
    main()
