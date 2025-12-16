#!/usr/bin/env bun

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { EVAL_DATASET } from "./dataset";
import { formatUnifiedDiffWithLineNumbers } from "../diff-utils";
import { loadOptionsFromEnv } from "../core/options";
import { resolveStrategy, AVAILABLE_STRATEGIES } from "../strategies";
import type {
  StrategyPrepareContext,
  StrategyProcessContext,
  StrategyRunResult,
} from "../core/types";

const DATA_DIR = join(process.cwd(), "apps/www/scripts/pr-review/evals/data");
const RESULTS_DIR = join(process.cwd(), "apps/www/scripts/pr-review/evals/results");

interface EvalResult {
  prId: string;
  strategyId: string;
  timestamp: string;
  prompt: string;
  response: string;
  annotations: StrategyRunResult["annotations"];
  artifacts: StrategyRunResult["artifacts"];
}

interface FileDiff {
  filePath: string;
  diffText: string;
}

function splitDiffIntoFiles(diff: string): FileDiff[] {
  const sections = diff.split(/\n(?=diff --git )/g);
  return sections
    .map((section) => {
      const trimmed = section.trim();
      if (!trimmed.startsWith("diff --git")) return null;
      const firstLine = trimmed.split("\n")[0] ?? "";
      const match = firstLine.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (!match) return null;
      const filePath = match[2];
      return { filePath, diffText: trimmed };
    })
    .filter((item): item is FileDiff => Boolean(item));
}

async function runEval(
  prId: string,
  strategyId: string,
  modelFn: (prompt: string) => Promise<string>
): Promise<void> {
  const pr = EVAL_DATASET.prs.find((p) => p.id === prId);
  if (!pr) {
    throw new Error(`PR ${prId} not found in dataset`);
  }

  console.log(`\nRunning eval: ${prId} with strategy ${strategyId}`);

  const diffPath = join(DATA_DIR, prId, "full.diff");
  const diffContent = await readFile(diffPath, "utf8");
  const fileDiffs = splitDiffIntoFiles(diffContent);

  const strategy = AVAILABLE_STRATEGIES.find((s) => s.id === strategyId);
  if (!strategy) {
    throw new Error(`Strategy ${strategyId} not found`);
  }

  const resultDir = join(RESULTS_DIR, prId, strategyId);
  await mkdir(resultDir, { recursive: true });

  const defaultArtifactMode =
    strategy.id === "inline-files"
      ? "per-file"
      : strategy.id.startsWith("inline-")
        ? "single"
        : "per-file";

  const optionsEnv = {
    ...process.env,
    CMUX_PR_REVIEW_STRATEGY: strategy.id,
    CMUX_PR_REVIEW_SHOW_DIFF_LINE_NUMBERS: "true",
    CMUX_PR_REVIEW_SHOW_CONTEXT_LINE_NUMBERS: "true",
    CMUX_PR_REVIEW_ARTIFACTS_DIR: join(resultDir, "artifacts"),
    CMUX_PR_REVIEW_DIFF_ARTIFACT_MODE: defaultArtifactMode,
  } satisfies NodeJS.ProcessEnv;
  const options = loadOptionsFromEnv(optionsEnv);
  const resolvedStrategy = resolveStrategy(options.strategy);

  const allResults: EvalResult[] = [];

  for (const fileDiff of fileDiffs) {
    console.log(`  Processing ${fileDiff.filePath}...`);

    const formattedDiff = formatUnifiedDiffWithLineNumbers(fileDiff.diffText, {
      showLineNumbers: options.showDiffLineNumbers,
      includeContextLineNumbers: options.showContextLineNumbers,
    });

    await mkdir(options.artifactsDir, { recursive: true });

    const persistArtifact = async (
      relativePath: string,
      content: string,
      persistOptions: { append?: boolean } = {}
    ) => {
      const targetPath = join(options.artifactsDir, relativePath);
      await mkdir(dirname(targetPath), { recursive: true });
      const payload = content.endsWith("\n") ? content : `${content}\n`;
      const writeOptions = persistOptions.append
        ? { flag: "a" as const }
        : undefined;
      await writeFile(targetPath, payload, writeOptions);
      return relativePath;
    };

    const log = (header: string, body: string) => {
      console.log(`    [${strategy.id}] ${header}: ${body.slice(0, 80)}...`);
    };

    const prepareContext: StrategyPrepareContext = {
      filePath: fileDiff.filePath,
      diff: fileDiff.diffText,
      formattedDiff,
      options,
      artifactsDir: options.artifactsDir,
      workspaceDir: options.workspaceDir,
      log,
      persistArtifact,
    };

    const prepareResult = await resolvedStrategy.prepare(prepareContext);

    const responseText = await modelFn(prepareResult.prompt);

    const processContext: StrategyProcessContext = {
      filePath: fileDiff.filePath,
      responseText,
      events: null,
      options,
      metadata: prepareResult.metadata,
      log,
      workspaceDir: options.workspaceDir,
      persistArtifact,
    };

    const result = await resolvedStrategy.process(processContext);

    const evalResult: EvalResult = {
      prId,
      strategyId: strategy.id,
      timestamp: new Date().toISOString(),
      prompt: prepareResult.prompt,
      response: result.rawResponse,
      annotations: result.annotations,
      artifacts: result.artifacts,
    };

    allResults.push(evalResult);

    const safeName = fileDiff.filePath.replace(/[^a-zA-Z0-9._-]/g, "_");
    await writeFile(
      join(resultDir, `${safeName}.result.json`),
      JSON.stringify(evalResult, null, 2)
    );
  }

  await writeFile(
    join(resultDir, "summary.json"),
    JSON.stringify(
      {
        prId,
        strategyId: strategy.id,
        timestamp: new Date().toISOString(),
        totalFiles: fileDiffs.length,
        totalAnnotations: allResults.reduce(
          (sum, r) => sum + (r.annotations?.length ?? 0),
          0
        ),
        results: allResults,
      },
      null,
      2
    )
  );

  console.log(`  ✓ Saved results to ${resultDir}/`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prId = args[0];
  const strategyId = args[1] ?? "line-numbers";

  if (!prId) {
    console.error("Usage: bun run evals/run-eval.ts <pr-id> [strategy-id]");
    console.error(`\nAvailable PRs: ${EVAL_DATASET.prs.map((p) => p.id).join(", ")}`);
    console.error(
      `Available strategies: ${AVAILABLE_STRATEGIES.map((s) => s.id).join(", ")}`
    );
    process.exit(1);
  }

  const mockModelFn = async (_prompt: string): Promise<string> => {
    console.log("    [MOCK] Using synthetic model response");
    return JSON.stringify({
      lines: [
        {
          lineNumber: 1,
          shouldBeReviewedScore: 0.7,
          shouldReviewWhy: "Mock review comment",
          mostImportantWord: "mock",
        },
      ],
    });
  };

  await runEval(prId, strategyId, mockModelFn);
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
