import { cronJobs } from "convex/server";
// import { internal } from "./_generated/api";

const crons = cronJobs();

// =============================================================================
// TEMPORARY DEPRECATION: All crons disabled.
// To restore: uncomment the import above and all cron registrations below.
// Search for "MANAFLOW_DEPRECATED" across the repo to find all references.
// =============================================================================

// Pause Morph instances older than 20 hours
// Runs daily at 4 AM Pacific Time
// crons.daily(
//   "pause old morph instances",
//   { hourUTC: 12, minuteUTC: 0 },
//   internal.morphInstanceMaintenance.pauseOldMorphInstances
// );

// Stop (delete) Morph instances that have been paused for more than 2 weeks
// Runs daily at 13:00 UTC (~5-6 AM Pacific depending on DST)
// crons.daily(
//   "stop old morph instances",
//   { hourUTC: 13, minuteUTC: 0 },
//   internal.morphInstanceMaintenance.stopOldMorphInstances
// );

// Clean up stale warm pool entries daily at 11:30 UTC
// crons.daily(
//   "cleanup warm pool",
//   { hourUTC: 11, minuteUTC: 30 },
//   internal.warmPoolMaintenance.cleanupWarmPool
// );

export default crons;
