import { Search } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * A clickable search bar placeholder for the title bar.
 * Displays a hint that Cmd+K (or Ctrl+K) opens the command palette.
 * Clicking the bar also triggers the command palette.
 */
export function TopBarSearch() {
  const isMac =
    typeof navigator !== "undefined" &&
    /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const shortcutKey = isMac ? "⌘" : "Ctrl";

  const handleClick = () => {
    // Dispatch a keyboard event to trigger the command palette
    // This mimics pressing Cmd+K (or Ctrl+K on Windows)
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-1.5 h-[18px] px-2 rounded-md border border-neutral-200/70 dark:border-neutral-700/70 bg-neutral-50/80 dark:bg-neutral-800/50 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-700/70 hover:border-neutral-300 dark:hover:border-neutral-600 hover:text-neutral-600 dark:hover:text-neutral-300 transition-colors cursor-pointer select-none"
      style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
    >
      <Search className="w-3 h-3" />
      <span className="text-[10px] font-medium">Search</span>
      <div className="flex items-center gap-0.5 ml-1">
        <kbd className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded border border-neutral-300/80 dark:border-neutral-600/80 bg-white dark:bg-neutral-700/80 text-[9px] font-medium text-neutral-500 dark:text-neutral-400">
          {shortcutKey}
        </kbd>
        <kbd className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-1 rounded border border-neutral-300/80 dark:border-neutral-600/80 bg-white dark:bg-neutral-700/80 text-[9px] font-medium text-neutral-500 dark:text-neutral-400">
          K
        </kbd>
      </div>
    </button>
  );
}
