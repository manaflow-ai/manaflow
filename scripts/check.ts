#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { join } from "node:path";

const quiet = !!process.env.CLAUDECODE;

// Run precheck (generate-openapi-client) - failures are non-fatal
async function runPrecheck(repoRoot: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn("bun", ["run", "--silent", "generate-openapi-client"], {
      cwd: repoRoot,
      shell: true,
      stdio: quiet ? "ignore" : "inherit",
    });
    child.on("close", () => resolve());
    child.on("error", () => resolve());
  });
}

type CheckResult = {
  name: string;
  success: boolean;
  output: string;
  durationMs: number;
};

function runCommand(
  cmd: string,
  args: string[],
  cwd: string,
  name: string
): Promise<CheckResult> {
  const startTime = performance.now();
  const child = spawn(cmd, args, { cwd, shell: true });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d) => (stdout += String(d)));
  child.stderr?.on("data", (d) => (stderr += String(d)));

  return new Promise((resolve) => {
    child.on("close", (code) => {
      resolve({
        name,
        success: code === 0,
        output: (stdout + stderr).trim(),
        durationMs: performance.now() - startTime,
      });
    });
    child.on("error", (err) => {
      resolve({
        name,
        success: false,
        output: err.message,
        durationMs: performance.now() - startTime,
      });
    });
  });
}

async function main() {
  const repoRoot = join(__dirname, "..");

  // Run precheck first (non-fatal)
  await runPrecheck(repoRoot);

  const startTime = performance.now();
  if (!quiet) console.log("Running lint + typecheck in parallel...\n");

  // Run lint + single tsgo --build in parallel
  const [lintResult, typecheckResult] = await Promise.all([
    runCommand("bunx", ["eslint", "."], repoRoot, "lint"),
    runCommand("bunx", ["tsgo", "--build", "--noEmit"], repoRoot, "typecheck"),
  ]);

  // Report failures
  let hasFailures = false;

  if (!lintResult.success) {
    hasFailures = true;
    console.log("❌ Lint failed:\n");
    console.log(lintResult.output.replace(/^/gm, "  "));
    console.log();
  }

  if (!typecheckResult.success) {
    hasFailures = true;
    console.log("❌ Typecheck failed:\n");
    console.log(typecheckResult.output.replace(/^/gm, "  "));
    console.log();
  }

  if (hasFailures) {
    process.exit(1);
  }

  // Print timing summary (only in verbose mode)
  if (!quiet) {
    const results = [lintResult, typecheckResult];
    console.log("⏱  Timings:\n");
    for (const r of results.sort((a, b) => b.durationMs - a.durationMs)) {
      const status = r.success ? "✓" : "✗";
      const duration = (r.durationMs / 1000).toFixed(2);
      console.log(`  ${status} ${r.name.padEnd(10)}  ${duration}s`);
    }

    const totalTime = performance.now() - startTime;
    console.log(`\n  Total: ${(totalTime / 1000).toFixed(2)}s\n`);
  }

  console.log("✅ Lint and typecheck passed");
}

main().catch((err) => {
  console.error("check.ts failed:", err);
  process.exit(1);
});
