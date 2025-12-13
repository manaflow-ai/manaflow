/**
 * LLM-as-Judge Evaluation Criteria for Screenshot Bot Comments
 *
 * Each comment is evaluated on multiple dimensions to assess the quality
 * of the screenshot generation and whether it correctly captured UI changes.
 */

export type FailureCategory =
  // Known failure cases
  | "false_positive" // Diff has no UI changes, but screenshots were taken
  | "false_negative" // Diff has UI changes, but no screenshots were taken
  | "fake_ui" // LLM created fake/fabricated UIs and screenshotted those
  | "dev_server_failed" // Dev server failed to start, no valid screenshots possible
  | "error_screenshot" // Screenshot captured an error screen/crash/exception
  // Additional failure cases the LLM might identify
  | "wrong_page" // Screenshot taken of wrong page/route
  | "incomplete_screenshot" // Screenshot cut off or missing important UI elements
  | "stale_screenshot" // Screenshot doesn't reflect the actual code changes
  | "unrelated_screenshot" // Screenshot shows UI unrelated to the PR changes
  | "duplicate_screenshots" // Multiple identical/near-identical screenshots
  | "missing_context" // Screenshot lacks context to understand the change
  | "wrong_viewport" // Screenshot taken at wrong viewport/resolution
  | "loading_state" // Screenshot captured loading/skeleton state instead of final UI
  | "other"; // Other failure case (described in notes)

export type EvaluationRating =
  | "excellent" // Perfect execution, screenshots accurately capture all UI changes
  | "good" // Minor issues but overall correct and useful
  | "acceptable" // Some issues but still provides value
  | "poor" // Significant issues that reduce usefulness
  | "failed"; // Complete failure, screenshots are wrong or missing

export type Evaluation = {
  // Overall rating
  rating: EvaluationRating;

  // Did the diff contain UI-relevant changes?
  diffHasUIChanges: boolean;

  // Were screenshots provided in the comment?
  hasScreenshots: boolean;

  // If screenshots exist, do they accurately reflect the code changes?
  screenshotsAccurate: boolean | null; // null if no screenshots

  // Identified failure categories (can be multiple)
  failureCategories: FailureCategory[];

  // Specific issues found
  issues: string[];

  // What the bot did well (for positive feedback)
  strengths: string[];

  // Suggested improvements
  suggestions: string[];

  // Additional failure case not in predefined categories
  additionalFailureCase: string | null;

  // Free-form notes from the evaluator
  notes: string;

  // Confidence score (0-1) in this evaluation
  confidence: number;
};

export type EvaluationPromptContext = {
  // PR metadata
  prNumber: number;
  prTitle: string;

  // The bot's comment (markdown with embedded screenshots)
  commentBody: string;

  // The full PR diff
  diff: string;

  // Comment metadata
  botLogin: string;
  commentType: "issue_comment" | "review_comment" | "review";
};

export const EVALUATION_SYSTEM_PROMPT = `You are an expert evaluator assessing the quality of an AI bot that generates screenshots for pull requests.

Your task is to evaluate whether the bot correctly identified UI changes in a PR and captured appropriate screenshots.

## Evaluation Criteria

### 1. UI Change Detection
- Analyze the diff to determine if it contains UI-relevant changes (React components, CSS, HTML, etc.)
- Consider changes to: JSX/TSX, CSS/SCSS/Tailwind, HTML templates, UI component props, styling, layout

### 2. Screenshot Accuracy
If screenshots were provided:
- Do they show the actual UI affected by the code changes?
- Are they taken at appropriate viewports/states?
- Do they capture before/after states if relevant?
- Are they real screenshots from the app or fabricated/fake UIs?

### 3. Known Failure Categories
Watch for these specific failure modes:
- **false_positive**: Screenshots taken when diff has NO UI changes (e.g., backend-only, config, tests)
- **false_negative**: No screenshots when diff clearly HAS UI changes
- **fake_ui**: Bot created fake/mock UIs instead of screenshotting the actual app
- **dev_server_failed**: Evidence that the dev server didn't start (no screenshots, error messages)
- **error_screenshot**: Screenshots show error pages, exceptions, or crash screens
- **wrong_page**: Screenshots of pages unrelated to the changed code
- **incomplete_screenshot**: Important UI elements cut off or missing
- **stale_screenshot**: Screenshots don't reflect the actual code changes
- **unrelated_screenshot**: Screenshots show unrelated UI
- **duplicate_screenshots**: Multiple identical screenshots with no purpose
- **missing_context**: Screenshots lack context to understand what changed
- **wrong_viewport**: Inappropriate viewport size (too small, wrong device)
- **loading_state**: Captured loading spinners/skeletons instead of final UI

### 4. Rating Scale
- **excellent**: Perfect - correctly identified UI changes and captured accurate, useful screenshots
- **good**: Minor issues but overall correct and useful
- **acceptable**: Some issues but still provides value
- **poor**: Significant issues that reduce usefulness
- **failed**: Complete failure - wrong screenshots, missing when needed, or fake UIs

## Response Format
Respond with a JSON object matching the Evaluation type. Be thorough but concise in your notes.`;

export const EVALUATION_USER_PROMPT = (ctx: EvaluationPromptContext) => `
## PR Information
- **PR #${ctx.prNumber}**: ${ctx.prTitle}
- **Bot**: ${ctx.botLogin}
- **Comment Type**: ${ctx.commentType}

## Bot's Comment
\`\`\`markdown
${ctx.commentBody}
\`\`\`

## PR Diff
\`\`\`diff
${ctx.diff}
\`\`\`

Please evaluate this bot comment and provide your assessment as a JSON object.
`;

export type StoredEvaluation = {
  commentId: number;
  prNumber: number;
  evaluation: Evaluation;
  evaluatedAt: string;
  model: string;
};
