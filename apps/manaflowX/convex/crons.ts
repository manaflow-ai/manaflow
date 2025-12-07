import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run GitHub monitor every minute (will check if enabled before running)
crons.interval(
  "github-monitor",
  { minutes: 1 },
  internal.githubMonitor.cronFetchAndPostPR
);

// Run curator every minute to surface interesting posts
crons.interval("curator", { minutes: 1 }, internal.curator.runCurator);

// Run tweet feed every minute to import interesting X/Twitter content
crons.interval("tweet-feed", { minutes: 1 }, internal.tweetFeed.runTweetFeed);

export default crons;
