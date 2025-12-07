// Next.js instrumentation - runs on server startup
// This sets up polling to process open issues from Convex

export async function register() {
  // Only run on the server, not during build
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startIssueSolverPolling } = await import("@/lib/issue-solver-polling");
    startIssueSolverPolling();
  }
}
