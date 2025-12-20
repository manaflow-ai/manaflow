import { Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function useIsMac() {
  const [isMac, setIsMac] = useState(true);
  useEffect(() => {
    setIsMac(navigator.platform.toUpperCase().includes("MAC"));
  }, []);
  return isMac;
}

export function TopBarSearch() {
  const isMac = useIsMac();

  const handleClick = useCallback(() => {
    // Dispatch a keyboard event to open the CommandBar (Cmd+K on Mac, Ctrl+K on Windows/Linux)
    const event = new KeyboardEvent("keydown", {
      key: "k",
      code: "KeyK",
      metaKey: isMac,
      ctrlKey: !isMac,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
  }, [isMac]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/70 dark:border-neutral-700/50 hover:bg-neutral-150 dark:hover:bg-neutral-700 transition-colors cursor-pointer select-none"
    >
      <Search className="w-3.5 h-3.5 text-neutral-400 dark:text-neutral-500" />
      <span className="text-xs text-neutral-500 dark:text-neutral-400">
        Search...
      </span>
      <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 ml-4 text-[10px] font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-700/50 rounded">
        {isMac ? (
          <>
            <span className="text-xs">⌘</span>
            <span>K</span>
          </>
        ) : (
          <>
            <span>Ctrl</span>
            <span>K</span>
          </>
        )}
      </kbd>
    </button>
  );
}
