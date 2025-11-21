import { env } from "@/client-env";
import { AgentLogo } from "@/components/icons/agent-logos";
import { GitHubIcon } from "@/components/icons/github";
import { ModeToggleTooltip } from "@/components/ui/mode-toggle-tooltip";
import SearchableSelect, {
  type SearchableSelectHandle,
  type SelectOption,
  type SelectOptionObject,
} from "@/components/ui/searchable-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isElectron } from "@/lib/electron";
import { api } from "@cmux/convex/api";
import type { ProviderStatus, ProviderStatusResponse } from "@cmux/shared";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { Link, useRouter } from "@tanstack/react-router";
import clsx from "clsx";
import { useMutation } from "convex/react";
import { GitBranch, Image, Mic, Server, X } from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCommandItem, MAX_AGENT_COMMAND_COUNT } from "./AgentCommandItem";

interface DashboardInputControlsProps {
  projectOptions: SelectOption[];
  selectedProject: string[];
  onProjectChange: (projects: string[]) => void;
  onProjectSearchPaste?: (value: string) => boolean | Promise<boolean>;
  branchOptions: string[];
  selectedBranch: string[];
  onBranchChange: (branches: string[]) => void;
  selectedAgents: string[];
  onAgentChange: (agents: string[]) => void;
  isCloudMode: boolean;
  onCloudModeToggle: () => void;
  isLoadingProjects: boolean;
  isLoadingBranches: boolean;
  teamSlugOrId: string;
  cloudToggleDisabled?: boolean;
  branchDisabled?: boolean;
  providerStatus?: ProviderStatusResponse | null;
}

type AgentOption = SelectOptionObject & { displayLabel: string };

type AgentSelectionInstance = {
  agent: string;
  id: string;
};

export const DashboardInputControls = memo(function DashboardInputControls({
  projectOptions,
  selectedProject,
  onProjectChange,
  onProjectSearchPaste,
  branchOptions,
  selectedBranch,
  onBranchChange,
  selectedAgents,
  onAgentChange,
  isCloudMode,
  onCloudModeToggle,
  isLoadingProjects,
  isLoadingBranches,
  teamSlugOrId,
  cloudToggleDisabled = false,
  branchDisabled = false,
  providerStatus = null,
}: DashboardInputControlsProps) {
  const router = useRouter();
  const agentSelectRef = useRef<SearchableSelectHandle | null>(null);
  const mintState = useMutation(api.github_app.mintInstallState);
  const providerStatusMap = useMemo(() => {
    const map = new Map<string, ProviderStatus>();
    providerStatus?.providers?.forEach((provider) => {
      map.set(provider.name, provider);
    });
    return map;
  }, [providerStatus?.providers]);
  const handleOpenSettings = useCallback(() => {
    void router.navigate({
      to: "/$teamSlugOrId/settings",
      params: { teamSlugOrId },
    });
  }, [router, teamSlugOrId]);
  const agentOptions = useMemo<AgentOption[]>(() => {
    const vendorKey = (name: string): string => {
      const lower = name.toLowerCase();
      if (lower.startsWith("codex/")) return "openai";
      if (lower.startsWith("claude/")) return "claude";
      if (lower.startsWith("gemini/")) return "gemini";
      if (lower.startsWith("opencode/")) return "opencode";
      if (lower.startsWith("qwen/")) return "qwen";
      if (lower.startsWith("cursor/")) return "cursor";
      if (lower.startsWith("amp")) return "amp";
      return "other";
    };
    const shortName = (label: string): string => {
      const slashIndex = label.indexOf("/");
      return slashIndex >= 0 ? label.slice(slashIndex + 1) : label;
    };
    return AGENT_CONFIGS.map((agent) => {
      const status = providerStatusMap.get(agent.name);
      const missingRequirements = status?.missingRequirements ?? [];
      const isAvailable = status?.isAvailable ?? true;
      return {
        label: agent.name,
        displayLabel: shortName(agent.name),
        value: agent.name,
        icon: <AgentLogo agentName={agent.name} className="w-4 h-4" />,
        iconKey: vendorKey(agent.name),
        isUnavailable: !isAvailable,
        warning: !isAvailable
          ? {
            tooltip: (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-red-500">
                  Setup required
                </p>
                <p className="text-xs text-neutral-300">
                  Add credentials for this agent in Settings.
                </p>
                {missingRequirements.length > 0 ? (
                  <ul className="list-disc pl-4 text-xs text-neutral-400">
                    {missingRequirements.map((req) => (
                      <li key={req}>{req}</li>
                    ))}
                  </ul>
                ) : null}
                <p className="text-[10px] tracking-wide text-neutral-500 pt-1 border-t border-neutral-700">
                  Click to open settings
                </p>
              </div>
            ),
            onClick: handleOpenSettings,
          }
          : undefined,
      } satisfies AgentOption;
    });
  }, [handleOpenSettings, providerStatusMap]);

  const agentOptionsByValue = useMemo(() => {
    const map = new Map<string, AgentOption>();
    for (const option of agentOptions) {
      map.set(option.value, option);
    }
    return map;
  }, [agentOptions]);

  const generateInstanceId = () => crypto.randomUUID();

  const agentInstancesRef = useRef<AgentSelectionInstance[]>([]);

  const agentInstances = useMemo(() => {
    const previous = agentInstancesRef.current;
    const remaining = [...previous];
    const next: AgentSelectionInstance[] = [];

    for (const agent of selectedAgents) {
      const matchIndex = remaining.findIndex(
        (instance) => instance.agent === agent,
      );
      if (matchIndex !== -1) {
        next.push(remaining.splice(matchIndex, 1)[0]);
      } else {
        next.push({ agent, id: generateInstanceId() });
      }
    }

    agentInstancesRef.current = next;
    return next;
  }, [selectedAgents]);

  const instanceIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    agentInstances.forEach((instance, index) => {
      map.set(instance.id, index);
    });
    return map;
  }, [agentInstances]);

  const aggregatedAgentSelections = useMemo(() => {
    const vendorOrder = new Map<string, number>();
    agentOptions.forEach((option, index) => {
      const vendor = option.iconKey ?? "other";
      if (!vendorOrder.has(vendor)) vendorOrder.set(vendor, index);
    });

    const grouped = new Map<
      string,
      { option: AgentOption; instances: AgentSelectionInstance[] }
    >();

    for (const instance of agentInstances) {
      const option = agentOptionsByValue.get(instance.agent);
      if (!option) continue;
      const existing = grouped.get(option.value);
      if (existing) {
        existing.instances.push(instance);
      } else {
        grouped.set(option.value, { option, instances: [instance] });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => {
      const vendorA = a.option.iconKey ?? "other";
      const vendorB = b.option.iconKey ?? "other";
      const rankA = vendorOrder.get(vendorA) ?? Number.MAX_SAFE_INTEGER;
      const rankB = vendorOrder.get(vendorB) ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) return rankA - rankB;
      const labelComparison = a.option.displayLabel.localeCompare(
        b.option.displayLabel,
      );
      if (labelComparison !== 0) return labelComparison;
      const idA = a.instances[0]?.id ?? "";
      const idB = b.instances[0]?.id ?? "";
      return idA.localeCompare(idB);
    });
  }, [agentInstances, agentOptions, agentOptionsByValue]);

  const pillboxScrollRef = useRef<HTMLDivElement | null>(null);
  const [showPillboxFade, setShowPillboxFade] = useState(false);

  useEffect(() => {
    const node = pillboxScrollRef.current;
    if (!node) {
      setShowPillboxFade(false);
      return;
    }

    let rafId: number | null = null;

    const updateFade = () => {
      rafId = null;
      const { scrollTop, scrollHeight, clientHeight } = node;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
      const hasOverflow = scrollHeight > clientHeight + 1;
      const shouldShow = hasOverflow && !atBottom;
      setShowPillboxFade((previous) =>
        previous === shouldShow ? previous : shouldShow,
      );
    };

    const scheduleUpdate = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(updateFade);
    };

    scheduleUpdate();
    node.addEventListener("scroll", scheduleUpdate);

    const resizeObserver = new ResizeObserver(() => scheduleUpdate());
    resizeObserver.observe(node);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      node.removeEventListener("scroll", scheduleUpdate);
      resizeObserver?.disconnect();
    };
  }, []);

  const handleImageClick = useCallback(() => {
    // Trigger the file select from ImagePlugin
    const lexicalWindow = window as Window & {
      __lexicalImageFileSelect?: () => void;
    };
    if (lexicalWindow.__lexicalImageFileSelect) {
      lexicalWindow.__lexicalImageFileSelect();
    }
  }, []);

  const handleAgentRemove = useCallback(
    (instanceId: string) => {
      const instanceIndex = instanceIndexMap.get(instanceId);
      if (instanceIndex === undefined) {
        return;
      }
      const next = selectedAgents.filter((_, index) => index !== instanceIndex);
      onAgentChange(next);
    },
    [instanceIndexMap, onAgentChange, selectedAgents],
  );

  const handleFocusAgentOption = useCallback((agent: string) => {
    agentSelectRef.current?.open({ focusValue: agent });
  }, []);

  const agentSelectionFooter = selectedAgents.length ? (
    <div className="bg-neutral-50 dark:bg-neutral-900/70">
      <div className="relative">
        <div
          ref={pillboxScrollRef}
          className="max-h-32 overflow-y-auto py-2 px-2"
        >
          <div className="flex flex-wrap gap-1">
            {aggregatedAgentSelections.map(({ option, instances }) => {
              const label = option.displayLabel;
              const representativeInstance = instances[0];
              if (!representativeInstance) {
                return null;
              }
              const count = instances.length;
              return (
                <div
                  key={option.value}
                  className="inline-flex cursor-default items-center rounded-full bg-neutral-200/70 dark:bg-neutral-800/80 pl-1.5 pr-2 py-1 text-[11px] text-neutral-700 dark:text-neutral-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60 hover:bg-neutral-200 dark:hover:bg-neutral-700/80"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    handleFocusAgentOption(representativeInstance.agent)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleFocusAgentOption(representativeInstance.agent);
                    }
                  }}
                  aria-label={`Focus selection for ${label}`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      handleAgentRemove(representativeInstance.id);
                    }}
                    className="inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors hover:bg-neutral-400/30 dark:hover:bg-neutral-500/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                    <span className="sr-only">Remove all {label}</span>
                  </button>
                  {option.icon ? (
                    <span className="inline-flex h-3.5 w-3.5 items-center justify-center ml-0.5">
                      {option.icon}
                    </span>
                  ) : null}
                  <span className="max-w-[118px] truncate text-left select-none ml-1.5">
                    {label}
                  </span>
                  <span className="inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-neutral-300/80 px-1 text-[10px] font-semibold leading-4 text-neutral-700 dark:bg-neutral-700/70 dark:text-neutral-100 ml-1.5 tabular-nums select-none">
                    {count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        {showPillboxFade ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-neutral-50/60 via-neutral-50/15 to-transparent dark:from-neutral-900/70 dark:via-neutral-900/20" />
        ) : null}
      </div>
    </div>
  ) : (
    <div className="px-3 flex items-center text-[12px] text-neutral-500 dark:text-neutral-400 bg-neutral-50 dark:bg-neutral-900/70 h-[40.5px] select-none">
      No agents selected yet.
    </div>
  );

  function openCenteredPopup(
    url: string,
    opts?: { name?: string; width?: number; height?: number },
    onClose?: () => void,
  ): Window | null {
    if (isElectron) {
      // In Electron, always open in the system browser and skip popup plumbing
      window.open(url, "_blank", "noopener,noreferrer");
      return null;
    }
    const name = opts?.name ?? "cmux-popup";
    const width = Math.floor(opts?.width ?? 980);
    const height = Math.floor(opts?.height ?? 780);
    const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
    const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
    const outerWidth = window.outerWidth || window.innerWidth || width;
    const outerHeight = window.outerHeight || window.innerHeight || height;
    const left = Math.max(0, dualScreenLeft + (outerWidth - width) / 2);
    const top = Math.max(0, dualScreenTop + (outerHeight - height) / 2);
    const features = [
      `width=${width}`,
      `height=${height}`,
      `left=${Math.floor(left)}`,
      `top=${Math.floor(top)}`,
      "resizable=yes",
      "scrollbars=yes",
      "toolbar=no",
      "location=no",
      "status=no",
      "menubar=no",
    ].join(",");

    const win = window.open("about:blank", name, features);
    if (win) {
      try {
        (win as Window & { opener: null | Window }).opener = null;
      } catch {
        /* noop */
      }
      try {
        win.location.href = url;
      } catch {
        window.open(url, "_blank");
      }
      win.focus?.();
      if (onClose) watchPopupClosed(win, onClose);
      return win;
    } else {
      window.open(url, "_blank");
      return null;
    }
  }

  function watchPopupClosed(win: Window | null, onClose: () => void): void {
    if (!win) return;
    const timer = window.setInterval(() => {
      try {
        if (win.closed) {
          window.clearInterval(timer);
          onClose();
        }
      } catch {
        /* noop */
      }
    }, 600);
  }

  return (
    <div className="flex items-end gap-1 grow">
      <div className="flex items-end gap-1">
        <SearchableSelect
          options={projectOptions}
          value={selectedProject}
          onChange={onProjectChange}
          onSearchPaste={onProjectSearchPaste}
          placeholder="Select project"
          singleSelect={true}
          className="rounded-2xl"
          loading={isLoadingProjects}
          maxTagCount={1}
          showSearch
          footer={
            <div className="p-1">
              <Link
                to="/$teamSlugOrId/environments/new"
                params={{ teamSlugOrId }}
                search={{
                  step: undefined,
                  selectedRepos: undefined,
                  connectionLogin: undefined,
                  repoSearch: undefined,
                  instanceId: undefined,
                  snapshotId: undefined,
                }}
                className="w-full px-2 h-8 flex items-center gap-2 text-[13.5px] text-neutral-800 dark:text-neutral-200 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-900 cursor-default"
              >
                <Server className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
                <span className="select-none">Create environment</span>
              </Link>
              {env.NEXT_PUBLIC_GITHUB_APP_SLUG ? (
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault();
                    try {
                      const slug = env.NEXT_PUBLIC_GITHUB_APP_SLUG!;
                      const baseUrl = `https://github.com/apps/${slug}/installations/new`;
                      const { state } = await mintState({ teamSlugOrId });
                      const sep = baseUrl.includes("?") ? "&" : "?";
                      const url = `${baseUrl}${sep}state=${encodeURIComponent(
                        state,
                      )}`;
                      const win = openCenteredPopup(
                        url,
                        { name: "github-install" },
                        () => {
                          router.options.context?.queryClient?.invalidateQueries();
                        },
                      );
                      win?.focus?.();
                    } catch (err) {
                      console.error("Failed to start GitHub install:", err);
                      alert("Failed to start installation. Please try again.");
                    }
                  }}
                  className="w-full px-2 h-8 flex items-center gap-2 text-[13.5px] text-neutral-800 dark:text-neutral-200 rounded-md hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  <GitHubIcon className="w-4 h-4 text-neutral-600 dark:text-neutral-300" />
                  <span className="select-none">Add repos from GitHub</span>
                </button>
              ) : null}
            </div>
          }
        />

        {branchDisabled ? null : (
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <SearchableSelect
                  options={branchOptions}
                  value={selectedBranch}
                  onChange={onBranchChange}
                  placeholder="Branch"
                  singleSelect={true}
                  className="rounded-2xl"
                  loading={isLoadingBranches}
                  showSearch
                  disabled={branchDisabled}
                  leftIcon={
                    <GitBranch className="w-4 h-4 text-neutral-500 dark:text-neutral-400" />
                  }
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>Branch this task starts from</TooltipContent>
          </Tooltip>
        )}

        <SearchableSelect
          ref={agentSelectRef}
          options={agentOptions}
          value={selectedAgents}
          onChange={onAgentChange}
          placeholder="Select agents"
          singleSelect={false}
          maxTagCount={1}
          className="rounded-2xl"
          classNames={{
            popover: "w-[315px]",
          }}
          showSearch
          countLabel="agents"
          footer={agentSelectionFooter}
          itemVariant="agent"
          optionItemComponent={AgentCommandItem}
          maxCountPerValue={MAX_AGENT_COMMAND_COUNT}
        />
      </div>

      <div className="flex items-center justify-end gap-2.5 ml-auto mr-0 pr-1">
        {/* Cloud/Local Mode Toggle */}
        <ModeToggleTooltip
          isCloudMode={isCloudMode}
          onToggle={onCloudModeToggle}
          disabled={cloudToggleDisabled}
        />

        <button
          className={clsx(
            "p-1.5 rounded-full",
            "bg-neutral-100 dark:bg-neutral-700",
            "border border-neutral-200 dark:border-neutral-500/15",
            "text-neutral-600 dark:text-neutral-400",
            "hover:bg-neutral-200 dark:hover:bg-neutral-600",
            "transition-colors",
          )}
          onClick={handleImageClick}
          title="Upload image"
        >
          <Image className="w-4 h-4" />
        </button>

        <button
          className={clsx(
            "p-1.5 rounded-full",
            "bg-neutral-100 dark:bg-neutral-700",
            "border border-neutral-200 dark:border-neutral-500/15",
            "text-neutral-600 dark:text-neutral-400",
            "hover:bg-neutral-200 dark:hover:bg-neutral-600",
            "transition-colors",
          )}
        >
          <Mic className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
});
