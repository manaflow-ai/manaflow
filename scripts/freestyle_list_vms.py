#!/usr/bin/env python3
"""List Freestyle VMs using the generated OpenAPI client."""

from __future__ import annotations

import os
import sys

from freestyle_client import ApiClient, Configuration, VMApi

FREESTYLE_API_KEY = os.environ.get("FREESTYLE_API_KEY")
FREESTYLE_API_BASE_URL = os.environ.get(
    "FREESTYLE_API_BASE_URL", "https://api.freestyle.sh"
)


def main() -> None:
    if not FREESTYLE_API_KEY:
        print(
            "FREESTYLE_API_KEY is required. Export it before running this script.",
            file=sys.stderr,
        )
        sys.exit(1)

    config = Configuration(host=FREESTYLE_API_BASE_URL)

    print(f"[Freestyle] Fetching VMs from {FREESTYLE_API_BASE_URL}")

    with ApiClient(config) as api_client:
        # Add auth header directly since OpenAPI spec doesn't define security on endpoints
        api_client.set_default_header("Authorization", f"Bearer {FREESTYLE_API_KEY}")
        vm_api = VMApi(api_client)
        response = vm_api.list_vms()

    print(
        f"Found {response.total_count} VM(s): "
        + f"{response.running_count} running, "
        + f"{response.starting_count} starting, "
        + f"{response.stopped_count} stopped\n"
    )

    if not response.vms:
        print("No VMs found.")
        return

    for vm in response.vms:
        print(f"- {vm.id} ({vm.state})")
        if vm.created_at:
            print(f"  created: {vm.created_at}")
        if vm.cpu_time_seconds is not None:
            print(f"  cpu time: {vm.cpu_time_seconds}s")
        if vm.last_network_activity:
            print(f"  last network activity: {vm.last_network_activity}")
        print()


if __name__ == "__main__":
    main()
