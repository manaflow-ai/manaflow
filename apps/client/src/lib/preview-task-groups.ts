import type { Doc } from "@cmux/convex/dataModel";

const PR_URL_REGEX = /https?:\/\/[^/\s]+\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/i;
const PR_NUMBER_REGEX = /PR\s*#?(\d+)/i;

type PreviewTask = Doc<"tasks">;

type PreviewTaskIdentity = {
  key: string;
  label: string;
  prNumber?: number;
  repoFullName?: string;
};

export type PreviewTaskGroup = PreviewTaskIdentity & {
  latest: PreviewTask;
  previous: PreviewTask[];
};

function parsePreviewIdentity(task: PreviewTask): PreviewTaskIdentity {
  const combined = `${task.text ?? ""} ${task.description ?? ""}`;
  const urlMatch = combined.match(PR_URL_REGEX);

  let repoFullName: string | undefined =
    task.projectFullName?.trim() || undefined;
  let prNumber: number | undefined;

  if (urlMatch) {
    repoFullName = repoFullName ?? urlMatch[1];
    const parsed = Number.parseInt(urlMatch[2], 10);
    if (!Number.isNaN(parsed)) {
      prNumber = parsed;
    }
  }

  if (!prNumber) {
    const numberMatch = combined.match(PR_NUMBER_REGEX);
    if (numberMatch) {
      const parsed = Number.parseInt(numberMatch[1], 10);
      if (!Number.isNaN(parsed)) {
        prNumber = parsed;
      }
    }
  }

  const repoKey = repoFullName ? repoFullName.toLowerCase() : null;
  const key =
    prNumber && repoKey
      ? `${repoKey}#${prNumber}`
      : prNumber
        ? `pr-${prNumber}-${task._id}`
        : `task-${task._id}`;

  const labelBase =
    repoFullName?.trim() || task.text?.trim() || "Preview screenshots";
  const label = prNumber ? `${labelBase} · PR #${prNumber}` : labelBase;

  return {
    key,
    label,
    prNumber: prNumber ?? undefined,
    repoFullName: repoFullName ?? undefined,
  };
}

export function groupPreviewTasks(tasks: PreviewTask[]): PreviewTaskGroup[] {
  const groups = new Map<
    string,
    { identity: PreviewTaskIdentity; items: PreviewTask[] }
  >();

  for (const task of tasks) {
    const identity = parsePreviewIdentity(task);
    const existing = groups.get(identity.key);
    if (existing) {
      existing.items.push(task);
    } else {
      groups.set(identity.key, { identity, items: [task] });
    }
  }

  const grouped = Array.from(groups.values()).map(({ identity, items }) => {
    const sorted = [...items].sort(
      (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)
    );
    const [latest, ...previous] = sorted;

    return {
      ...identity,
      latest,
      previous,
    };
  });

  grouped.sort((a, b) => {
    const aActive = !a.latest.isCompleted;
    const bActive = !b.latest.isCompleted;
    if (aActive && !bActive) return -1;
    if (!aActive && bActive) return 1;
    return (b.latest.createdAt ?? 0) - (a.latest.createdAt ?? 0);
  });

  return grouped;
}
