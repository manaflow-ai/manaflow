import { GitHubIcon } from "@/components/icons/github";
import { VSCodeIcon } from "@/components/icons/VSCodeIcon";
import {
  formatPreviewTimestamp,
  getLatestPreviewRunsByPr,
  makePreviewPrKey,
  previewStatusDotClass,
  type PreviewRunWithExtras,
} from "@/lib/previewRuns";
import { api } from "@cmux/convex/api";
import { Link } from "@tanstack/react-router";
import { useQuery as useConvexQuery } from "convex/react";
import clsx from "clsx";
import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  Globe,
  Monitor,
} from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { SidebarListItem } from "./SidebarListItem";
import { SIDEBAR_PRS_DEFAULT_LIMIT } from "./const";
import type { Doc } from "@cmux/convex/dataModel";

type Props = {
  teamSlugOrId: string;
  limit?: number;
};

export function SidebarPullRequestList({
  teamSlugOrId,
  limit = SIDEBAR_PRS_DEFAULT_LIMIT,
}: Props) {
  const prs = useConvexQuery(api.github_prs.listPullRequests, {
    teamSlugOrId,
    state: "open",
    limit,
  });
  const previewRuns = useConvexQuery(api.previewRuns.listByTeam, {
    teamSlugOrId,
    limit: limit * 5,
  });

  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const list = useMemo(() => prs ?? [], [prs]);
  const latestPreviewRuns = useMemo(
    () => getLatestPreviewRunsByPr(previewRuns ?? undefined),
    [previewRuns]
  );

  if (prs === undefined) {
    return (
      <ul className="flex flex-col gap-px" aria-label="Loading pull requests">
        {Array.from({ length: limit }).map((_, index) => (
          <li key={index} className="px-2 py-1.5">
            <div className="h-3 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
          </li>
        ))}
      </ul>
    );
  }

  if (list.length === 0) {
    return (
      <p className="mt-1 pl-2 pr-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 select-none">
        No pull requests
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-px">
      {list.map((pr) => (
        <PullRequestListItem
          key={`${pr.repoFullName}#${pr.number}`}
          pr={pr}
          teamSlugOrId={teamSlugOrId}
          expanded={expanded}
          setExpanded={setExpanded}
          previewRun={latestPreviewRuns.get(
            makePreviewPrKey(pr.repoFullName, pr.number)
          )}
          previewLoading={previewRuns === undefined}
        />
      ))}
    </ul>
  );
}

type PullRequestListItemProps = {
  pr: Doc<"pullRequests">;
  teamSlugOrId: string;
  expanded: Record<string, boolean>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  previewRun?: PreviewRunWithExtras;
  previewLoading: boolean;
};

function PullRequestListItem({
  pr,
  teamSlugOrId,
  expanded,
  setExpanded,
  previewRun,
  previewLoading,
}: PullRequestListItemProps) {
  const [owner = "", repo = ""] = pr.repoFullName?.split("/", 2) ?? ["", ""];
  const key = `${pr.repoFullName}#${pr.number}`;
  const isExpanded = expanded[key] ?? false;
  const branchLabel = pr.headRef;

  const secondaryParts = [
    branchLabel,
    `${pr.repoFullName}#${pr.number}`,
    pr.authorLogin,
  ]
    .filter(Boolean)
    .map(String);
  const secondary = secondaryParts.join(" • ");
  const leadingIcon = pr.merged ? (
    <GitMerge className="w-3 h-3 text-purple-500" />
  ) : pr.state === "closed" ? (
    <GitPullRequestClosed className="w-3 h-3 text-red-500" />
  ) : pr.draft ? (
    <GitPullRequestDraft className="w-3 h-3 text-neutral-500" />
  ) : (
    <GitPullRequest className="w-3 h-3 text-[#1f883d] dark:text-[#238636]" />
  );

  const handleToggle = (
    _event?: MouseEvent<HTMLButtonElement | HTMLAnchorElement>
  ) => {
    setExpanded((prev) => ({
      ...prev,
      [key]: !isExpanded,
    }));
  };

  return (
    <li key={key} className="rounded-md select-none">
      <Link
        to="/$teamSlugOrId/prs-only/$owner/$repo/$number"
        params={{
          teamSlugOrId,
          owner,
          repo,
          number: String(pr.number),
        }}
        className="group block"
        onClick={(event) => {
          if (
            event.defaultPrevented ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          handleToggle(event);
        }}
      >
        <SidebarListItem
          paddingLeft={10}
          toggle={{
            expanded: isExpanded,
            onToggle: handleToggle,
            visible: true,
          }}
          title={pr.title}
          titleClassName="text-[13px] text-neutral-950 dark:text-neutral-100"
          secondary={secondary || undefined}
          meta={leadingIcon}
        />
      </Link>
      {isExpanded ? (
        <div className="mt-px flex flex-col" role="group">
          <SidebarPreviewRunDetails
            previewRun={previewRun}
            isLoading={previewLoading}
            teamSlugOrId={teamSlugOrId}
          />
          {pr.htmlUrl ? (
            <a
              href={pr.htmlUrl}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.stopPropagation();
              }}
              className="mt-1 flex w-full items-center rounded-md pr-2 py-1 text-xs transition-colors hover:bg-neutral-200/45 dark:hover:bg-neutral-800/45"
              style={{ paddingLeft: "32px" }}
            >
              <GitHubIcon
                className="mr-2 h-3 w-3 text-neutral-400 grayscale opacity-60"
                aria-hidden
              />
              <span className="text-neutral-600 dark:text-neutral-400">
                GitHub
              </span>
            </a>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function SidebarPreviewRunDetails({
  previewRun,
  isLoading,
  teamSlugOrId,
}: {
  previewRun?: PreviewRunWithExtras;
  isLoading: boolean;
  teamSlugOrId: string;
}) {
  const taskRun = useConvexQuery(
    api.taskRuns.get,
    previewRun?.taskRunId
      ? { teamSlugOrId, id: previewRun.taskRunId }
      : "skip"
  );

  const previewServices =
    taskRun?.networking?.filter((svc) => svc.status === "running") ?? [];

  if (isLoading) {
    return (
      <div className="mt-1 rounded-md border border-neutral-200/80 dark:border-neutral-800/70 bg-neutral-50/70 dark:bg-neutral-900/40 px-3 py-2.5">
        <div className="h-2 w-24 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
        <div className="mt-2 h-2 w-32 rounded bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
      </div>
    );
  }

  if (!previewRun) {
    return (
      <div className="mt-1 rounded-md border border-dashed border-neutral-200/70 dark:border-neutral-800/70 bg-neutral-50/60 dark:bg-neutral-900/30 px-3 py-2.5 text-[11px] text-neutral-500 dark:text-neutral-400">
        No preview run yet for this pull request.
      </div>
    );
  }

  const statusClass = previewStatusDotClass(previewRun.status);
  const timestamp =
    previewRun.completedAt ?? previewRun.startedAt ?? previewRun.createdAt;
  const formattedTime = formatPreviewTimestamp(timestamp);
  const taskId = previewRun.taskId ?? taskRun?.taskId;
  const runId = previewRun.taskRunId;
  const headRef = previewRun.headRef;

  const hasActiveVSCode = taskRun?.vscode?.status === "running";
  const browserReady = taskRun?.vscode?.provider === "morph";
  const previewLinks =
    taskId && runId ? previewServices.slice(0, 2) : [];

  const actions: JSX.Element[] = [];

  if (taskId && runId) {
    actions.push(
      <Link
        key="run"
        to="/$teamSlugOrId/task/$taskId"
        params={{ teamSlugOrId, taskId }}
        search={{ runId }}
        className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700 dark:hover:bg-neutral-700/80"
      >
        <GitPullRequest className="h-3 w-3" aria-hidden="true" />
        Run
      </Link>
    );
  }

  if (hasActiveVSCode && taskId && runId) {
    actions.push(
      <Link
        key="vscode"
        to="/$teamSlugOrId/task/$taskId/run/$runId/vscode"
        params={{ teamSlugOrId, taskId, runId }}
        className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700 dark:hover:bg-neutral-700/80"
      >
        <VSCodeIcon className="h-3.5 w-3.5" aria-hidden="true" />
        VS Code
      </Link>
    );
  }

  if (browserReady && taskId && runId) {
    actions.push(
      <Link
        key="browser"
        to="/$teamSlugOrId/task/$taskId/run/$runId/browser"
        params={{ teamSlugOrId, taskId, runId }}
        className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700 dark:hover:bg-neutral-700/80"
      >
        <Monitor className="h-3 w-3" aria-hidden="true" />
        Browser
      </Link>
    );
  }

  previewLinks.forEach((service) => {
    actions.push(
      <Link
        key={`preview-${service.port}`}
        to="/$teamSlugOrId/task/$taskId/run/$runId/preview/$previewId"
        params={{
          teamSlugOrId,
          taskId: taskId!,
          runId: runId!,
          previewId: String(service.port),
        }}
        className="inline-flex items-center gap-1 rounded-md bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-700 shadow-sm ring-1 ring-neutral-200 hover:bg-neutral-100 dark:bg-neutral-800 dark:text-neutral-200 dark:ring-neutral-700 dark:hover:bg-neutral-700/80"
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            window.open(service.url, "_blank", "noopener,noreferrer");
          }
        }}
      >
        <Globe className="h-3 w-3" aria-hidden="true" />
        Preview {service.port}
      </Link>
    );
  });

  return (
    <div className="mt-1 rounded-md border border-neutral-200/80 dark:border-neutral-800/70 bg-neutral-50/80 dark:bg-neutral-900/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={clsx("h-2 w-2 rounded-full", statusClass)}
            aria-hidden="true"
          />
          <div className="text-[12px] font-semibold text-neutral-800 dark:text-neutral-100 truncate">
            Latest preview
          </div>
        </div>
        {formattedTime ? (
          <span className="whitespace-nowrap text-[11px] text-neutral-500 dark:text-neutral-400">
            {formattedTime}
          </span>
        ) : null}
      </div>
      <div className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400 truncate">
        PR #{previewRun.prNumber}
        {headRef ? ` • ${headRef}` : ""}
      </div>
      {actions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>
      ) : (
        <p className="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
          Preview workspace details are not available yet.
        </p>
      )}
      {previewLinks.length > 0 && previewServices.length > previewLinks.length ? (
        <p className="mt-1 text-[10px] text-neutral-500 dark:text-neutral-400">
          +{previewServices.length - previewLinks.length} more preview port
          {previewServices.length - previewLinks.length === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}

export default SidebarPullRequestList;
