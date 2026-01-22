import { Effect } from "effect";

type AnnotationValue = string | number | boolean;

export type ObservabilityAttributes = Record<string, AnnotationValue | undefined | null>;

function sanitizeAttributes(
  attributes: ObservabilityAttributes | undefined
): Record<string, AnnotationValue> {
  if (!attributes) {
    return {};
  }

  const sanitized: Record<string, AnnotationValue> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function withObservability(
  name: string,
  attributes?: ObservabilityAttributes
): <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R> {
  return (effect) => {
    const sanitized = sanitizeAttributes(attributes);
    return Effect.logDebug(`${name}.start`).pipe(
      Effect.zipRight(effect),
      Effect.tap(() => Effect.logDebug(`${name}.success`)),
      Effect.tapError((error) => logEffectError(`${name}.error`, error)),
      Effect.annotateLogs(sanitized),
      Effect.tap(() => Effect.annotateCurrentSpan(sanitized)),
      Effect.withSpan(name, { attributes: sanitized }),
      Effect.withLogSpan(name)
    );
  };
}

export function logEffectError<E>(label: string, error: E): Effect.Effect<void> {
  const detail = error instanceof Error ? error : new Error(String(error));
  return Effect.logError(`${label}: ${detail.message}`);
}
