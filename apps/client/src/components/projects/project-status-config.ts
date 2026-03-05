/**
 * Project status configuration
 *
 * Shared status labels, colors, and backgrounds for project statuses.
 * Used by ProjectDetailView, ProjectCard, and other project components.
 */

export type ProjectStatus = "planning" | "active" | "paused" | "completed" | "archived";

export const PROJECT_STATUS_CONFIG: Record<
  ProjectStatus,
  { label: string; color: string; bgColor: string }
> = {
  planning: {
    label: "Planning",
    color: "text-purple-600 dark:text-purple-400",
    bgColor: "bg-purple-100 dark:bg-purple-900/30",
  },
  active: {
    label: "Active",
    color: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-100 dark:bg-blue-900/30",
  },
  paused: {
    label: "Paused",
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-100 dark:bg-amber-900/30",
  },
  completed: {
    label: "Completed",
    color: "text-green-600 dark:text-green-400",
    bgColor: "bg-green-100 dark:bg-green-900/30",
  },
  archived: {
    label: "Archived",
    color: "text-neutral-600 dark:text-neutral-400",
    bgColor: "bg-neutral-100 dark:bg-neutral-900/30",
  },
};
