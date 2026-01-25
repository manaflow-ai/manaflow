/**
 * Global inline editing state management.
 *
 * This module provides a simple mechanism to signal when inline editing
 * (e.g., renaming tasks, environments, workspaces) is active in the UI.
 * Components like DashboardInput use this to avoid stealing focus from
 * active editing sessions.
 *
 * Uses a data attribute on document.body similar to command palette state.
 */

const DATA_ATTR_CAMEL = "cmuxInlineEditing";

/**
 * Signal that inline editing has started.
 * Call this when entering an editable state (e.g., showing a rename input).
 */
export function setInlineEditingActive(): void {
  if (typeof document === "undefined") return;
  document.body.dataset[DATA_ATTR_CAMEL] = "true";
}

/**
 * Signal that inline editing has ended.
 * Call this when exiting an editable state (e.g., submitting or canceling rename).
 */
export function clearInlineEditingActive(): void {
  if (typeof document === "undefined") return;
  delete document.body.dataset[DATA_ATTR_CAMEL];
}

/**
 * Check if inline editing is currently active.
 * Used by focus management systems to avoid stealing focus.
 */
export function isInlineEditingActive(): boolean {
  if (typeof document === "undefined") return false;
  return document.body?.dataset?.[DATA_ATTR_CAMEL] === "true";
}
