/**
 * OpenCode Plugin: Convex Sync
 *
 * This plugin sends OpenCode events to Convex to enable real-time
 * visibility into the coding agent's work.
 *
 * Configuration:
 * The plugin reads from /root/.xagi/config.json which contains:
 * - convexUrl: The Convex HTTP endpoint URL
 * - jwt: The JWT token for authentication
 *
 * Events sent:
 * - session.created: When a new session starts
 * - session.updated: When session state changes
 * - message.updated: When a message is created or updated (not individual parts)
 * - session.idle: When the session completes
 * - session.error: When an error occurs
 *
 * IMPORTANT: Config is loaded lazily on first event because the config file
 * is written AFTER the OpenCode server starts (by the coding agent tool).
 */

// Plugin type - simplified for compatibility
type PluginEventHandler = {
  event?: (args: { event: { type: string; properties: Record<string, unknown> } }) => Promise<void>;
};

interface XagiConfig {
  convexUrl: string;
  jwt: string;
}

// Cached config - loaded lazily on first event
let cachedConfig: XagiConfig | null | undefined = undefined;

// Load config from the standard location using Bun's file API
async function loadConfigAsync(): Promise<XagiConfig | null> {
  const configPath = "/root/.xagi/config.json";

  try {
    const file = Bun.file(configPath);
    const exists = await file.exists();
    if (!exists) {
      return null;
    }
    const content = await file.text();
    return JSON.parse(content) as XagiConfig;
  } catch (error) {
    console.error("[convex-sync] Failed to load config:", error);
    return null;
  }
}

// Get config - loads lazily and caches (async version)
async function getConfigAsync(): Promise<XagiConfig | null> {
  // undefined means we haven't tried to load yet
  if (cachedConfig === undefined) {
    cachedConfig = await loadConfigAsync();
    if (cachedConfig) {
      console.log("[convex-sync] Config loaded successfully");
    }
  }
  return cachedConfig;
}

// Debounce mechanism to batch message updates
const messageDebounceMap = new Map<string, NodeJS.Timeout>();
const MESSAGE_DEBOUNCE_MS = 500; // Wait 500ms before sending to reduce frequency

// Send event to Convex
async function sendEvent(
  config: XagiConfig,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    console.log(`[convex-sync] Sending ${event} to ${config.convexUrl}`);
    const response = await fetch(config.convexUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.jwt}`,
      },
      body: JSON.stringify({ event, data }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[convex-sync] Failed to send ${event}: ${response.status} ${text}`);
    } else {
      console.log(`[convex-sync] Successfully sent ${event}`);
    }
  } catch (error) {
    console.error(`[convex-sync] Error sending ${event}:`, error);
  }
}

// Debounced message sender
function sendMessageDebounced(
  config: XagiConfig,
  messageId: string,
  data: Record<string, unknown>
): void {
  // Clear existing timeout for this message
  const existingTimeout = messageDebounceMap.get(messageId);
  if (existingTimeout) {
    clearTimeout(existingTimeout);
  }

  // Set new timeout
  const timeout = setTimeout(() => {
    messageDebounceMap.delete(messageId);
    sendEvent(config, "message.updated", data);
  }, MESSAGE_DEBOUNCE_MS);

  messageDebounceMap.set(messageId, timeout);
}

// Flush all pending messages (called on session.idle)
async function flushPendingMessages(): Promise<void> {
  // Give a bit of time for final updates to come in
  await new Promise((resolve) => setTimeout(resolve, MESSAGE_DEBOUNCE_MS + 100));

  // Clear all pending debounces (they should have fired by now)
  for (const [, timeout] of messageDebounceMap) {
    clearTimeout(timeout);
  }
  messageDebounceMap.clear();
}

// Export the plugin factory function
// Note: OpenCode passes a PluginInput object to the factory function
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const ConvexSyncPlugin = async (_input?: unknown): Promise<PluginEventHandler> => {
  console.log("[convex-sync] Plugin registered (config will load on first event)");

  return {
    event: async ({ event }: { event: { type: string; properties: Record<string, unknown> } }) => {
      // Load config lazily on first event
      const config = await getConfigAsync();
      if (!config) {
        // Config not available yet - this is expected before config file is written
        return;
      }

      const eventType = event.type;
      const props = event.properties;

      switch (eventType) {
        case "session.created":
        case "session.updated":
          // Send session info
          await sendEvent(config, eventType, {
            session: {
              id: props.sessionID,
              ...props,
            },
          });
          break;

        case "message.updated": {
          // Debounce message updates to reduce frequency
          // The hook sends complete messages, not individual parts
          const info = props.info as {
            id?: string;
            role?: string;
            parts?: unknown[];
          };

          if (info?.id) {
            sendMessageDebounced(config, info.id, { info });
          }
          break;
        }

        case "session.idle":
          // Flush any pending messages before marking complete
          await flushPendingMessages();
          await sendEvent(config, eventType, {
            sessionID: props.sessionID,
          });
          break;

        case "session.error":
          // Send error immediately
          await sendEvent(config, eventType, {
            sessionID: props.sessionID,
            error: props,
          });
          break;

        // Ignore these events as they're too granular
        case "message.part.updated":
        case "message.part.removed":
          // Skip - we use message.updated instead
          break;

        default:
          // Log but don't send other events
          // console.log(`[convex-sync] Ignoring event: ${eventType}`);
          break;
      }
    },
  };
};
