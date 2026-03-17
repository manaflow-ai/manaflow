#!/usr/bin/env python3
# NOTE: Requires Python 3.11+ for morphcloud package. On macOS, use:
#   /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 scripts/test_morph_connection.py
"""
scripts/test_morph_connection.py

Test Morph Cloud API connectivity and basic operations.

This script verifies:
1. MORPH_API_KEY is set and valid
2. API connection works
3. Can list images and snapshots
4. Can create/start/stop instances (optional)

Usage:
    export MORPH_API_KEY="morph_xxx..."
    python scripts/test_morph_connection.py

Options:
    --full          Run full test including VM create/start/stop
    --snapshot ID   Test booting from specific snapshot
    --verbose       Show detailed output
"""

import os
import sys
import time
import argparse
from datetime import datetime

# Colors for terminal output
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color


def log_pass(msg):
    print(f"{Colors.GREEN}[PASS]{Colors.NC} {msg}")


def log_fail(msg):
    print(f"{Colors.RED}[FAIL]{Colors.NC} {msg}")


def log_info(msg):
    print(f"{Colors.BLUE}[INFO]{Colors.NC} {msg}")


def log_warn(msg):
    print(f"{Colors.YELLOW}[WARN]{Colors.NC} {msg}")


def test_api_key():
    """Test 1: Check MORPH_API_KEY environment variable."""
    print("\n--- Test 1: API Key Check ---")

    api_key = os.environ.get('MORPH_API_KEY')

    if not api_key:
        log_fail("MORPH_API_KEY environment variable not set")
        print("  Set it with: export MORPH_API_KEY='morph_xxx...'")
        return False

    if not api_key.startswith('morph_'):
        log_warn("API key does not start with 'morph_' - may be invalid")

    # Mask the API key for display
    masked = api_key[:10] + '...' + api_key[-4:] if len(api_key) > 20 else api_key[:5] + '...'
    log_pass(f"API key is set: {masked}")

    return True


def test_import():
    """Test 2: Check morphcloud package import."""
    print("\n--- Test 2: Package Import ---")

    try:
        import morphcloud
        log_pass("morphcloud package imported successfully")

        # Try to get version if available
        try:
            version = getattr(morphcloud, '__version__', 'unknown')
            log_info(f"Package version: {version}")
        except:
            pass

        return True
    except ImportError as e:
        log_fail(f"Failed to import morphcloud: {e}")
        print("  Install with: pip install morphcloud")
        return False


def test_connection(verbose=False):
    """Test 3: Test API connection."""
    print("\n--- Test 3: API Connection ---")

    try:
        from morphcloud.api import MorphCloudClient

        client = MorphCloudClient()
        log_pass("Client created successfully")

        return True, client
    except Exception as e:
        log_fail(f"Failed to create client: {e}")
        return False, None


def test_list_images(client, verbose=False):
    """Test 4: List available images."""
    print("\n--- Test 4: List Images ---")

    try:
        images = client.images.list()
        log_pass(f"Found {len(images)} images")

        if verbose and images:
            print("  Available images:")
            for img in images[:5]:
                img_id = getattr(img, 'id', str(img))
                print(f"    - {img_id}")
            if len(images) > 5:
                print(f"    ... and {len(images) - 5} more")

        # Check for morphvm-minimal specifically
        has_minimal = any(
            'minimal' in str(getattr(img, 'id', img)).lower()
            for img in images
        )
        if has_minimal:
            log_info("morphvm-minimal image available")
        else:
            log_warn("morphvm-minimal image not found in list")

        return True
    except Exception as e:
        log_fail(f"Failed to list images: {e}")
        return False


def test_list_snapshots(client, verbose=False):
    """Test 5: List snapshots."""
    print("\n--- Test 5: List Snapshots ---")

    try:
        snapshots = client.snapshots.list()
        log_pass(f"Found {len(snapshots)} snapshots")

        if verbose and snapshots:
            print("  Your snapshots:")
            for snap in snapshots[:5]:
                snap_id = getattr(snap, 'id', str(snap))
                digest = getattr(snap, 'digest', '')
                print(f"    - {snap_id}" + (f" ({digest})" if digest else ""))
            if len(snapshots) > 5:
                print(f"    ... and {len(snapshots) - 5} more")

        # Look for cmux devbox base snapshot
        cmux_snapshots = [
            s for s in snapshots
            if 'cmux' in str(getattr(s, 'digest', '')).lower()
        ]
        if cmux_snapshots:
            log_info(f"Found {len(cmux_snapshots)} cmux devbox snapshot(s)")
            for s in cmux_snapshots:
                print(f"    - {s.id}: {getattr(s, 'digest', 'no digest')}")

        return True
    except Exception as e:
        log_fail(f"Failed to list snapshots: {e}")
        return False


def test_list_instances(client, verbose=False):
    """Test 6: List running instances."""
    print("\n--- Test 6: List Instances ---")

    try:
        instances = client.instances.list()
        log_pass(f"Found {len(instances)} running instances")

        if verbose and instances:
            print("  Running instances:")
            for inst in instances[:5]:
                inst_id = getattr(inst, 'id', str(inst))
                status = getattr(inst, 'status', 'unknown')
                print(f"    - {inst_id} ({status})")

        return True
    except Exception as e:
        log_fail(f"Failed to list instances: {e}")
        return False


def test_boot_snapshot(client, snapshot_id, verbose=False):
    """Test 7: Boot from a snapshot (full test only)."""
    print(f"\n--- Test 7: Boot from Snapshot ---")
    print(f"  Snapshot: {snapshot_id}")

    instance = None
    try:
        log_info("Starting instance...")
        start_time = time.time()

        instance = client.instances.start(snapshot_id, ttl_seconds=300)

        # Wait for ready
        log_info("Waiting for instance to be ready...")
        instance.wait_until_ready()

        elapsed = time.time() - start_time
        log_pass(f"Instance started in {elapsed:.2f}s")
        log_info(f"Instance ID: {instance.id}")

        # Try to get instance info
        if verbose:
            try:
                # Check services
                log_info("Checking Chrome CDP...")
                result = instance.exec("curl -s http://localhost:9222/json/version 2>/dev/null | head -1")
                output = result.stdout if hasattr(result, 'stdout') else str(result)
                if 'Browser' in output:
                    log_pass("Chrome CDP is responding")
                else:
                    log_warn("Chrome CDP not responding")
            except Exception as e:
                log_warn(f"Could not check services: {e}")

        return True, instance
    except Exception as e:
        log_fail(f"Failed to boot snapshot: {e}")
        return False, instance


def test_stop_instance(client, instance, verbose=False):
    """Test 8: Stop an instance."""
    print("\n--- Test 8: Stop Instance ---")

    try:
        log_info(f"Stopping instance {instance.id}...")
        instance.stop()
        log_pass("Instance stopped successfully")
        return True
    except Exception as e:
        log_fail(f"Failed to stop instance: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Test Morph Cloud API connectivity')
    parser.add_argument('--full', action='store_true', help='Run full test including VM boot')
    parser.add_argument('--snapshot', type=str, help='Snapshot ID to test booting from')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show detailed output')
    args = parser.parse_args()

    print("=" * 60)
    print("       Morph Cloud API Connection Test")
    print("=" * 60)
    print(f"Started at: {datetime.now().isoformat()}")

    tests_passed = 0
    tests_total = 0
    instance = None

    # Test 1: API Key
    tests_total += 1
    if test_api_key():
        tests_passed += 1
    else:
        print("\nCannot continue without API key.")
        sys.exit(1)

    # Test 2: Import
    tests_total += 1
    if test_import():
        tests_passed += 1
    else:
        print("\nCannot continue without morphcloud package.")
        sys.exit(1)

    # Test 3: Connection
    tests_total += 1
    success, client = test_connection(args.verbose)
    if success:
        tests_passed += 1
    else:
        print("\nCannot continue without API connection.")
        sys.exit(1)

    # Test 4: List Images
    tests_total += 1
    if test_list_images(client, args.verbose):
        tests_passed += 1

    # Test 5: List Snapshots
    tests_total += 1
    if test_list_snapshots(client, args.verbose):
        tests_passed += 1

    # Test 6: List Instances
    tests_total += 1
    if test_list_instances(client, args.verbose):
        tests_passed += 1

    # Full tests (optional)
    if args.full or args.snapshot:
        # Determine snapshot to use
        snapshot_id = args.snapshot
        if not snapshot_id:
            # Try to find a cmux devbox snapshot
            snapshots = client.snapshots.list()
            cmux_snapshots = [
                s for s in snapshots
                if 'cmux' in str(getattr(s, 'digest', '')).lower()
            ]
            if cmux_snapshots:
                snapshot_id = cmux_snapshots[0].id
                log_info(f"Using cmux devbox snapshot: {snapshot_id}")
            elif snapshots:
                snapshot_id = snapshots[0].id
                log_info(f"Using first available snapshot: {snapshot_id}")
            else:
                log_warn("No snapshots available for boot test")

        if snapshot_id:
            # Test 7: Boot
            tests_total += 1
            success, instance = test_boot_snapshot(client, snapshot_id, args.verbose)
            if success:
                tests_passed += 1

                # Test 8: Stop
                tests_total += 1
                if test_stop_instance(client, instance, args.verbose):
                    tests_passed += 1
                    instance = None

    # Summary
    print("\n" + "=" * 60)
    all_passed = tests_passed == tests_total
    if all_passed:
        print(f"{Colors.GREEN}       All tests passed! ({tests_passed}/{tests_total}){Colors.NC}")
    else:
        print(f"{Colors.YELLOW}       Tests completed: {tests_passed}/{tests_total} passed{Colors.NC}")
    print("=" * 60)

    print(f"\nCompleted at: {datetime.now().isoformat()}")

    # Cleanup
    if instance is not None:
        try:
            log_info("Cleaning up: stopping instance...")
            instance.stop()
        except:
            pass

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()
