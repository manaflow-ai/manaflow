# PR Review Strategy Configuration

This document explains how to toggle between different PR review strategies.

## Quick Start

To change the PR review strategy, edit the `PR_REVIEW_STRATEGY` constant in `pr-review.config.ts`:

```typescript
export const PR_REVIEW_STRATEGY = "heatmap" as const;
```

## Available Strategies

### Heatmap (NEW - NO MORPH!)
**ID:** `"heatmap"`

**🚀 This strategy runs entirely locally without Morph VMs!**

Structured diff analysis that:
- Calls OpenAI API directly (no VM provisioning)
- Fetches PR diffs via GitHub API
- Runs in your backend process (much faster startup)
- Strips `+/-` markers from line content for cleaner data
- Adds `changeType` field: `"addition"`, `"deletion"`, or `"context"`
- Review scores from 0.0 to 1.0 indicating attention needed

**Benefits:**
- ⚡ **Much faster**: No VM spin-up time (saves ~30-60 seconds)
- 💰 **Cheaper**: No Morph instance costs
- 🎯 **Simpler**: Direct API calls, easier to debug
- 📊 **Cleaner data**: Better structured for programmatic processing

### JSON Lines (Original)
**ID:** `"json-lines"`

Returns JSON with exact line content including markers.

### Other Strategies
- `"line-numbers"` - Line number-based annotations
- `"openai-responses"` - OpenAI response format
- `"inline-phrase"` - Inline phrase-based annotations
- `"inline-brackets"` - Inline bracket-based annotations
- `"inline-json"` - Inline JSON annotations
- `"inline-files"` - Inline file-based annotations

## How It Works

### Heatmap Strategy (No Morph)

1. **Configuration File** (`pr-review.config.ts`):
   - `PR_REVIEW_STRATEGY = "heatmap"`

2. **Service Integration** (`lib/services/code-review/start-code-review.ts`):
   - Checks if strategy is `"heatmap"`
   - If yes: Calls `runHeatmapReview()` (skips Morph entirely)
   - If no: Calls `startAutomatedPrReview()` (uses Morph)

3. **Heatmap Runner** (`lib/services/code-review/run-heatmap-review.ts`):
   - Fetches PR diffs directly from GitHub API
   - Calls OpenAI API for each file concurrently
   - Stores results in Convex
   - Sends callbacks when complete

### Other Strategies (Morph-based)

1. **Service Integration**: Calls `startAutomatedPrReview()`

2. **Morph Instance** (`src/pr-review.ts`):
   - Spins up Morph VM
   - Sets `CMUX_PR_REVIEW_STRATEGY` environment variable
   - Injects review script into the sandbox

3. **Strategy Execution** (inside Morph):
   - Inject script reads `CMUX_PR_REVIEW_STRATEGY` env var
   - Loads appropriate strategy from registry
   - Executes review using that strategy

## Testing Different Strategies

To test a different strategy:

1. Edit `apps/www/pr-review.config.ts`
2. Change `PR_REVIEW_STRATEGY` to desired strategy ID
3. Restart your server
4. Trigger a new PR review

## Environment Variable Override

You can override the config file strategy with an environment variable:

```bash
CMUX_PR_REVIEW_STRATEGY=json-lines npm start
```

This takes precedence over the `pr-review.config.ts` setting.

## Adding New Strategies

To add a new strategy:

1. Create strategy file in `scripts/pr-review/strategies/your-strategy.ts`
2. Implement `ReviewStrategy` interface with `prepare()` and `process()` methods
3. Add strategy ID to `PrReviewStrategyId` type in `core/options.ts`
4. Add ID to `STRATEGY_VALUES` array
5. Import and register in `strategies/index.ts`

See `strategies/heatmap.ts` for a complete example.
