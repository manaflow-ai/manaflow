#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "morphcloud",
# ]
# ///
"""
scripts/create_base_snapshot.py

Creates the CMUX base snapshot in Morph Cloud.

This script:
1. Creates a VM from the morphvm-minimal image
2. Uploads and runs the setup script
3. Verifies all services are working
4. Saves the VM as a reusable snapshot
5. Auto-updates DEFAULT_CMUX_SNAPSHOT_ID in packages/convex/convex/dba_http.ts
6. Outputs the snapshot ID for configuration

Requirements:
- MORPH_API_KEY environment variable
- morphcloud Python package: pip install morphcloud
- setup_base_snapshot.sh in the same directory

Usage:
    export MORPH_API_KEY="morph_xxx..."
    python scripts/create_base_snapshot.py

Options:
    --dry-run       Show what would be done without executing
    --skip-verify   Skip service verification after setup
    --digest NAME   Custom digest name for the snapshot (default: cmux-base-v1)
    --vcpus N       Number of vCPUs (default: 2)
    --memory MB     Memory in MB (default: 4096)
    --disk GB       Disk size in GB (default: 32)
"""

import os
import sys
import time
import argparse
import json
import re
from pathlib import Path
from datetime import datetime

# Path to dba_http.ts where DEFAULT_CMUX_SNAPSHOT_ID is defined
CMUX_HTTP_PATH = Path(__file__).resolve().parent.parent.parent.parent / "packages/convex/convex/dba_http.ts"

# Colors for terminal output
class Colors:
    RED = '\033[0;31m'
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    NC = '\033[0m'  # No Color

def log_info(msg):
    print(f"{Colors.GREEN}[INFO]{Colors.NC} {msg}")

def log_warn(msg):
    print(f"{Colors.YELLOW}[WARN]{Colors.NC} {msg}")

def log_error(msg):
    print(f"{Colors.RED}[ERROR]{Colors.NC} {msg}")

def log_step(step_num, total, msg):
    print(f"\n{Colors.BLUE}=== Step {step_num}/{total}: {msg} ==={Colors.NC}")


def check_requirements():
    """Check all requirements are met before proceeding."""
    errors = []

    # Check MORPH_API_KEY
    api_key = os.environ.get('MORPH_API_KEY')
    if not api_key:
        errors.append("MORPH_API_KEY environment variable not set")
    elif not api_key.startswith('morph_'):
        errors.append("MORPH_API_KEY should start with 'morph_'")

    # Check morphcloud package
    try:
        import morphcloud
        log_info("morphcloud package found")
    except ImportError:
        errors.append("morphcloud not installed. Run: pip install morphcloud")

    # Check setup script exists
    script_path = Path(__file__).parent / 'setup_base_snapshot.sh'
    if not script_path.exists():
        errors.append(f"Setup script not found: {script_path}")
    else:
        log_info(f"Setup script found: {script_path}")

    if errors:
        for error in errors:
            log_error(error)
        return False

    return True


def wait_for_instance_ready(instance, timeout=300):
    """Wait for instance to be ready with timeout and progress indicator."""
    log_info(f"Waiting for instance {instance.id} to be ready (timeout: {timeout}s)...")
    start_time = time.time()

    try:
        # Use the built-in wait_until_ready with periodic status updates
        import threading

        def status_printer():
            while not stop_event.is_set():
                elapsed = time.time() - start_time
                print(f"\r  Waiting... ({elapsed:.0f}s elapsed)", end="", flush=True)
                time.sleep(5)

        stop_event = threading.Event()
        printer = threading.Thread(target=status_printer, daemon=True)
        printer.start()

        instance.wait_until_ready(timeout=timeout)

        stop_event.set()
        printer.join(timeout=1)
        print()  # newline

        elapsed = time.time() - start_time
        log_info(f"Instance ready after {elapsed:.1f}s (status: {instance.status})")
        return True
    except Exception as e:
        stop_event.set()
        print()
        elapsed = time.time() - start_time
        log_error(f"Instance not ready after {elapsed:.1f}s: {e}")
        return False


def run_setup_script(instance, script_path):
    """Upload and run the setup script on the instance with progress logging."""
    import base64

    log_info("Reading setup script...")
    with open(script_path, 'r') as f:
        script_content = f.read()

    # Upload script using base64 to avoid heredoc conflicts
    log_info("Uploading setup script to VM...")
    script_b64 = base64.b64encode(script_content.encode()).decode()
    instance.exec(f"echo '{script_b64}' | base64 -d > /tmp/setup_base_snapshot.sh")
    instance.exec("chmod +x /tmp/setup_base_snapshot.sh")

    # Run the script in background and tail output for real-time feedback
    log_info("Running setup script (this will take 10-15 minutes)...")
    log_info("Streaming output in real-time...")
    print("-" * 60)

    # Start script in background, writing to log file
    instance.exec("nohup bash /tmp/setup_base_snapshot.sh > /tmp/setup.log 2>&1 &")

    # Poll for completion and stream output
    import time
    last_line = 0
    max_wait = 900  # 15 minutes max
    start_time = time.time()

    while time.time() - start_time < max_wait:
        # Check if script is still running
        ps_result = instance.exec("pgrep -f setup_base_snapshot.sh || echo 'DONE'")
        ps_out = ps_result.stdout if hasattr(ps_result, 'stdout') else str(ps_result)

        # Get new log lines
        tail_result = instance.exec(f"tail -n +{last_line + 1} /tmp/setup.log 2>/dev/null | head -100")
        tail_out = tail_result.stdout if hasattr(tail_result, 'stdout') else str(tail_result)

        if tail_out.strip():
            lines = tail_out.strip().split('\n')
            for line in lines:
                # Print step markers prominently
                if '===' in line or '[INFO]' in line or '[OK]' in line or '[FAIL]' in line:
                    print(line)
                elif 'Step' in line:
                    print(f"\n{Colors.BLUE}{line}{Colors.NC}")
            last_line += len(lines)

        if 'DONE' in ps_out:
            # Script finished, get any remaining output
            final_result = instance.exec(f"tail -n +{last_line + 1} /tmp/setup.log 2>/dev/null")
            final_out = final_result.stdout if hasattr(final_result, 'stdout') else str(final_result)
            if final_out.strip():
                print(final_out)
            break

        time.sleep(5)  # Check every 5 seconds

    print("-" * 60)

    # Check for the marker file
    check_result = instance.exec("cat /dba_base_snapshot_valid 2>/dev/null && echo 'VALID' || echo 'INVALID'")
    output = check_result.stdout if hasattr(check_result, 'stdout') else str(check_result)

    if 'VALID' in output:
        log_info("Setup script completed successfully")
        return True
    else:
        log_error("Setup script may have failed - marker file not found")
        # Show last 50 lines of log for debugging
        debug_result = instance.exec("tail -50 /tmp/setup.log 2>/dev/null")
        debug_out = debug_result.stdout if hasattr(debug_result, 'stdout') else str(debug_result)
        print(f"\nLast 50 lines of setup log:\n{debug_out}")
        return False


def verify_services(instance):
    """Verify all CMUX services are running correctly."""
    log_info("Verifying services...")

    services = {
        'vncserver': 'systemctl is-active vncserver',
        'xfce-session': 'systemctl is-active xfce-session',
        'chrome-cdp': 'systemctl is-active chrome-cdp',
        'novnc': 'systemctl is-active novnc',
        'openvscode': 'systemctl is-active openvscode',
        'nginx': 'systemctl is-active nginx',
        'docker': 'systemctl is-active docker',
    }

    ports = {
        'VNC (5901)': 'nc -z localhost 5901 && echo "open" || echo "closed"',
        'noVNC (6080)': 'nc -z localhost 6080 && echo "open" || echo "closed"',
        'Chrome CDP (9222)': 'nc -z localhost 9222 && echo "open" || echo "closed"',
        'openvscode (10080)': 'nc -z localhost 10080 && echo "open" || echo "closed"',
        'nginx (80)': 'nc -z localhost 80 && echo "open" || echo "closed"',
    }

    all_ok = True

    print("\nService Status:")
    for name, cmd in services.items():
        result = instance.exec(cmd)
        output = result.stdout.strip() if hasattr(result, 'stdout') else str(result).strip()
        if output == 'active':
            print(f"  {Colors.GREEN}[OK]{Colors.NC} {name}")
        else:
            print(f"  {Colors.RED}[FAIL]{Colors.NC} {name} ({output})")
            all_ok = False

    print("\nPort Status:")
    for name, cmd in ports.items():
        result = instance.exec(cmd)
        output = result.stdout.strip() if hasattr(result, 'stdout') else str(result).strip()
        if 'open' in output:
            print(f"  {Colors.GREEN}[OK]{Colors.NC} {name}")
        else:
            print(f"  {Colors.RED}[FAIL]{Colors.NC} {name}")
            all_ok = False

    # Check Chrome CDP specifically
    print("\nChrome CDP Check:")
    result = instance.exec('curl -s http://localhost:9222/json/version 2>/dev/null || echo "FAILED"')
    output = result.stdout if hasattr(result, 'stdout') else str(result)
    if 'Browser' in output:
        try:
            data = json.loads(output)
            print(f"  {Colors.GREEN}[OK]{Colors.NC} Chrome: {data.get('Browser', 'Unknown')}")
        except:
            print(f"  {Colors.GREEN}[OK]{Colors.NC} Chrome CDP responding")
    else:
        print(f"  {Colors.RED}[FAIL]{Colors.NC} Chrome CDP not responding")
        all_ok = False

    # Check Docker specifically
    print("\nDocker Check:")
    result = instance.exec('docker --version 2>/dev/null || echo "FAILED"')
    output = result.stdout if hasattr(result, 'stdout') else str(result)
    if 'Docker version' in output:
        print(f"  {Colors.GREEN}[OK]{Colors.NC} {output.strip()}")
    else:
        print(f"  {Colors.RED}[FAIL]{Colors.NC} Docker not responding")
        all_ok = False

    return all_ok


def find_existing_snapshot(client, digest):
    """Find an existing snapshot by digest."""
    try:
        snapshots = client.snapshots.list()
        for snap in snapshots:
            if hasattr(snap, 'digest') and snap.digest == digest:
                return snap
        return None
    except Exception as e:
        log_warn(f"Could not search for existing snapshots: {e}")
        return None


def update_dba_http_snapshot_id(snapshot_id):
    """Update the DEFAULT_CMUX_SNAPSHOT_ID in dba_http.ts."""
    if not CMUX_HTTP_PATH.exists():
        log_warn(f"dba_http.ts not found at {CMUX_HTTP_PATH}, skipping auto-update")
        return False

    content = CMUX_HTTP_PATH.read_text()

    # Pattern to match: const DEFAULT_CMUX_SNAPSHOT_ID = "snapshot_xxx";
    pattern = r'const DEFAULT_CMUX_SNAPSHOT_ID = "snapshot_[^"]+";'
    replacement = f'const DEFAULT_CMUX_SNAPSHOT_ID = "{snapshot_id}";'

    new_content, count = re.subn(pattern, replacement, content)

    if count == 0:
        log_warn("Could not find DEFAULT_CMUX_SNAPSHOT_ID in dba_http.ts")
        return False

    CMUX_HTTP_PATH.write_text(new_content)
    log_info(f"Updated DEFAULT_CMUX_SNAPSHOT_ID in {CMUX_HTTP_PATH}")
    return True


def main():
    parser = argparse.ArgumentParser(description='Create CMUX base snapshot in Morph Cloud')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done')
    parser.add_argument('--skip-verify', action='store_true', help='Skip service verification')
    parser.add_argument('--rebuild', action='store_true', help='Force rebuild from scratch (ignore existing snapshot)')
    parser.add_argument('--digest', default='cmux-base-v1', help='Snapshot digest name')
    parser.add_argument('--vcpus', type=int, default=4, help='Number of vCPUs')
    parser.add_argument('--memory', type=int, default=4096, help='Memory in MB')
    parser.add_argument('--disk', type=int, default=32, help='Disk size in GB')
    args = parser.parse_args()

    print("=" * 60)
    print("       CMUX Base Snapshot Creator")
    print("=" * 60)
    print(f"\nStarted at: {datetime.now().isoformat()}")
    print(f"Configuration:")
    print(f"  Digest: {args.digest}")
    print(f"  vCPUs: {args.vcpus}")
    print(f"  Memory: {args.memory} MB")
    print(f"  Disk: {args.disk} GB")
    print()

    # Step 1: Check requirements
    log_step(1, 6, "Checking requirements")
    if not check_requirements():
        sys.exit(1)

    if args.dry_run:
        log_info("Dry run mode - would create snapshot with above configuration")
        sys.exit(0)

    # Import morphcloud after checking requirements
    from morphcloud.api import MorphCloudClient

    client = MorphCloudClient()
    instance = None
    use_existing = False
    existing_snapshot = None

    try:
        # Step 2: Check for existing snapshot or create new VM
        log_step(2, 6, "Preparing VM")

        if not args.rebuild:
            log_info(f"Checking for existing snapshot with digest '{args.digest}'...")
            existing_snapshot = find_existing_snapshot(client, args.digest)

            if existing_snapshot:
                log_info(f"Found existing snapshot: {existing_snapshot.id}")
                log_info("Starting from existing snapshot (use --rebuild to force fresh build)")
                use_existing = True

        if use_existing and existing_snapshot:
            log_info("Starting instance from existing snapshot...")
            instance = client.instances.start(existing_snapshot.id, ttl_seconds=7200)
        else:
            log_info("Creating new snapshot from morphvm-minimal (this takes longer)...")
            snapshot = client.snapshots.create(
                image_id="morphvm-minimal",
                vcpus=args.vcpus,
                memory=args.memory,
                disk_size=args.disk * 1024  # Convert GB to MB
            )
            log_info(f"Initial snapshot created: {snapshot.id}")

            log_info("Starting instance from snapshot...")
            instance = client.instances.start(snapshot.id, ttl_seconds=7200)  # 2 hour TTL

        if not wait_for_instance_ready(instance):
            log_error("Failed to start instance")
            sys.exit(1)

        log_info(f"Instance started: {instance.id}")

        # Step 3: Upload and run setup script (skip if using existing snapshot)
        log_step(3, 6, "Running setup script")

        if use_existing:
            log_info("Skipping setup script (using existing snapshot)")
            log_info("Just restarting services to ensure they're running...")
            instance.exec("systemctl restart vncserver xfce-session chrome-cdp novnc openvscode nginx cmux-worker 2>/dev/null || true")
        else:
            script_path = Path(__file__).parent / 'setup_base_snapshot.sh'
            if not run_setup_script(instance, script_path):
                log_warn("Setup script reported issues, continuing anyway...")

        # Step 4: Verify services
        log_step(4, 6, "Verifying services")

        if args.skip_verify:
            log_info("Skipping verification (--skip-verify)")
        else:
            # Wait for services to stabilize (longer for fresh builds)
            wait_time = 15 if use_existing else 30
            log_info(f"Waiting {wait_time} seconds for services to stabilize...")
            time.sleep(wait_time)

            if not verify_services(instance):
                log_warn("Some services failed verification - continuing anyway")
                log_warn("Services may need more time to start after snapshot restore")

        # Step 5: Save as snapshot
        log_step(5, 6, "Saving snapshot")

        log_info(f"Creating snapshot with digest: {args.digest}")
        base_snapshot = instance.snapshot(digest=args.digest)
        log_info(f"Snapshot created: {base_snapshot.id}")

        # Update dba_http.ts with the new snapshot ID
        log_info("Updating default snapshot ID in dba_http.ts...")
        if update_dba_http_snapshot_id(base_snapshot.id):
            log_info(f"Successfully updated DEFAULT_CMUX_SNAPSHOT_ID to {base_snapshot.id}")
        else:
            log_warn("Failed to update dba_http.ts - manual update may be required")

        # Step 6: Cleanup and output
        log_step(6, 6, "Cleanup and summary")

        log_info("Stopping instance...")
        instance.stop()
        instance = None

        # Output results
        print("\n" + "=" * 60)
        print(f"{Colors.GREEN}       SUCCESS!{Colors.NC}")
        print("=" * 60)
        print()
        print(f"Base Snapshot ID: {base_snapshot.id}")
        print(f"Digest: {args.digest}")
        print()
        print("To use this snapshot:")
        print("  1. Add to your config:")
        print(f'     morph:')
        print(f'       base_snapshot_id: "{base_snapshot.id}"')
        print()
        print("  2. Or set environment variable:")
        print(f'     export CMUX_BASE_SNAPSHOT="{base_snapshot.id}"')
        print()
        print("To test the snapshot:")
        print(f"  python -c \"")
        print(f"from morphcloud.api import MorphCloudClient")
        print(f"c = MorphCloudClient()")
        print(f"i = c.instances.start('{base_snapshot.id}', ttl_seconds=300)")
        print(f"i.wait_until_ready()")
        print(f"print('Instance:', i.id)")
        print(f"i.stop()\"")
        print()

        # Save snapshot info to file
        info_file = Path(__file__).parent / 'SNAPSHOT_INFO.txt'
        with open(info_file, 'w') as f:
            f.write("CMUX Base Snapshot Information\n")
            f.write("=" * 40 + "\n")
            f.write(f"Created: {datetime.now().isoformat()}\n")
            f.write(f"Snapshot ID: {base_snapshot.id}\n")
            f.write(f"Digest: {args.digest}\n")
            f.write(f"Image Base: morphvm-minimal\n")
            f.write(f"Resources: {args.vcpus} vCPU, {args.memory}MB RAM, {args.disk}GB disk\n")
            f.write("\n")
            f.write("Services Included:\n")
            f.write("- Chrome with CDP (port 9222)\n")
            f.write("- TigerVNC (port 5901)\n")
            f.write("- noVNC (port 6080)\n")
            f.write("- OpenVSCode Server (port 10080)\n")
            f.write("- nginx (port 80)\n")
            f.write("- Docker (docker-ce, docker-compose)\n")
            f.write("- Devbox/Nix\n")

        log_info(f"Snapshot info saved to: {info_file}")

        print(f"\nCompleted at: {datetime.now().isoformat()}")

    except KeyboardInterrupt:
        log_warn("\nInterrupted by user")
        sys.exit(1)
    except Exception as e:
        log_error(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Cleanup: stop instance if still running
        if instance is not None:
            try:
                log_info("Cleaning up: stopping instance...")
                instance.stop()
            except:
                pass


if __name__ == "__main__":
    main()
