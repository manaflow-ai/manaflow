# PR Review Evals

Evaluation framework for testing PR review strategies against a curated dataset of real-world pull requests.

## Quick Start

```bash
# 1. Sync all PRs from the dataset (fetches diffs, metadata)
bun run apps/www/scripts/pr-review/evals/sync-dataset.ts

# 2. Inspect a PR
bun run apps/www/scripts/pr-review/evals/inspect.ts <pr-id>

# 3. Run eval on a PR with a strategy
bun run apps/www/scripts/pr-review/evals/run-eval.ts <pr-id> [strategy-id]
```

## Dataset Overview

The dataset contains 7 curated PRs covering diverse languages and issue types, with **75-869 lines of pure code changes** (no lock files or significant docs):

| ID | Language | Files | Lines | Code % | Description |
|---|---|---|---|---|---|
| `cmux-728` | TypeScript | 1 | +75 -91 (166) | 100% | Base case from cmux repo |
| `stack-auth-943` | TypeScript | 11 | +144 -37 (181) | 97% | Auth library (6 lines pnpm-lock) |
| `pandas-56442` | Python | 4 | +93 -66 (159) | 99% | Merge sorting (1 doc line) |
| `nextjs-58297` | TypeScript | 5 | +57 -18 (75) | 100% | Shallow URL prefetch bug |
| `cargo-14966` | Rust | 2 | +155 -1 (156) | 100% | Symlink git status perf |
| `sentry-python-1532` | Python | 2 | +213 -140 (353) | 100% | FastAPI infinite loop |
| `apollo-client-9599` | TypeScript | 17 | +618 -251 (869) | 99.8% | useQuery render frames |

## File Structure

```
evals/
├── README.md                # This file
├── dataset.ts              # PR metadata and expected issues
├── fetch-pr-data.ts        # GitHub API fetching logic
├── sync-dataset.ts         # Sync all PRs locally
├── inspect.ts              # View PR diffs and metadata
├── run-eval.ts             # Run strategy evaluation
├── data/                   # Synced PR data (gitignored except *.annotated.diff)
│   └── <pr-id>/
│       ├── README.md       # Human-readable PR summary
│       ├── metadata.json   # Full PR metadata
│       ├── full.diff       # Complete unified diff
│       ├── full.annotated.diff  # Manually annotated version (tracked in git)
│       ├── files.json      # Per-file metadata
│       ├── *.diff          # Individual file diffs
│       └── *.annotated.diff     # Manually annotated file diffs (tracked in git)
└── results/                # Eval results (gitignored)
    └── <pr-id>/
        └── <strategy-id>/
            ├── summary.json
            └── *.result.json
```

## Commands

### Sync Dataset

Fetches all PRs from GitHub and persists them locally:

```bash
bun run apps/www/scripts/pr-review/evals/sync-dataset.ts
```

This populates `evals/data/<pr-id>/` with diffs, metadata, and READMEs.

**Authentication**: The script automatically uses `gh auth token` if available. Otherwise, set `GITHUB_TOKEN` or `GH_TOKEN` environment variable to avoid rate limits.

### Inspect PRs

View a PR's summary and available files:

```bash
bun run apps/www/scripts/pr-review/evals/inspect.ts <pr-id>
```

Available PRs:
- `cmux-728`
- `stack-auth-943`
- `pandas-56442`
- `nextjs-58297`
- `cargo-14966`
- `sentry-python-1532`
- `apollo-client-9599`

View a specific file's diff:

```bash
bun run apps/www/scripts/pr-review/evals/inspect.ts <pr-id> <filename>
```

### Run Evals

Run a strategy against a PR:

```bash
bun run apps/www/scripts/pr-review/evals/run-eval.ts <pr-id> [strategy-id]
```

Available strategies:
- `line-numbers` (default)
- `json-lines`
- `inline-phrase`
- `inline-brackets`
- `inline-json`
- `inline-files`

Results are saved to `evals/results/<pr-id>/<strategy-id>/`.

## Adding New PRs

1. Edit `dataset.ts` and add a new entry to the `prs` array
2. Run `bun run evals/sync-dataset.ts` to fetch it
3. Optionally define `expectedIssues` for the PR

Example:

```typescript
{
  id: "my-pr-123",
  url: "https://github.com/owner/repo/pull/123/files",
  title: "Fix memory leak in cache",
  description: "Addresses memory leak when cache grows unbounded",
  tags: ["go", "performance", "bug-fix"],
  metadata: {
    owner: "owner",
    repo: "repo",
    number: 123,
    language: "go",
    filesChanged: 0, // Will be populated by sync
    additions: 0,
    deletions: 0,
  },
  expectedIssues: [
    {
      file: "cache/cache.go",
      type: "bug",
      severity: "high",
      description: "Memory leak from unbounded map growth",
      lineRange: { start: 45, end: 52 },
      snippet: "// Missing eviction logic",
    },
  ],
}
```

## Expected Issues Format

Each PR can define expected issues for validation:

```typescript
{
  file: string;                    // File path in the diff
  type: "bug" | "security" | "performance" | "style" | "maintainability" | "correctness";
  severity: "low" | "medium" | "high" | "critical";
  description: string;             // What's wrong
  lineRange?: { start: number; end: number };  // Optional line range
  snippet?: string;                // Optional code snippet
}
```

## Annotated Diffs

Each PR has annotated diff files (`.annotated.diff`) that you can manually edit to mark expected issues:

```bash
# View an annotated diff
cat apps/www/scripts/pr-review/evals/data/pandas-56442/full.annotated.diff

# Edit it to add annotations
code apps/www/scripts/pr-review/evals/data/pandas-56442/full.annotated.diff
```

**These files are tracked in git** (unlike the rest of `data/`), so you can:
- Manually annotate code issues/bugs
- Commit your annotations
- Use them as ground truth for eval comparisons

All 49 annotated files were created as copies of the original diffs. You can now add your review annotations to them.

## Workflow

1. **Sync**: Fetch PRs from GitHub → `data/`
2. **Inspect**: Review diffs manually to understand issues
3. **Annotate**:
   - Option A: Edit `.annotated.diff` files directly with inline comments
   - Option B: Add `expectedIssues` to `dataset.ts`
4. **Eval**: Run strategies and compare outputs to expected issues
5. **Iterate**: Refine prompts, strategies, and expected annotations

## Tips

- Start by inspecting PRs to understand the code changes before defining expected issues
- Use `cat` or your editor to view full diffs: `cat evals/data/<pr-id>/full.diff`
- Individual file diffs are easier to reason about than full diffs
- Expected issues help validate that strategies catch real problems
- Keep PRs small (< 7 files ideally) for faster iteration

## Environment Variables

Set `GITHUB_TOKEN`, `GH_TOKEN`, or `GITHUB_PERSONAL_ACCESS_TOKEN` to avoid rate limits when syncing.
