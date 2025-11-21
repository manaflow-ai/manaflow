import type { ErrorEvent } from "@sentry/nextjs";
import { stackServerApp } from "@/lib/utils/stack";

function buildRequestFromEvent(event: ErrorEvent): Request | null {
  if (!event.request?.headers) return null;

  const headers = new Headers();
  const headerEntries = Object.entries(event.request.headers as Record<string, unknown>);
  for (const [key, value] of headerEntries) {
    if (typeof value === "string") {
      headers.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      headers.set(key, value.join(", "));
    }
  }

  const url = typeof event.request.url === "string" ? event.request.url : "https://cmux.local";
  return new Request(url, { headers });
}

export async function attachStackAuthToEvent(event: ErrorEvent): Promise<ErrorEvent> {
  const request = buildRequestFromEvent(event);
  if (!request) return event;

  try {
    const user = await stackServerApp.getUser({ tokenStore: request, or: "return-null" });
    if (!user) {
      return event;
    }

    const existingUser = event.user ?? {};
    event.user = {
      ...existingUser,
      id: user.id,
      email: user.primaryEmail ?? existingUser.email,
    };

    event.tags = {
      ...event.tags,
      team_id: user.selectedTeam?.id ?? "unknown",
    };
  } catch (error) {
    console.error("[sentry] Failed to attach Stack Auth user", error);
  }

  return event;
}
