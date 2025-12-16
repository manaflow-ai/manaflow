## Living plan

### Active: 80/20 PR heatmap experiment
- Goal: produce a quick local-only PR review flow that never provisions Morph VMs or Docker containers.
- Output: per-file “heatmap” JSON generated via the Vercel AI SDK (`generateObject`) using the schema  
  `{ lines: { line: string, hasChanged: boolean, shouldBeReviewedScore?: boolean, shouldReviewWhy?: string, mostImportantCharacterIndex: number }[] }`.
- Constraints: run entirely on the caller’s machine, reuse existing git diff info, parallelize the AI calls for speed, keep prompts simple (focus on changed lines + context).
- Next steps:
  1. Build a CLI that shells out to `git diff` (configurable base, default `origin/main`) and prepares prompts for each touched file.
  2. Wire the CLI to `generateObject` (OpenAI via Vercel AI SDK for now), fan out the calls with a small concurrency limit (≈3) and collect results.
  3. Emit structured artifacts (pretty JSON per file + combined summary) so the UI can later visualize the heatmap.

### Backlog / future launches
- linear interface for main thing
- launch 1: “vercel preview environments”
  - vercel comments pill that pipes directly to claude code
- launch 2: after all coding clis are done running, we spin up operator to test the changes and take screenshots to make it easy to verify stuff
  - launch 3: swift app
- code review
  - swipe left or swipe right (order of changes)..
  - merge queue...?
- code review agent that spins up operator to click around and take screenshots and then posts it back to the PR we're reviewing
