"use client";

import { Check, Circle, ChevronDown } from "lucide-react";
import { useState } from "react";

export type StepStatus = "pending" | "current" | "completed";

export interface SetupStepConfig {
  id: string;
  title: string;
  description: string;
  optional?: boolean;
  defaultValue?: string;
  placeholder?: string;
  docsUrl?: string;
}

interface SetupStepProps {
  step: SetupStepConfig;
  status: StepStatus;
  value: string;
  onChange: (value: string) => void;
  onVerify?: () => void;
  isVerifying?: boolean;
}

export function SetupStep({
  step,
  status,
  value,
  onChange,
  onVerify,
  isVerifying,
}: SetupStepProps) {
  const [isExpanded, setIsExpanded] = useState(status === "current");

  const StatusIcon = () => {
    if (status === "completed") {
      return (
        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <Check className="w-3 h-3 text-emerald-400" />
        </div>
      );
    }
    if (status === "current") {
      return (
        <div className="w-5 h-5 rounded-full border-2 border-blue-400 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-blue-400" />
        </div>
      );
    }
    return (
      <Circle className="w-5 h-5 text-neutral-600" />
    );
  };

  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 p-3 text-left hover:bg-neutral-800/30 transition"
      >
        <StatusIcon />
        <span className={`flex-1 text-sm ${status === "current" ? "text-neutral-100" : "text-neutral-400"}`}>
          {step.title}
        </span>
        {step.optional && (
          <span className="text-xs text-neutral-600 px-1.5 py-0.5 rounded bg-neutral-800">
            Optional
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-neutral-500 transition-transform ${isExpanded ? "rotate-180" : ""}`}
        />
      </button>

      {isExpanded && (
        <div className="px-3 pb-4 pl-11">
          <p className="text-xs text-neutral-500 mb-3">{step.description}</p>

          <div className="bg-neutral-900 rounded-lg p-3 font-mono text-xs">
            <textarea
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={step.placeholder}
              rows={3}
              className="w-full bg-transparent text-neutral-300 placeholder:text-neutral-600 resize-none focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2 mt-3">
            {onVerify && (
              <button
                onClick={onVerify}
                disabled={isVerifying}
                className="px-3 py-1.5 text-xs font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded transition disabled:opacity-50"
              >
                {isVerifying ? "Verifying..." : "Verify command"}
              </button>
            )}
            {step.docsUrl && (
              <a
                href={step.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-neutral-500 hover:text-neutral-300 transition flex items-center gap-1"
              >
                Docs
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
