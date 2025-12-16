# PR Review Strategies

This directory powers the automated PR-review inject script. The pipeline is
now strategy-based, so we can experiment with multiple prompting/output styles
without rewriting the harness.

## Current Strategies

| ID              | Description                                                                                   | Output                                                               |
|-----------------|-----------------------------------------------------------------------------------------------|----------------------------------------------------------------------|
| `json-lines`       | Original flow. The LLM returns JSON objects containing the literal line text plus metadata.   | `lines[].line`, `shouldBeReviewedScore`, `shouldReviewWhy`, `mostImportantCharacterIndex` |
| `line-numbers`     | Similar to the original, but the model references diff line numbers instead of echoing code. | `lines[].lineNumber` (optional `line`), score/index required         |
| `openai-responses` | Bypasses the Codex CLI and calls OpenAI's Responses API directly with the `gpt-5-codex` model. | Matches `json-lines` output (`lines[]`, score/index metadata)        |
| `inline-phrase`    | Lines end with `// review <float 0.0-1.0> "verbatim snippet" <optional comment>` (lowercase). | Annotated diff plus parsed phrase annotations                        |
| `inline-brackets`  | Highlights spans with `{| … |}` and appends `// review <float 0.0-1.0> <optional comment>`.    | Annotated diff plus parsed highlight spans                           |
| `inline-json`      | Lines end with `// { "score": <float 0.0-1.0>, "phrase": "verbatim snippet", "comment": "…" }`. | Annotated diff plus parsed JSON review objects                       |
| `inline-files`     | Writes the diff to a workspace file that the agent must edit in place with inline review tags. | Annotated on-disk diff harvested after completion                     |

All strategies implement the common interface in `core/types.ts`. The active
strategy is selected via `CMUX_PR_REVIEW_STRATEGY` or the CLI flag
`--strategy <json-lines|line-numbers|openai-responses|inline-phrase|inline-brackets|inline-json|inline-files>`.

## Configuration

Environment variables (and matching CLI flags) understood by the inject script:

| Env / Flag                                   | Purpose                                                                                 | Default      |
|----------------------------------------------|-----------------------------------------------------------------------------------------|--------------|
| `CMUX_PR_REVIEW_STRATEGY` / `--strategy`      | Strategy ID to use (`json-lines`, `line-numbers`, `openai-responses`, `inline-phrase`, `inline-brackets`, `inline-json`, `inline-files`) | `json-lines` |
| `CMUX_PR_REVIEW_SHOW_DIFF_LINE_NUMBERS` / `--diff-line-numbers` | Include formatted line numbers in prompts/logs                              | `false`      |
| `CMUX_PR_REVIEW_SHOW_CONTEXT_LINE_NUMBERS` / `--diff-context-line-numbers` | Include numbers on unchanged diff lines               | `true`       |
| `CMUX_PR_REVIEW_DIFF_ARTIFACT_MODE` / `--diff-artifact <single|per-file>` | How to persist diff artifacts (`inline-*` strategies often use `single`) | `per-file`   |
| `CMUX_PR_REVIEW_ARTIFACTS_DIR`                | Root directory for run artifacts                                                        | `${WORKSPACE}/.cmux-pr-review-artifacts` |

See `core/options.ts` for the full option loader.

## Supporting Modules

- `core/options.ts`: Parses environment/CLI config into a typed `PrReviewOptions`.
- `core/types.ts`: Shared type definitions for strategy hooks.
- `diff-utils.ts`: Pure TypeScript diff formatter (no external processes).
- `strategies/`: Individual strategy implementations.

### Execution Model

Each file review runs through the selected strategy concurrently (the inject
script maps over files and awaits `Promise.all`). Switching strategies only
changes how each file is evaluated, not the level of parallelism.

### OpenAI responses strategy

`openai-responses` mirrors the `json-lines` prompts and parsing logic, but it
skips the Codex CLI sandbox and calls the OpenAI Responses API directly with
the `gpt-5-codex` model. Provide an `OPENAI_API_KEY` in the environment before
launching the script; request/response artifacts are still persisted alongside
the other strategies for comparison.

## Inline-Comment Format

### Phrase strategy

Lines must end with:

```
// review <float 0.0-1.0> "verbatim snippet" <optional comment>
```

Always include the score (float between 0.0 and 1.0). Annotate only the changed rows (lines
beginning with `+` or `-`) and skip diff metadata or context rows. Copy a short
snippet (roughly 2-6 words) directly from the changed portion of the line and
trim any leading or trailing whitespace—avoid reprinting the entire line.
The inline JSON strategy follows the same guidance for which lines to tag and
how to choose snippets.

### Bracket strategy

Wrap the critical span inline using `{|` and `|}`, then append:

```
// review <float 0.0-1.0> <optional comment>
```

Scores are mandatory; comments are optional. Parsed annotations capture either
the phrase or the bracketed highlight.

### Workspace file strategy

The diff is saved to `${CMUX_PR_REVIEW_ARTIFACTS_DIR}/inline-files/*.diff`. The
agent edits that file directly, appending `// review <float 0.0-1.0> "verbatim snippet"` tags to
each changed diff line (only those starting with `+` or `-`). Copy a concise
snippet from that line, trim surrounding whitespace, and avoid echoing the full
line. Once the run finishes, the inject script re-reads the file to collect
annotations instead of relying on the agent's chat response.

## Demo Harness

`run-strategy-demo.ts` fetches PR [#709](https://github.com/manaflow-ai/cmux/pull/709/files),
runs each strategy with synthetic model outputs, and stores prompts/responses
under `tmp/strategy-demo/`. This is useful for quick smoke tests without
calling the OpenAI API:

```
bun run apps/www/scripts/pr-review/run-strategy-demo.ts
```

## Running the Inject Script

The local Docker runner (`pr-review-local.ts`) is the default path for testing.
Pass `--strategy` and related flags to choose the approach:

```
# JSON (literal line content)
bun run apps/www/scripts/pr-review-local.ts \
  --strategy json-lines \
  <PR_URL>

# JSON (diff line numbers)
bun run apps/www/scripts/pr-review-local.ts \
  --strategy line-numbers \
  --diff-line-numbers \
  <PR_URL>

# OpenAI Responses (direct API)
bun run apps/www/scripts/pr-review-local.ts \
  --strategy openai-responses \
  <PR_URL>

# Inline phrase tags (aggregated artifacts)
bun run apps/www/scripts/pr-review-local.ts \
  --strategy inline-phrase \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>

# Inline bracket highlights (aggregated artifacts)
bun run apps/www/scripts/pr-review-local.ts \
  --strategy inline-brackets \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>

# Inline JSON review tags (aggregated artifacts)
bun run apps/www/scripts/pr-review-local.ts \
  --strategy inline-json \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>

# Inline workspace file annotations
bun run apps/www/scripts/pr-review-local.ts \
  --strategy inline-files \
  --diff-line-numbers \
  --diff-context-line-numbers \
  <PR_URL>
```

The direct harness (`pr-review.ts`) targets a remote Morph instance but accepts
the same flags; use it only when you need a remote run.

```
# JSON (line content)
bun run apps/www/scripts/pr-review.ts --strategy json-lines <PR_URL>

# JSON (line numbers)
bun run apps/www/scripts/pr-review.ts --strategy line-numbers --diff-line-numbers <PR_URL>

# OpenAI Responses (direct API)
bun run apps/www/scripts/pr-review.ts --strategy openai-responses <PR_URL>

# Inline phrase tags
bun run apps/www/scripts/pr-review.ts \
  --strategy inline-phrase \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>

# Inline JSON tags
bun run apps/www/scripts/pr-review.ts \
  --strategy inline-json \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>

# Inline bracket highlights
bun run apps/www/scripts/pr-review.ts \
  --strategy inline-brackets \
  --diff-line-numbers \
  --diff-context-line-numbers \
  --diff-artifact single \
  <PR_URL>

# Inline workspace annotations
bun run apps/www/scripts/pr-review.ts \
  --strategy inline-files \
  --diff-line-numbers \
  --diff-context-line-numbers \
  <PR_URL>
```

## Other Utilities

```
# Run all strategies against PR #709 and collect sample artifacts
bun run apps/www/scripts/pr-review/run-strategy-demo.ts

# Bundle the inject script (used by CI/local Docker)
bun build apps/www/scripts/pr-review/pr-review-inject.ts \
  --outfile apps/www/scripts/pr-review/pr-review-inject.bundle.js \
  --target bun
```

Artifacts live under `CMUX_PR_REVIEW_ARTIFACTS_DIR` and are referenced in the
final `code-review-output.json`.
