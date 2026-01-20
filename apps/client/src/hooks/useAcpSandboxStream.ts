import { useCallback, useEffect, useRef, useState } from "react";

type StreamEvent = {
  seq: number;
  raw: string;
  createdAt: number;
  eventType?: string | null;
};

type StreamControl = {
  nextOffset?: number;
  upToDate?: boolean;
  truncated?: boolean;
};

export type AcpStreamStatus =
  | "idle"
  | "connecting"
  | "live"
  | "fallback"
  | "error";

type StreamOptions = {
  enabled: boolean;
  streamUrl: string | null;
  token: string | null;
  startOffset: number;
  maxEvents?: number;
};

const DEFAULT_MAX_EVENTS = 20_000;
const MAX_RECONNECT_ATTEMPTS = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStreamEvent(value: unknown): StreamEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const seq = value.seq;
  const raw = value.raw;
  const createdAt = value.createdAt;
  if (typeof seq !== "number" || typeof raw !== "string") {
    return null;
  }
  if (typeof createdAt !== "number") {
    return null;
  }
  const eventType = value.eventType;
  return {
    seq,
    raw,
    createdAt,
    eventType: typeof eventType === "string" ? eventType : null,
  };
}

function parseStreamControl(value: unknown): StreamControl {
  if (!isRecord(value)) {
    return {};
  }
  const nextOffset = value.nextOffset;
  const upToDate = value.upToDate;
  const truncated = value.truncated;
  return {
    nextOffset: typeof nextOffset === "number" ? nextOffset : undefined,
    upToDate: typeof upToDate === "boolean" ? upToDate : undefined,
    truncated: truncated === true,
  };
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch (error) {
    console.error("[acp.stream] Failed to parse JSON", error);
    return null;
  }
}

function parseSseChunk(chunk: string): Array<{ event: string; data: string }> {
  const events: Array<{ event: string; data: string }> = [];
  const rawEvents = chunk.split("\n\n").filter((entry) => entry.trim().length > 0);
  for (const rawEvent of rawEvents) {
    let eventType = "message";
    const dataLines: string[] = [];
    for (const line of rawEvent.split("\n")) {
      if (line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (dataLines.length === 0) {
      continue;
    }
    events.push({ event: eventType, data: dataLines.join("\n") });
  }
  return events;
}

export function useAcpSandboxStream(options: StreamOptions): {
  events: StreamEvent[];
  status: AcpStreamStatus;
  lastOffset: number;
} {
  const { enabled, streamUrl, token, startOffset, maxEvents } = options;
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [status, setStatus] = useState<AcpStreamStatus>("idle");
  const lastOffsetRef = useRef<number>(startOffset);
  const startOffsetRef = useRef<number>(startOffset);
  const eventsMapRef = useRef<Map<number, StreamEvent>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);

  const flushEvents = useCallback(() => {
    flushTimerRef.current = null;
    const map = eventsMapRef.current;
    const sorted = Array.from(map.values()).sort((a, b) => a.seq - b.seq);
    setEvents(sorted);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(flushEvents, 60);
  }, [flushEvents]);

  const appendEvent = useCallback(
    (event: StreamEvent) => {
      const map = eventsMapRef.current;
      if (!map.has(event.seq)) {
        map.set(event.seq, event);
        const maxSize = maxEvents ?? DEFAULT_MAX_EVENTS;
        if (map.size > maxSize) {
          const sortedKeys = Array.from(map.keys()).sort((a, b) => a - b);
          const removeCount = map.size - maxSize;
          for (let i = 0; i < removeCount; i += 1) {
            map.delete(sortedKeys[i] ?? 0);
          }
        }
        scheduleFlush();
      }
      lastOffsetRef.current = Math.max(lastOffsetRef.current, event.seq);
    },
    [maxEvents, scheduleFlush]
  );

  useEffect(() => {
    if (startOffset > lastOffsetRef.current) {
      lastOffsetRef.current = startOffset;
    }
  }, [startOffset]);

  useEffect(() => {
    startOffsetRef.current = startOffset;
  }, [startOffset]);

  const streamKey = `${streamUrl ?? "none"}|${token ?? "none"}`;

  useEffect(() => {
    eventsMapRef.current = new Map();
    setEvents([]);
    lastOffsetRef.current = startOffsetRef.current;
    reconnectAttemptRef.current = 0;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    controllerRef.current?.abort();
  }, [streamKey]);

  useEffect(() => {
    if (!enabled || !streamUrl || !token) {
      setStatus(enabled ? "fallback" : "idle");
      return;
    }

    let isActive = true;
    const decoder = new TextDecoder();
    const connect = async () => {
      if (!isActive) return;
      setStatus("connecting");
      const controller = new AbortController();
      controllerRef.current = controller;
      const url = new URL(streamUrl);
      const offset = lastOffsetRef.current;
      url.searchParams.set("offset", offset.toString());
      url.searchParams.set("live", "sse");

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          console.error(
            "[acp.stream] Stream connection failed",
            response.status
          );
          setStatus("fallback");
          return;
        }

        setStatus("live");
        reconnectAttemptRef.current = 0;

        const reader = response.body.getReader();
        let buffer = "";

        while (isActive) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lastSeparator = buffer.lastIndexOf("\n\n");
          if (lastSeparator < 0) {
            continue;
          }
          const chunk = buffer.slice(0, lastSeparator);
          buffer = buffer.slice(lastSeparator + 2);
          const events = parseSseChunk(chunk);
          if (events.length === 0) {
            continue;
          }

          for (const sseEvent of events) {
            const parsed = parseJson(sseEvent.data);
            if (!parsed) continue;
            if (sseEvent.event === "data") {
              const streamEvent = parseStreamEvent(parsed);
              if (streamEvent) {
                appendEvent(streamEvent);
              }
              continue;
            }
            if (sseEvent.event === "control") {
              const control = parseStreamControl(parsed);
              if (control.nextOffset !== undefined) {
                lastOffsetRef.current = Math.max(
                  lastOffsetRef.current,
                  control.nextOffset
                );
              }
              if (control.truncated) {
                setStatus("fallback");
                controller.abort();
                return;
              }
            }
          }
        }

        if (!isActive || controller.signal.aborted) {
          return;
        }

        reconnectAttemptRef.current += 1;
        if (reconnectAttemptRef.current > MAX_RECONNECT_ATTEMPTS) {
          setStatus("fallback");
          return;
        }

        setTimeout(connect, 800 * reconnectAttemptRef.current);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error("[acp.stream] Stream connection error", error);
        setStatus("error");
        reconnectAttemptRef.current += 1;
        if (reconnectAttemptRef.current <= MAX_RECONNECT_ATTEMPTS) {
          setTimeout(connect, 800 * reconnectAttemptRef.current);
        } else {
          setStatus("fallback");
        }
      }
    };

    void connect();

    return () => {
      isActive = false;
      controllerRef.current?.abort();
    };
  }, [appendEvent, enabled, startOffset, streamUrl, token]);

  return {
    events,
    status,
    lastOffset: lastOffsetRef.current,
  };
}
