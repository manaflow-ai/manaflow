import { Effect } from "effect";

export type HttpError = {
  _tag: "HttpError";
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export function httpError(
  status: number,
  body: unknown,
  headers?: Record<string, string>
): HttpError {
  return { _tag: "HttpError", status, body, headers };
}

export function isHttpError(error: unknown): error is HttpError {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error as { _tag?: string })._tag === "HttpError"
  );
}

export function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
  });
}

export function runHttpEffect(
  effect: Effect.Effect<Response, unknown, never>
): Promise<Response> {
  return Effect.runPromise(
    effect.pipe(
      Effect.catchAll((error) => {
        if (isHttpError(error)) {
          return Effect.succeed(
            jsonResponse(error.body, error.status, error.headers)
          );
        }
        const detail = error instanceof Error ? error : new Error(String(error));
        console.error("[effect.http] Unhandled error", detail);
        return Effect.succeed(jsonResponse({ error: "Internal Server Error" }, 500));
      })
    )
  );
}

export function requireJsonContentType(req: Request): Effect.Effect<void, HttpError> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return Effect.fail(
      httpError(415, { code: 415, message: "Content-Type must be application/json" })
    );
  }
  return Effect.succeed(undefined);
}

export function parseJsonBody(req: Request): Effect.Effect<unknown, HttpError> {
  return Effect.tryPromise({
    try: () => req.json(),
    catch: () => httpError(400, { code: 400, message: "Invalid JSON body" }),
  });
}
