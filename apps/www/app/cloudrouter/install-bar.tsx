"use client";

import { useState } from "react";

const COMMAND = "npx skills add manaflow-ai/cloudrouter";

export function InstallBar() {
  const [copied, setCopied] = useState(false);

  return (
    <div className="mb-8 w-full text-center">
      <button
        type="button"
        className="group inline-flex items-center gap-3 rounded-full px-5 py-2.5 font-mono text-sm text-neutral-600 transition hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
        onClick={() => {
          navigator.clipboard.writeText(COMMAND).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }).catch((err: unknown) => {
            console.error("Failed to copy:", err);
          });
        }}
      >
        <span>
          <span className="text-neutral-400 dark:text-neutral-500">~ </span>
          {COMMAND}
        </span>
        <span className={`text-neutral-400 transition-opacity dark:text-neutral-500 ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
          {copied ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </span>
      </button>
    </div>
  );
}
