/**
 * Onboarding tour step configuration
 * Each step targets a DOM element via data-tour attribute
 */

export interface TourStep {
  /** Unique identifier for the step */
  id: string;
  /** Target element selector via data-tour attribute */
  target: string;
  /** Title of the step */
  title: string;
  /** Description/content of the step */
  content: string;
  /** Placement of the tooltip relative to target */
  placement: "top" | "bottom" | "left" | "right";
  /** Optional: spotlight padding around the target element */
  spotlightPadding?: number;
  /** Optional: action button text (defaults to "Next") */
  nextText?: string;
  /** Optional: whether to disable interaction with target during this step */
  disableInteraction?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "task-input",
    target: "[data-tour='task-input']",
    title: "Describe your task",
    content:
      "Type what you want to build or fix. Be specific about your goals - you can include code snippets, error messages, or feature descriptions.",
    placement: "bottom",
    spotlightPadding: 8,
  },
  {
    id: "repo-picker",
    target: "[data-tour='repo-picker']",
    title: "Select a repository",
    content:
      "Choose the GitHub repository you want to work on. Connect your GitHub account to see your repos, or paste any public repo URL.",
    placement: "bottom",
    spotlightPadding: 4,
  },
  {
    id: "branch-picker",
    target: "[data-tour='branch-picker']",
    title: "Choose a branch",
    content:
      "Select which branch to start from. Agents will create a new branch from here for their changes.",
    placement: "bottom",
    spotlightPadding: 4,
  },
  {
    id: "agent-selector",
    target: "[data-tour='agent-selector']",
    title: "Pick your agents",
    content:
      "Select one or more AI coding agents to work on your task in parallel. Each agent runs independently, giving you multiple solutions to compare.",
    placement: "bottom",
    spotlightPadding: 4,
  },
  {
    id: "cloud-toggle",
    target: "[data-tour='cloud-toggle']",
    title: "Cloud or Local mode",
    content:
      "Cloud mode runs agents on remote servers. Local mode uses Docker on your machine for faster iteration and offline work.",
    placement: "bottom",
    spotlightPadding: 8,
  },
  {
    id: "start-button",
    target: "[data-tour='start-button']",
    title: "Start your task",
    content:
      "Once everything is set, click here to launch your agents. Use Cmd+Enter (or Ctrl+Enter) as a shortcut.",
    placement: "top",
    spotlightPadding: 4,
  },
  {
    id: "sidebar",
    target: "[data-tour='sidebar']",
    title: "Your workspace",
    content:
      "Access your task history, environments, and settings from the sidebar. Running tasks appear here with live status updates.",
    placement: "right",
    spotlightPadding: 0,
  },
];

export const STORAGE_KEY = "cmux_onboarding_completed";
export const STORAGE_KEY_STEP = "cmux_onboarding_last_step";
