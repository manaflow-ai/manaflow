import { useCallback, useMemo } from "react";

import { focusWebview, isWebviewFocused } from "@/lib/webview-actions";

interface UseWebviewActionsOptions {
  persistKey: string;
}

interface UseWebviewActionsResult {
  focus: () => Promise<boolean>;
  isFocused: () => Promise<boolean>;
}

export function useWebviewActions({
  persistKey,
}: UseWebviewActionsOptions): UseWebviewActionsResult {
  const focus = useCallback(() => {
    return focusWebview(persistKey);
  }, [persistKey]);

  const isFocused = useCallback(() => {
    return isWebviewFocused(persistKey);
  }, [persistKey]);

  return useMemo(() => {
    return { focus, isFocused };
  }, [focus, isFocused]);
}
