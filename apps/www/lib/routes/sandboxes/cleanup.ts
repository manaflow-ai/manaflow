/**
 * Commands to clean up the VM before snapshotting/freezing/pausing.
 *
 * IMPORTANT: We must kill all user processes (especially dev servers) to avoid
 * port conflicts when the VM is restored. Simply killing tmux doesn't kill child processes.
 */
export const VM_CLEANUP_COMMANDS = [
  // First, gracefully stop all processes in tmux sessions
  "tmux kill-session -t cmux 2>/dev/null || true",
  "tmux kill-server 2>/dev/null || true",
  // Kill all node/bun processes (dev servers) - these are the main culprits for port conflicts
  "pkill -9 -u root node 2>/dev/null || true",
  "pkill -9 -u root bun 2>/dev/null || true",
  // Kill any remaining processes that might be holding ports (vite, esbuild, etc.)
  "pkill -9 -u root vite 2>/dev/null || true",
  "pkill -9 -u root esbuild 2>/dev/null || true",
  "pkill -9 -u root tsx 2>/dev/null || true",
  "pkill -9 -u root npx 2>/dev/null || true",
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
