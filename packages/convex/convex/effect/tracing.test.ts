import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const dsn = "https://examplePublicKey@o0.ingest.sentry.io/0";

describe("effect tracing", () => {
  it("initializes tracing layer when SENTRY_DSN is set", async () => {
    const previous = process.env.SENTRY_DSN;
    process.env.SENTRY_DSN = dsn;

    vi.resetModules();
    const { TracingLive } = await import("./tracing");

    const result = await Effect.runPromise(
      Effect.succeed("ok").pipe(Effect.provide(TracingLive))
    );

    expect(result).toBe("ok");

    if (previous === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = previous;
    }
  });

  it("noops when SENTRY_DSN is not set", async () => {
    const previous = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;

    vi.resetModules();
    const { TracingLive } = await import("./tracing");

    const result = await Effect.runPromise(
      Effect.succeed("ok").pipe(Effect.provide(TracingLive))
    );

    expect(result).toBe("ok");

    if (previous !== undefined) {
      process.env.SENTRY_DSN = previous;
    }
  });
});
