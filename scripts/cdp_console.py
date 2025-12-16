#!/usr/bin/env python3
"""
Launch a Morph instance from a snapshot, expose DevTools over the public proxy,
open a new page, navigate to Google, and drop into an interactive CDP shell.

Usage:
    uv run --env-file .env scripts/cdp_console.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse

import httpx
from cdp_use.client import CDPClient
from morphcloud.api import ApiError, Instance, MorphCloudClient

CDP_PORT = 39381
VNC_PORT = 39380
VSCODE_PORT = 39378
DEFAULT_SNAPSHOT_ID = "snapshot_lj5iqb09"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Launch a Morph instance and open a CDP shell.")
    parser.add_argument(
        "--snapshot-id",
        default=DEFAULT_SNAPSHOT_ID,
        help="Snapshot to boot (default: %(default)s)",
    )
    parser.add_argument(
        "--vcpus",
        type=int,
        default=10,
        help="vCPU count for the instance (default: %(default)s)",
    )
    parser.add_argument(
        "--memory",
        type=int,
        default=32768,
        help="Memory in MB for the instance (default: %(default)s)",
    )
    parser.add_argument(
        "--disk-size",
        type=int,
        default=65_536,
        help="Disk size in GB for the instance (default: %(default)s)",
    )
    parser.add_argument(
        "--ttl-seconds",
        type=int,
        default=60 * 60 * 2,
        help="TTL in seconds before the instance auto-pauses (default: %(default)s)",
    )
    parser.add_argument(
        "--ttl-action",
        choices=("pause", "stop"),
        default="pause",
        help="Action when TTL expires (default: %(default)s)",
    )
    parser.add_argument(
        "--keep-instance",
        action="store_true",
        help="Leave the instance running when the script exits.",
    )
    parser.add_argument(
        "--initial-url",
        default="https://www.google.com/",
        help="URL to open in the new page (default: %(default)s)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose CDP logging.",
    )
    return parser.parse_args()


async def expose_ports(instance: Instance, ports: list[int]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for port in ports:
        url = await instance.aexpose_http_service(name=f"port-{port}", port=port)
        mapping[port] = url
    return mapping


async def fetch_devtools_version(cdp_url: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        response = await client.get(f"{cdp_url.rstrip('/')}/json/version")
        response.raise_for_status()
        return response.json()


def build_websocket_url(cdp_http_url: str, local_ws_url: str) -> str:
    base = urlparse(cdp_http_url)
    ws = urlparse(local_ws_url)
    scheme = "wss" if base.scheme == "https" else "ws"
    return urlunparse(
        (
            scheme,
            base.netloc,
            ws.path,
            ws.params,
            ws.query,
            ws.fragment,
        )
    )


def _format_console_args(event: dict[str, Any]) -> str:
    args = []
    for entry in event.get("args", []):
        if "value" in entry:
            args.append(str(entry["value"]))
        elif "description" in entry:
            args.append(str(entry["description"]))
        else:
            args.append(str(entry))
    return " ".join(args)


async def interactive_shell(client: CDPClient, session_id: Optional[str]) -> None:
    loop = asyncio.get_running_loop()
    print()
    print("Interactive CDP shell. Type commands as 'Domain.method {\"param\": \"value\"}'.")
    print("Prefix command with '!' to send it without the default session.")
    print("Examples:")
    print('  Page.navigate {"url": "https://example.com"}')
    print('  Runtime.evaluate {"expression": "document.title"}')
    print('  !Target.getTargets')
    print("Type 'exit' or press Ctrl+D to quit.\n")

    while True:
        try:
            line = await loop.run_in_executor(None, lambda: input("cdp> ").strip())
        except EOFError:
            print()
            break
        except KeyboardInterrupt:
            print()
            break

        if not line:
            continue

        if line.lower() in {"exit", "quit"}:
            break

        use_session = True
        if line.startswith("!"):
            use_session = False
            line = line[1:].lstrip()
            if not line:
                print("No command provided after '!'.")
                continue

        method_part, _, params_part = line.partition(" ")
        if "." not in method_part:
            print("Expected format 'Domain.method'.")
            continue

        domain_name, method_name = method_part.split(".", 1)
        params: Any = None
        if params_part.strip():
            try:
                params = json.loads(params_part)
            except json.JSONDecodeError as exc:
                print(f"Invalid JSON parameters: {exc}")
                continue

        try:
            domain = getattr(client.send, domain_name)
            method = getattr(domain, method_name)
        except AttributeError:
            print(f"Unknown CDP command: {domain_name}.{method_name}")
            continue

        kwargs = {"session_id": session_id if use_session else None}
        try:
            if params is None:
                result = await method(**kwargs)
            else:
                result = await method(params, **kwargs)
        except TypeError as exc:
            print(f"Argument error: {exc}")
        except Exception as exc:  # noqa: BLE001
            print(f"Command failed: {exc}")
        else:
            if result is None:
                print("✅ OK")
            else:
                print(json.dumps(result, indent=2, sort_keys=True))


async def create_cdp_session(
    client: CDPClient,
    initial_url: str,
) -> tuple[str, str]:
    create_result = await client.send.Target.createTarget({"url": "about:blank"})
    target_id = create_result["targetId"]
    attach_result = await client.send.Target.attachToTarget(
        {"targetId": target_id, "flatten": True}
    )
    session_id = attach_result["sessionId"]
    await client.send.Page.enable(session_id=session_id)
    await client.send.Runtime.enable(session_id=session_id)
    await client.send.Page.navigate({"url": initial_url}, session_id=session_id)
    return target_id, session_id


async def prompt_should_stop_instance(keep_instance: bool) -> bool:
    if keep_instance:
        return False
    loop = asyncio.get_running_loop()
    response = await loop.run_in_executor(
        None, lambda: input("Stop instance before exiting? [Y/n]: ").strip().lower()
    )
    return response in {"", "y", "yes"}


async def run() -> None:
    args = parse_args()

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(message)s",
    )

    client = MorphCloudClient()
    instance: Optional[Instance] = None
    should_stop = False

    try:
        print(f"Booting snapshot {args.snapshot_id}...")
        instance = await client.instances.aboot(
            args.snapshot_id,
        )
        print(f"Instance {instance.id} is starting; waiting for readiness...")
        await instance.await_until_ready()
        print("Instance is ready.")

        ports = [VSCODE_PORT, 39377, 39379, VNC_PORT, CDP_PORT]
        print(f"Exposing ports: {', '.join(str(p) for p in ports)}")
        port_map = await expose_ports(instance, ports)
        vscode_url = port_map.get(VSCODE_PORT)
        vnc_url = port_map.get(VNC_PORT)
        cdp_url = port_map.get(CDP_PORT)
        if not all([vscode_url, vnc_url, cdp_url]):
            missing = [str(p) for p, url in port_map.items() if not url]
            raise RuntimeError(f"Missing service URLs for ports: {', '.join(missing)}")

        vnc_html = f"{vnc_url.rstrip('/')}/vnc.html"
        print(f"VS Code URL: {vscode_url}")
        print(f"VNC URL: {vnc_html}")
        print(f"DevTools version endpoint: {cdp_url}/json/version")

        # press enter to continue
        input("Press Enter to continue...")
        
        version_info = await fetch_devtools_version(cdp_url)
        ws_url = build_websocket_url(cdp_url, version_info["webSocketDebuggerUrl"])
        print(f"Using websocket endpoint: {ws_url}")


        if args.verbose:
            print("DevTools version payload:")
            print(json.dumps(version_info, indent=2, sort_keys=True))

        def handle_console(event: dict[str, Any], event_session_id: Optional[str]) -> None:
            prefix = f"[console][{event_session_id or 'root'}]"
            print(f"{prefix} {_format_console_args(event)}")

        def handle_load(_: dict[str, Any], event_session_id: Optional[str]) -> None:
            prefix = f"[page][{event_session_id or 'root'}]"
            print(f"{prefix} load event fired")

        async with CDPClient(ws_url) as cdp_client:
            cdp_client.register.Runtime.consoleAPICalled(handle_console)
            cdp_client.register.Page.loadEventFired(handle_load)

            print("Connected to DevTools websocket.")

            target_id, session_id = await create_cdp_session(
                cdp_client,
                args.initial_url,
            )
            print(f"Attached to target {target_id} (session {session_id})")
            await asyncio.sleep(2)

            await cdp_client.send.Runtime.evaluate(
                {
                    "expression": 'console.log("CDP session ready:", document.location.href)',
                    "returnByValue": True,
                },
                session_id=session_id,
            )

            await interactive_shell(cdp_client, session_id)

            try:
                await cdp_client.send.Target.closeTarget({"targetId": target_id})
            except Exception:  # noqa: BLE001
                pass

        should_stop = await prompt_should_stop_instance(args.keep_instance)

    except ApiError as error:
        print(f"Morph API error: {error}", file=sys.stderr)
        should_stop = True
    except Exception as error:  # noqa: BLE001
        print(f"Unexpected error: {error}", file=sys.stderr)
        should_stop = True
    finally:
        if instance and should_stop:
            # press enter to stop
            input("Press Enter to stop instance...")
            print("Stopping instance...")
            try:
                await asyncio.to_thread(instance.stop)
                print("Instance stopped.")
            except Exception as error:  # noqa: BLE001
                print(f"Failed to stop instance: {error}", file=sys.stderr)


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        print()
        sys.exit(1)
