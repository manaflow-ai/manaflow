import { Effect } from "effect";

export function runEffect<A>(effect: Effect.Effect<A, unknown, never>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.tapError((error) => {
        const detail = error instanceof Error ? error : new Error(String(error));
        console.error("[effect.runtime] Unhandled error", detail);
        return Effect.void;
      })
    )
  );
}
