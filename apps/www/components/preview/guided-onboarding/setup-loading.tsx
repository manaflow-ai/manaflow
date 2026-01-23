"use client";

import { Loader2, ChevronDown } from "lucide-react";
import { useState } from "react";

interface SetupLoadingProps {
  repo: string;
  status: string;
}

export function SetupLoading({ repo, status }: SetupLoadingProps) {
  const [showWhy, setShowWhy] = useState(true);
  const [showTechnical, setShowTechnical] = useState(false);

  return (
    <div className="min-h-dvh bg-[#0d1117] text-neutral-100 flex">
      {/* Left sidebar - steps preview */}
      <div className="w-64 border-r border-neutral-800 p-4">
        <div className="mb-6">
          <h2 className="text-sm font-medium text-neutral-100">Repository setup</h2>
          <p className="text-xs text-neutral-500 mt-1">Configure {repo.split("/").pop()}</p>
          <p className="text-xs text-neutral-600 mt-2">0/5 steps</p>
        </div>

        <div className="flex flex-col items-center justify-center py-16">
          <p className="text-sm text-neutral-400 mb-3">Waiting for machine to start...</p>
          <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
        </div>
      </div>

      {/* Main content - loading state */}
      <div className="flex-1 flex flex-col">
        {/* Tab bar */}
        <div className="h-10 border-b border-neutral-800 flex items-center px-4 gap-4">
          <button className="text-sm text-neutral-100 border-b-2 border-neutral-100 pb-2 -mb-[1px]">
            Machine
          </button>
          <button className="text-sm text-neutral-500 pb-2 -mb-[1px]">
            Browser
          </button>
        </div>

        {/* Loading content */}
        <div className="flex-1 flex items-center justify-center">
          <div className="max-w-md w-full px-6">
            <div className="text-center mb-8">
              <p className="text-neutral-400 text-sm mb-1">Setting up</p>
              <h1 className="text-xl font-medium text-neutral-100">{repo}</h1>
            </div>

            {/* Progress indicator */}
            <div className="flex items-center justify-center gap-3 mb-8">
              <span className="text-sm text-neutral-400">{status}</span>
              <div className="w-24 h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div className="h-full bg-neutral-500 rounded-full animate-pulse w-1/2" />
              </div>
            </div>

            {/* Info sections */}
            <div className="space-y-3">
              <div className="border border-neutral-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowWhy(!showWhy)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-neutral-800/50 transition"
                >
                  <span className="text-sm text-neutral-300">Why repository setup matters</span>
                  <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${showWhy ? "rotate-180" : ""}`} />
                </button>
                {showWhy && (
                  <div className="px-3 pb-3 text-xs text-neutral-500 leading-relaxed">
                    Completing repository setup helps your AI agent run reliably and efficiently.
                    Skipping steps can degrade performance and cause intermittent failures.
                  </div>
                )}
              </div>

              <div className="border border-neutral-800 rounded-lg overflow-hidden">
                <button
                  onClick={() => setShowTechnical(!showTechnical)}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-neutral-800/50 transition"
                >
                  <span className="text-sm text-neutral-300">Technical details</span>
                  <ChevronDown className={`h-4 w-4 text-neutral-500 transition-transform ${showTechnical ? "rotate-180" : ""}`} />
                </button>
                {showTechnical && (
                  <div className="px-3 pb-3 text-xs text-neutral-500 leading-relaxed space-y-2">
                    <p>We&apos;re spinning up an isolated cloud environment with:</p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>Full Linux environment with Docker</li>
                      <li>Your repository cloned and ready</li>
                      <li>Terminal access for setup</li>
                      <li>Encrypted secret storage</li>
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
