#!/usr/bin/env bun

import "dotenv/config";

import process from "node:process";
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MorphCloudClient, type Instance } from "morphcloud";

const DAYS_5_SECONDS = 5 * 24 * 60 * 60;

type ConvexTaskRun = {
  _id: string;
  _creationTime: number;
  status: string;
  agentName?: string;
  teamId?: string;
  taskId?: string;
  vscode?: {
    containerName?: string;
    provider?: string;
    status?: string;
  };
};

type ConvexCodeReviewJob = {
  _id: string;
  _creationTime: number;
  state: string;
  sandboxInstanceId?: string;
  repoFullName?: string;
  prNumber?: number;
  teamId?: string;
};

type ConvexPreviewRun = {
  _id: string;
  _creationTime: number;
  status: string;
  sandboxInstanceId?: string;
  repoFullName?: string;
  prNumber?: number;
  teamId?: string;
};

function fetchConvexTable<T>(tableName: string): T[] {
  const tmpFile = join(tmpdir(), `convex-${tableName}-${Date.now()}.json`);
  try {
    // Use production deploy key and high limit, write to file to avoid stdout issues
    const deployKey = process.env.CONVEX_DEPLOY_KEY_PROD ??
      "prod:adorable-wombat-701|eyJ2MiI6IjA0NDQ3MDkwZjkzMDRjMTc4N2U1ODUxNzgxNGI0OWZjIn0=";
    execSync(
      `CONVEX_DEPLOY_KEY="${deployKey}" bunx convex data ${tableName} --format json --limit 10000 > "${tmpFile}"`,
      {
        encoding: "utf-8",
        maxBuffer: 200 * 1024 * 1024, // 200MB buffer
        shell: "/bin/bash",
        timeout: 120000,
      }
    );
    const content = readFileSync(tmpFile, "utf-8");
    const data = JSON.parse(content) as T[];
    return data;
  } catch (error) {
    console.error(`Failed to fetch ${tableName}:`, error instanceof Error ? error.message : error);
    return [];
  } finally {
    if (existsSync(tmpFile)) {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
    }
  }
}

function formatRelativeTime(timestampSeconds: number): string {
  const diffMs = Date.now() - timestampSeconds * 1000;
  const diffSeconds = Math.max(Math.floor(diffMs / 1000), 0);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

async function main(): Promise<void> {
  const key = process.env.MORPH_API_KEY;
  if (!key || key.trim() === "") {
    throw new Error("Missing required environment variable: MORPH_API_KEY");
  }

  // Fetch Morph instances
  console.log("Fetching Morph instances...");
  const morphClient = new MorphCloudClient();
  const allInstances = await morphClient.instances.list();

  const cutoffSeconds = Date.now() / 1000 - DAYS_5_SECONDS;
  const recentInstances = allInstances.filter(
    (instance) => instance.created >= cutoffSeconds,
  );

  // Filter for ttlAction=stop and ttlSeconds=null
  const stopNullInstances = recentInstances.filter((instance) => {
    const ttl = instance.ttl;
    const ttlAction = ttl?.ttlAction ?? "none";
    const ttlSeconds = ttl?.ttlSeconds;
    return ttlAction === "stop" && (ttlSeconds === null || ttlSeconds === undefined);
  });

  console.log(`Found ${stopNullInstances.length} instances with ttlAction=stop, ttlSeconds=null\n`);

  // Build a set of instance IDs for quick lookup
  const stopNullIds = new Set(stopNullInstances.map((i) => i.id));

  // Fetch Convex data
  console.log("Fetching Convex taskRuns...");
  const taskRuns = fetchConvexTable<ConvexTaskRun>("taskRuns");
  console.log(`  Found ${taskRuns.length} taskRuns`);

  console.log("Fetching Convex automatedCodeReviewJobs...");
  const codeReviewJobs = fetchConvexTable<ConvexCodeReviewJob>("automatedCodeReviewJobs");
  console.log(`  Found ${codeReviewJobs.length} automatedCodeReviewJobs`);

  console.log("Fetching Convex previewRuns...");
  const previewRuns = fetchConvexTable<ConvexPreviewRun>("previewRuns");
  console.log(`  Found ${previewRuns.length} previewRuns\n`);

  // Build maps from containerName/sandboxInstanceId to Convex records
  const taskRunsByContainer = new Map<string, ConvexTaskRun[]>();
  for (const run of taskRuns) {
    const containerName = run.vscode?.containerName;
    if (containerName) {
      const existing = taskRunsByContainer.get(containerName) ?? [];
      existing.push(run);
      taskRunsByContainer.set(containerName, existing);
    }
  }

  const codeReviewByInstance = new Map<string, ConvexCodeReviewJob[]>();
  for (const job of codeReviewJobs) {
    if (job.sandboxInstanceId) {
      const existing = codeReviewByInstance.get(job.sandboxInstanceId) ?? [];
      existing.push(job);
      codeReviewByInstance.set(job.sandboxInstanceId, existing);
    }
  }

  const previewByInstance = new Map<string, ConvexPreviewRun[]>();
  for (const run of previewRuns) {
    if (run.sandboxInstanceId) {
      const existing = previewByInstance.get(run.sandboxInstanceId) ?? [];
      existing.push(run);
      previewByInstance.set(run.sandboxInstanceId, existing);
    }
  }

  // Correlate
  const matched: {
    instance: Instance;
    taskRuns: ConvexTaskRun[];
    codeReviewJobs: ConvexCodeReviewJob[];
    previewRuns: ConvexPreviewRun[];
  }[] = [];

  const unmatched: Instance[] = [];

  for (const instance of stopNullInstances) {
    const trs = taskRunsByContainer.get(instance.id) ?? [];
    const crjs = codeReviewByInstance.get(instance.id) ?? [];
    const prs = previewByInstance.get(instance.id) ?? [];

    if (trs.length > 0 || crjs.length > 0 || prs.length > 0) {
      matched.push({ instance, taskRuns: trs, codeReviewJobs: crjs, previewRuns: prs });
    } else {
      unmatched.push(instance);
    }
  }

  // Report
  console.log("=".repeat(100));
  console.log(`MATCHED INSTANCES: ${matched.length}`);
  console.log("=".repeat(100));

  for (const { instance, taskRuns: trs, codeReviewJobs: crjs, previewRuns: prs } of matched) {
    const createdRel = formatRelativeTime(instance.created);
    console.log(`\n${instance.id} | status=${instance.status.toLowerCase()} | created=${createdRel}`);

    if (trs.length > 0) {
      console.log(`  taskRuns (${trs.length}):`);
      for (const tr of trs) {
        console.log(`    - ${tr._id} | status=${tr.status} | agent=${tr.agentName ?? "?"} | task=${tr.taskId ?? "?"}`);
      }
    }

    if (crjs.length > 0) {
      console.log(`  codeReviewJobs (${crjs.length}):`);
      for (const crj of crjs) {
        console.log(`    - ${crj._id} | state=${crj.state} | repo=${crj.repoFullName ?? "?"} | pr=${crj.prNumber ?? "?"}`);
      }
    }

    if (prs.length > 0) {
      console.log(`  previewRuns (${prs.length}):`);
      for (const pr of prs) {
        console.log(`    - ${pr._id} | status=${pr.status} | repo=${pr.repoFullName ?? "?"} | pr=${pr.prNumber ?? "?"}`);
      }
    }
  }

  console.log("\n" + "=".repeat(100));
  console.log(`UNMATCHED INSTANCES: ${unmatched.length}`);
  console.log("=".repeat(100));

  // Sort unmatched by creation time, newest first
  const sortedUnmatched = [...unmatched].sort((a, b) => b.created - a.created);
  for (const instance of sortedUnmatched) {
    const createdIso = new Date(instance.created * 1000).toISOString();
    const createdRel = formatRelativeTime(instance.created);
    console.log(`${instance.id} | status=${instance.status.toLowerCase()} | created=${createdIso} (${createdRel})`);
  }

  // Summary
  console.log("\n" + "=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  console.log(`Total stop/null instances (last 5 days): ${stopNullInstances.length}`);
  console.log(`Matched to Convex data: ${matched.length}`);
  console.log(`  - via taskRuns: ${matched.filter((m) => m.taskRuns.length > 0).length}`);
  console.log(`  - via codeReviewJobs: ${matched.filter((m) => m.codeReviewJobs.length > 0).length}`);
  console.log(`  - via previewRuns: ${matched.filter((m) => m.previewRuns.length > 0).length}`);
  console.log(`Unmatched (orphaned): ${unmatched.length}`);
}

main().catch((error) => {
  console.error("Failed:", error);
  process.exitCode = 1;
});
