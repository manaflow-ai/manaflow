"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Eye, ThumbsUp, Laugh, Heart, Rocket, MoreHorizontal, Check } from "lucide-react";

type Screenshot = {
  url: string;
  caption: string;
};

type MockGitHubCommentProps = {
  repoFullName?: string;
  prNumber?: number;
  screenshots?: Screenshot[];
};

const DEFAULT_SCREENSHOTS: Screenshot[] = [
  {
    url: "https://placehold.co/800x500/1a1a2e/6366f1?text=Dashboard+View",
    caption: "Dashboard - Main view",
  },
  {
    url: "https://placehold.co/800x500/1a1a2e/10b981?text=Settings+Panel",
    caption: "Settings panel",
  },
  {
    url: "https://placehold.co/800x500/1a1a2e/f59e0b?text=Modal+Dialog",
    caption: "Modal dialog",
  },
];

function GitHubAvatar({ seed, size = 32 }: { seed: string; size?: number }) {
  // Simple hash function for consistent colors
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash % 360);

  return (
    <div
      className="rounded-full flex items-center justify-center text-white font-medium shrink-0"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${hue}, 70%, 50%), hsl(${(hue + 40) % 360}, 70%, 40%))`,
        fontSize: size * 0.4,
      }}
    >
      {seed.charAt(0).toUpperCase()}
    </div>
  );
}

function ReactionButton({ icon: Icon, count, active, onClick }: { icon: React.ElementType; count: number; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
        active
          ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
          : "bg-[#21262d] border-[#30363d] text-[#8b949e] hover:border-[#8b949e]"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{count}</span>
    </button>
  );
}

export function MockGitHubComment({
  repoFullName = "acme/webapp",
  prNumber = 42,
  screenshots = DEFAULT_SCREENSHOTS,
}: MockGitHubCommentProps) {
  const [expandedScreenshots, setExpandedScreenshots] = useState(true);
  const [reactions, setReactions] = useState({ eyes: 2, thumbsUp: 1, rocket: 0 });
  const [copiedLink, setCopiedLink] = useState(false);

  const handleCopyLink = () => {
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const toggleReaction = (type: keyof typeof reactions) => {
    setReactions(prev => ({
      ...prev,
      [type]: prev[type] > 0 ? prev[type] - 1 : prev[type] + 1,
    }));
  };

  return (
    <div className="w-full">
      {/* PR Header */}
      <div className="bg-[#0d1117] border border-[#30363d] rounded-t-md">
        <div className="px-4 py-3 border-b border-[#30363d] flex items-center gap-3">
          <svg className="w-5 h-5 text-[#3fb950]" viewBox="0 0 16 16" fill="currentColor">
            <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
          </svg>
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[#c9d1d9] font-semibold truncate">Add new dashboard features</span>
            <span className="text-[#8b949e] shrink-0">#{prNumber}</span>
          </div>
          <span className="ml-auto px-2 py-0.5 text-xs font-medium rounded-full bg-[#238636]/20 text-[#3fb950] border border-[#238636]/40 shrink-0">
            Open
          </span>
        </div>
        <div className="px-4 py-2 text-xs text-[#8b949e] flex items-center gap-2">
          <span className="text-[#c9d1d9]">{repoFullName.split("/")[0]}</span>
          <span>/</span>
          <span className="text-[#c9d1d9] font-semibold">{repoFullName.split("/")[1]}</span>
        </div>
      </div>

      {/* Comment */}
      <div className="bg-[#0d1117] border-x border-b border-[#30363d] rounded-b-md">
        {/* Comment header */}
        <div className="px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex items-center gap-3">
          <GitHubAvatar seed="preview-bot" size={24} />
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-[#c9d1d9]">preview-bot</span>
            <span className="px-1.5 py-0.5 text-xs rounded-full bg-[#21262d] text-[#8b949e] border border-[#30363d]">bot</span>
            <span className="text-xs text-[#8b949e]">commented 2 minutes ago</span>
          </div>
          <button type="button" className="ml-auto p-1 text-[#8b949e] hover:text-[#c9d1d9]">
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Comment body */}
        <div className="px-4 py-4">
          {/* Status section */}
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-[#3fb950]" />
              <span className="text-sm text-[#c9d1d9] font-medium">Preview Ready</span>
            </div>

            <table className="w-full text-sm border border-[#30363d] rounded-md overflow-hidden">
              <thead className="bg-[#161b22]">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[#8b949e] border-b border-[#30363d]">Name</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[#8b949e] border-b border-[#30363d]">Status</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-[#8b949e] border-b border-[#30363d]">Preview</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-[#0d1117]">
                  <td className="px-3 py-2 text-[#c9d1d9] border-b border-[#30363d]">{repoFullName.split("/")[1]}</td>
                  <td className="px-3 py-2 border-b border-[#30363d]">
                    <span className="inline-flex items-center gap-1 text-[#3fb950]">
                      <Check className="w-3.5 h-3.5" />
                      Ready
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b border-[#30363d]">
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="inline-flex items-center gap-1.5 text-[#58a6ff] hover:underline text-sm"
                    >
                      {copiedLink ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <ExternalLink className="w-3.5 h-3.5" />
                          Visit Preview
                        </>
                      )}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Screenshots section */}
          <div className="border border-[#30363d] rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedScreenshots(!expandedScreenshots)}
              className="w-full px-3 py-2 bg-[#161b22] flex items-center gap-2 text-sm text-[#c9d1d9] hover:bg-[#21262d] transition-colors"
            >
              {expandedScreenshots ? (
                <ChevronDown className="w-4 h-4 text-[#8b949e]" />
              ) : (
                <ChevronRight className="w-4 h-4 text-[#8b949e]" />
              )}
              <span className="font-medium">Screenshots</span>
              <span className="text-[#8b949e]">({screenshots.length})</span>
            </button>

            {expandedScreenshots && (
              <div className="p-4 bg-[#0d1117] grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {screenshots.map((screenshot, index) => (
                  <div key={index} className="group">
                    <div className="relative rounded-md overflow-hidden border border-[#30363d] bg-[#161b22]">
                      <img
                        src={screenshot.url}
                        alt={screenshot.caption}
                        className="w-full h-40 object-cover"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <button type="button" className="p-2 bg-[#21262d] rounded-md text-[#c9d1d9] hover:bg-[#30363d] transition-colors">
                          <Eye className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-[#8b949e] truncate">{screenshot.caption}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-[#30363d] flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <ReactionButton
                icon={Eye}
                count={reactions.eyes}
                active={reactions.eyes > 0}
                onClick={() => toggleReaction("eyes")}
              />
              <ReactionButton
                icon={ThumbsUp}
                count={reactions.thumbsUp}
                active={reactions.thumbsUp > 0}
                onClick={() => toggleReaction("thumbsUp")}
              />
              <ReactionButton
                icon={Rocket}
                count={reactions.rocket}
                active={reactions.rocket > 0}
                onClick={() => toggleReaction("rocket")}
              />
              <button
                type="button"
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[#8b949e] hover:bg-[#21262d] transition-colors"
              >
                <Laugh className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="inline-flex items-center justify-center w-7 h-7 rounded-full text-[#8b949e] hover:bg-[#21262d] transition-colors"
              >
                <Heart className="w-4 h-4" />
              </button>
            </div>
            <span className="text-xs text-[#8b949e] ml-auto">
              Generated by <span className="text-[#58a6ff]">preview.new</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
