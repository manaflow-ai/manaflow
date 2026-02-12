import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Pause Morph instances older than 20 hours
// Runs daily at 4 AM Pacific Time
// 4 AM PST = 12:00 UTC (during standard time)
// 4 AM PDT = 11:00 UTC (during daylight saving)
// Using 12:00 UTC means it runs at 4 AM PST or 5 AM PDT
crons.daily(
  "pause old morph instances",
  { hourUTC: 12, minuteUTC: 0 },
  internal.morphInstanceMaintenance.pauseOldMorphInstances
);

// Stop (delete) Morph instances that have been paused for more than 2 weeks
// Runs daily at 13:00 UTC (~5-6 AM Pacific depending on DST)
crons.daily(
  "stop old morph instances",
  { hourUTC: 13, minuteUTC: 0 },
  internal.morphInstanceMaintenance.stopOldMorphInstances
);

// Clean up stale warm pool entries daily at 11:30 UTC
crons.daily(
  "cleanup warm pool",
  { hourUTC: 11, minuteUTC: 30 },
  internal.warmPoolMaintenance.cleanupWarmPool
);

export default crons;
