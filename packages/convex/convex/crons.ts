import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sandbox instance lifecycle maintenance (all providers: morph, pve-lxc, docker, daytona)
// Runs daily at 21:00 UTC (5 AM HKT)
crons.daily(
  "pause old sandbox instances",
  { hourUTC: 21, minuteUTC: 0 },
  internal.sandboxInstanceMaintenance.pauseOldSandboxInstances
);

// Stop inactive sandbox instances (paused for >7 days)
// Runs daily at 21:20 UTC (5:20 AM HKT)
crons.daily(
  "stop old sandbox instances",
  { hourUTC: 21, minuteUTC: 20 },
  internal.sandboxInstanceMaintenance.stopOldSandboxInstances
);

// Clean up orphaned containers (exist in provider but not in Convex)
// Runs daily at 21:40 UTC (5:40 AM HKT)
crons.daily(
  "cleanup orphaned containers",
  { hourUTC: 21, minuteUTC: 40 },
  internal.sandboxInstanceMaintenance.cleanupOrphanedContainers
);

// Clean up orphaned PVE templates daily at 22:00 UTC
crons.daily(
  "cleanup orphaned pve templates",
  { hourUTC: 22, minuteUTC: 0 },
  internal.sandboxInstanceMaintenance.cleanupOrphanedPveTemplates
);

// Recover crown evaluations stuck in pending/in_progress state
// Runs every hour to detect evaluations that failed without proper error handling
crons.interval(
  "recover stuck crown evaluations",
  { hours: 1 },
  internal.crown.recoverStuckEvaluations
);

// Auto-refresh crown evaluations that succeeded with empty diffs
// Runs every hour to re-evaluate when fresh diffs may be available from GitHub
crons.interval(
  "auto-refresh empty diff evaluations",
  { hours: 1 },
  internal.crown.autoRefreshEmptyDiffEvaluations
);

// Recover tasks where all runs completed but no crown evaluation was created
// This handles cases where worker completion flow was interrupted
// Runs every hour to detect and auto-evaluate via GitHub API
crons.interval(
  "recover missing crown evaluations",
  { hours: 1 },
  internal.crown.recoverMissingEvaluations
);

// Clean up stale warm pool entries daily at 11:30 UTC
crons.daily(
  "cleanup warm pool",
  { hourUTC: 11, minuteUTC: 30 },
  internal.warmPoolMaintenance.cleanupWarmPool
);

export default crons;
