import { persistentIframeManager } from "./persistentIframeManager";

export interface WebviewActions {
  focus?: () => Promise<boolean> | boolean;
  isFocused?: () => Promise<boolean> | boolean;
}

const registry = new Map<string, WebviewActions>();

export function registerWebviewActions(
  persistKey: string,
  actions: WebviewActions,
): void {
  registry.set(persistKey, actions);
}

export function unregisterWebviewActions(
  persistKey: string,
  actions?: WebviewActions,
): void {
  const existing = registry.get(persistKey);
  if (!existing) return;
  if (!actions || existing === actions) {
    registry.delete(persistKey);
  }
}

export function getWebviewActions(persistKey: string): WebviewActions | null {
  return registry.get(persistKey) ?? null;
}

export async function focusWebview(persistKey: string): Promise<boolean> {
  const actions = registry.get(persistKey);

  if (actions?.focus) {
    try {
      const result = await actions.focus();
      return Boolean(result);
    } catch (error) {
      console.error(`Failed to focus webview "${persistKey}"`, error);
      return false;
    }
  }

  return persistentIframeManager.focusIframe(persistKey);
}

export async function isWebviewFocused(persistKey: string): Promise<boolean> {
  const actions = registry.get(persistKey);

  if (actions?.isFocused) {
    try {
      const result = await actions.isFocused();
      return Boolean(result);
    } catch (error) {
      console.error(
        `Failed to check focus for webview "${persistKey}"`,
        error,
      );
    }
  }

  return persistentIframeManager.isIframeFocused(persistKey);
}
