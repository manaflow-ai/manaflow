// HeatmapDiffViewer - GitHub-style diff viewer with heatmap support
// Adapted from apps/www/components/pr/pull-request-diff-viewer.tsx
/* eslint-disable react-refresh/only-export-components */

export { HeatmapDiffViewer, type HeatmapDiffViewerProps } from "./heatmap-diff-viewer";
export {
  GitDiffViewerWithHeatmap,
  type GitDiffViewerWithHeatmapProps,
  type DiffViewerControls,
} from "./git-diff-viewer-with-heatmap";
export {
  GitDiffHeatmapReviewViewer,
  type StreamFileState,
  type StreamFileStatus,
} from "./git-diff-review-viewer";
export { buildHeatmapGradientStyles, type HeatmapColorSettings } from "./heatmap-gradient";
