import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run GitHub monitor every minute (will check if enabled before running)
crons.interval(
  "github-monitor",
  { minutes: 1 },
  internal.githubMonitor.cronFetchAndPostPR
);

export default crons;
