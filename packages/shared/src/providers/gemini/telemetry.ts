export const GEMINI_TELEMETRY_OUTFILE_TEMPLATE =
  "/tmp/gemini-telemetry-$CMUX_TASK_RUN_ID.log";

export function getGeminiTelemetryPath(taskRunId: string): string {
  return `/tmp/gemini-telemetry-${taskRunId}.log`;
}
