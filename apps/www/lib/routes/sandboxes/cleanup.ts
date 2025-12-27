/**
 * Commands to clean up the VM before snapshotting/freezing/pausing.
 *
 * IMPORTANT: We must kill all user processes (especially dev servers) to avoid
 * port conflicts when the VM is restored.
 */

/**
 * Common dev server ports to force-kill processes on.
 * This is a safeguard in case process name matching misses something.
 */
const DEV_PORTS = [3000, 3001, 3002, 3003, 4000, 5000, 5173, 5174, 8000, 8080, 8888];

/**
 * PTY server URL - used to kill terminal sessions
 */
const PTY_SERVER_URL = "http://localhost:39383";

export const VM_CLEANUP_COMMANDS = [
  // Step 1: Kill all PTY sessions via cmux-pty server (VS Code terminals)
  // Get all session PIDs and kill them, then delete the sessions
  `for pid in $(curl -sf ${PTY_SERVER_URL}/sessions 2>/dev/null | jq -r '.sessions[].pid' 2>/dev/null); do kill -9 $pid 2>/dev/null; done || true`,
  `curl -sf ${PTY_SERVER_URL}/sessions 2>/dev/null | jq -r '.sessions[].id' 2>/dev/null | xargs -I {} curl -sf -X DELETE ${PTY_SERVER_URL}/sessions/{} 2>/dev/null || true`,
  // Step 2: Kill all processes running in tmux panes (fallback for tmux backend)
  "for pid in $(tmux list-panes -a -F '#{pane_pid}' 2>/dev/null); do pkill -9 -P $pid 2>/dev/null; kill -9 $pid 2>/dev/null; done || true",
  "tmux kill-server 2>/dev/null || true",
  // Step 3: Kill any remaining dev processes by name
  "pkill -9 -u root node 2>/dev/null || true",
  "pkill -9 -u root bun 2>/dev/null || true",
  "pkill -9 -u root vite 2>/dev/null || true",
  "pkill -9 -u root esbuild 2>/dev/null || true",
  "pkill -9 -u root next 2>/dev/null || true",
  "pkill -9 -u root python 2>/dev/null || true",
  "pkill -9 -u root python3 2>/dev/null || true",
  // Step 4: Nuclear option - kill ANY process listening on common dev ports
  ...DEV_PORTS.map((port) => `fuser -k ${port}/tcp 2>/dev/null || true`),
].join(" && ");

/**
 * Commands to clean up credentials before snapshotting.
 * These are separate from process cleanup since they're only needed for snapshots,
 * not for regular pause operations.
 */
export const CREDENTIAL_CLEANUP_COMMANDS = [
  "git config --global --unset user.name 2>/dev/null || true",
  "git config --global --unset user.email 2>/dev/null || true",
  "git config --global --unset credential.helper 2>/dev/null || true",
  "git credential-cache exit 2>/dev/null || true",
  "gh auth logout 2>/dev/null || true",
].join(" && ");

/**
 * Full cleanup commands for snapshotting (processes + credentials).
 */
export const SNAPSHOT_CLEANUP_COMMANDS = `${VM_CLEANUP_COMMANDS} && ${CREDENTIAL_CLEANUP_COMMANDS}`;
