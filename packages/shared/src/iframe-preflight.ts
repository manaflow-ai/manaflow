const IFRAME_PREFLIGHT_SERVER_PHASES = [
  "resuming",
  "resume_retry",
  "resumed",
  "already_ready",
  "ready",
  "resume_failed",
  "resume_forbidden",
  "instance_not_found",
  "preflight_failed",
  "error",
] as const;

type KnownRecord = Record<string, unknown>;

export type IframePreflightServerPhase =
  (typeof IFRAME_PREFLIGHT_SERVER_PHASES)[number];

export type IframePreflightPhasePayload = {
  phase: IframePreflightServerPhase;
} & KnownRecord;

export type IframePreflightMethod = "HEAD" | "GET";

export interface IframePreflightResult {
  ok: boolean;
  status: number | null;
  method: IframePreflightMethod | null;
  error?: string;
}

export type SendPhaseFn = (
  phase: IframePreflightServerPhase,
  extra?: KnownRecord,
) => Promise<void>;

const isRecord = (value: unknown): value is KnownRecord =>
  typeof value === "object" && value !== null;

export const isIframePreflightServerPhase = (
  value: unknown,
): value is IframePreflightServerPhase => {
  if (typeof value !== "string") {
    return false;
  }
  switch (value) {
    case "resuming":
    case "resume_retry":
    case "resumed":
    case "already_ready":
    case "ready":
    case "resume_failed":
    case "resume_forbidden":
    case "instance_not_found":
    case "preflight_failed":
    case "error":
      return true;
    default:
      return false;
  }
};

export const isIframePreflightPhasePayload = (
  value: unknown,
): value is IframePreflightPhasePayload => {
  if (!isRecord(value)) {
    return false;
  }

  if (!isIframePreflightServerPhase(value.phase)) {
    return false;
  }

  return true;
};

export const isIframePreflightResult = (
  value: unknown,
): value is IframePreflightResult => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.ok !== "boolean") {
    return false;
  }

  if (value.status !== null && typeof value.status !== "number") {
    return false;
  }

  const method = value.method;
  if (method !== null && method !== "HEAD" && method !== "GET") {
    return false;
  }

  if (
    "error" in value &&
    value.error !== undefined &&
    typeof value.error !== "string"
  ) {
    return false;
  }

  return true;
};
