# /// script
# dependencies = [
#   "morphcloud",
#   "requests",
#   "python-dotenv",
# ]
# ///

#!/usr/bin/env python3
"""
Start a Morph instance from a snapshot for verification.
Usage: uv run --env-file .env scripts/morph_start_instance.py [snapshot_id]

Press Ctrl+C to stop the instance.
"""

import argparse
import signal
import sys
import time

import dotenv
from morphcloud.api import MorphCloudClient

dotenv.load_dotenv()

client = MorphCloudClient()

instance = None


def cleanup_instance(signum=None, frame=None):
    """Clean up instance on exit"""
    global instance
    if instance:
        print("\nStopping instance...")
        try:
            instance.stop()
            print(f"Instance {instance.id} stopped successfully")
        except Exception as e:
            print(f"Error stopping instance: {e}")
    sys.exit(0)


# Register signal handler for Ctrl+C
signal.signal(signal.SIGINT, cleanup_instance)

parser = argparse.ArgumentParser(description="Start instance from snapshot")
parser.add_argument("snapshot_id", nargs="?", default="snapshot_fx6g7tl7",
                    help="Snapshot ID to start from (default: snapshot_fx6g7tl7)")
parser.add_argument("--no-snapshot", action="store_true",
                    help="Skip prompting to create a snapshot on exit")
args = parser.parse_args()

try:
    print(f"Starting instance from {args.snapshot_id}...")
    start_time = time.time()
    instance = client.instances.start(
        snapshot_id=args.snapshot_id,
        ttl_seconds=3600,
        ttl_action="stop",
    )
    start_elapsed = time.time() - start_time
    print(f"  ↳ instances.start(): {start_elapsed:.2f}s")

    wait_time = time.time()
    instance.wait_until_ready()
    wait_elapsed = time.time() - wait_time
    print(f"  ↳ wait_until_ready(): {wait_elapsed:.2f}s")

    print(f"Instance ID: {instance.id}")
    print(f"Dashboard: https://cloud.morph.so/web/instances/{instance.id}?ssh=true")

    total_elapsed = time.time() - start_time
    print(f"  ↳ Total startup: {total_elapsed:.2f}s")

    # Print useful URLs
    print("\n=== Verification URLs ===")
    print(f"VS Code:   https://port-39378-{instance.id.replace('_', '-')}.http.cloud.morph.so")
    print(f"VNC:       https://port-39380-{instance.id.replace('_', '-')}.http.cloud.morph.so/vnc.html")
    print(f"xterm:     https://port-39383-{instance.id.replace('_', '-')}.http.cloud.morph.so")
    print(f"Worker:    https://port-39377-{instance.id.replace('_', '-')}.http.cloud.morph.so/health")

    print("\nPress Ctrl+C to stop the instance...")

    if args.no_snapshot:
        # Just wait forever
        signal.pause()
    else:
        # listen for any keypress, then snapshot
        input("Or press Enter to create a snapshot...")
        final_snapshot = instance.snapshot()
        print(f"Snapshot ID: {final_snapshot.id}")
except KeyboardInterrupt:
    cleanup_instance()
except Exception as e:
    print(f"Error: {e}")
    cleanup_instance()
