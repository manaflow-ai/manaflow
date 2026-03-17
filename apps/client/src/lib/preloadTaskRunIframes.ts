import { PERMISSIVE_IFRAME_ALLOW, PERMISSIVE_IFRAME_SANDBOX } from "./iframePermissions";
import { persistentIframeManager } from "./persistentIframeManager";
import {
  getTaskRunBrowserPersistKey,
  getTaskRunPersistKey,
} from "./persistent-webview-keys";

/**
 * Preload iframes for task runs
 * @param taskRunIds - Array of task run IDs to preload
 * @returns Promise that resolves when all iframes are loaded
 */
export const TASK_RUN_IFRAME_ALLOW = PERMISSIVE_IFRAME_ALLOW;

export const TASK_RUN_IFRAME_SANDBOX = PERMISSIVE_IFRAME_SANDBOX;

export async function preloadTaskRunIframes(
  data: { url: string; taskRunId: string }[]
): Promise<void> {
  const entries = data.map(({ url, taskRunId }) => {
    const key = getTaskRunPersistKey(taskRunId);
    return {
      key,
      url,
      allow: TASK_RUN_IFRAME_ALLOW,
      sandbox: TASK_RUN_IFRAME_SANDBOX,
    };
  });

  await persistentIframeManager.preloadMultiple(entries);
}

/**
 * Preload a single task run iframe
 * @param taskRunId - Task run ID to preload
 * @returns Promise that resolves when the iframe is loaded
 */
export async function preloadTaskRunIframe(
  taskRunId: string,
  url: string
): Promise<void> {
  await persistentIframeManager.preloadIframe(getTaskRunPersistKey(taskRunId), url, {
    allow: TASK_RUN_IFRAME_ALLOW,
    sandbox: TASK_RUN_IFRAME_SANDBOX,
  });
}

export async function preloadTaskRunBrowserIframe(
  taskRunId: string,
  url: string
): Promise<void> {
  await persistentIframeManager.preloadIframe(
    getTaskRunBrowserPersistKey(taskRunId),
    url,
    {
      allow: TASK_RUN_IFRAME_ALLOW,
      sandbox: TASK_RUN_IFRAME_SANDBOX,
    }
  );
}

/**
 * Remove a task run iframe from memory
 * @param taskRunId - Task run ID to remove
 */
export function removeTaskRunIframe(taskRunId: string): void {
  persistentIframeManager.removeIframe(getTaskRunPersistKey(taskRunId));
}

export function setTaskRunIframePinned(
  taskRunId: string,
  pinned: boolean
): void {
  persistentIframeManager.setPinned(getTaskRunPersistKey(taskRunId), pinned);
}

/**
 * Get all currently loaded task run iframe keys
 * @returns Array of task run IDs that have loaded iframes
 */
export function getLoadedTaskRunIframes(): string[] {
  return persistentIframeManager
    .getLoadedKeys()
    .filter((key) => key.startsWith("task-run:"))
    .map((key) => key.replace("task-run:", ""));
}
