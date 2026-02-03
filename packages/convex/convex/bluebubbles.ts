"use node";

import { Effect, pipe } from "effect";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

// ============= Errors =============

export class BlueBubblesError {
  readonly _tag = "BlueBubblesError";
  constructor(
    readonly message: string,
    readonly statusCode?: number,
    readonly cause?: unknown
  ) {}
}

export class BlueBubblesConfigError {
  readonly _tag = "BlueBubblesConfigError";
  constructor(readonly message: string) {}
}

// ============= Config =============

export type BlueBubblesConfig = {
  baseUrl: string;
  password: string;
  cfAccessClientId: string;
  cfAccessClientSecret: string;
};

export const getBlueBubblesConfig = (): Effect.Effect<BlueBubblesConfig, BlueBubblesConfigError> =>
  Effect.try({
    try: () => {
      const baseUrl = process.env.BLUEBUBBLES_URL;
      const password = process.env.BLUEBUBBLES_PASSWORD;
      const cfAccessClientId = process.env.CF_ACCESS_CLIENT_ID;
      const cfAccessClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;

      if (!baseUrl) throw new Error("Missing BLUEBUBBLES_URL");
      if (!password) throw new Error("Missing BLUEBUBBLES_PASSWORD");
      if (!cfAccessClientId) throw new Error("Missing CF_ACCESS_CLIENT_ID");
      if (!cfAccessClientSecret) throw new Error("Missing CF_ACCESS_CLIENT_SECRET");

      return {
        baseUrl,
        password,
        cfAccessClientId,
        cfAccessClientSecret,
      };
    },
    catch: (error) =>
      new BlueBubblesConfigError(
        error instanceof Error ? error.message : "Invalid BlueBubbles configuration"
      ),
  });

// ============= Types =============

export interface ServerInfo {
  os_version: string;
  server_address: string;
  socket_connections: number;
  caffeinate_status: string;
  helper_connected: boolean;
  proxy_service: string;
  detected_imessage: string;
  detected_facetime: string;
  private_api_requirements: string;
  private_api_mode: boolean;
}

export interface Chat {
  guid: string;
  chatIdentifier: string;
  displayName: string | null;
  participants: Array<{
    address: string;
    displayName: string | null;
  }>;
  lastMessage: Message | null;
}

export interface Message {
  guid: string;
  text: string;
  isFromMe: boolean;
  dateCreated: number;
  handle: {
    address: string;
  } | null;
  attachments: Array<{
    guid: string;
    mimeType: string;
    transferName: string;
  }>;
}

export interface CreateGroupResponse {
  guid: string;
  participants: string[];
}

export interface SendMessageResponse {
  guid: string;
  text: string;
  dateCreated: number;
  tempGuid: string;
}

// ============= Fetch Helper =============

const bluebubblesFetch = (
  config: BlueBubblesConfig,
  endpoint: string,
  options: RequestInit = {}
): Effect.Effect<Response, BlueBubblesError> =>
  Effect.tryPromise({
    try: async () => {
      const url = new URL(endpoint, config.baseUrl);
      url.searchParams.set("password", config.password);

      const response = await fetch(url.toString(), {
        ...options,
        headers: {
          "Content-Type": "application/json",
          "CF-Access-Client-Id": config.cfAccessClientId,
          "CF-Access-Client-Secret": config.cfAccessClientSecret,
          ...options.headers,
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`BlueBubbles API error: ${response.status} - ${text}`);
      }

      return response;
    },
    catch: (error) =>
      new BlueBubblesError(
        error instanceof Error ? error.message : "BlueBubbles request failed",
        undefined,
        error
      ),
  });

// ============= BlueBubbles Service =============

export const makeBlueBubblesService = (config: BlueBubblesConfig) => ({
  /**
   * Check server status and connectivity
   */
  getServerInfo: (): Effect.Effect<ServerInfo, BlueBubblesError> =>
    pipe(
      bluebubblesFetch(config, "/api/v1/server/info"),
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.json() as Promise<{ data: ServerInfo }>,
          catch: (e) => new BlueBubblesError("Failed to parse server info", undefined, e),
        })
      ),
      Effect.map((json) => json.data),
      Effect.tap((info) =>
        Effect.logInfo("BlueBubbles server info", {
          helperConnected: info.helper_connected,
          detectedImessage: info.detected_imessage,
          privateApiMode: info.private_api_mode,
        })
      )
    ),

  /**
   * List all chats (uses POST /api/v1/chat/query)
   */
  listChats: (limit = 50): Effect.Effect<Chat[], BlueBubblesError> =>
    pipe(
      bluebubblesFetch(config, "/api/v1/chat/query", {
        method: "POST",
        body: JSON.stringify({ limit }),
      }),
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.json() as Promise<{ data: Chat[] }>,
          catch: (e) => new BlueBubblesError("Failed to parse chats", undefined, e),
        })
      ),
      Effect.map((json) => json.data),
      Effect.tap((chats) =>
        Effect.logDebug("Listed chats", { count: chats.length })
      )
    ),

  /**
   * Get messages from a specific chat
   */
  getChatMessages: (
    chatGuid: string,
    limit = 50
  ): Effect.Effect<Message[], BlueBubblesError> =>
    pipe(
      bluebubblesFetch(
        config,
        `/api/v1/chat/${encodeURIComponent(chatGuid)}/messages?limit=${limit}`
      ),
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.json() as Promise<{ data: Message[] }>,
          catch: (e) => new BlueBubblesError("Failed to parse messages", undefined, e),
        })
      ),
      Effect.map((json) => json.data),
      Effect.tap((messages) =>
        Effect.logDebug("Got chat messages", { chatGuid, count: messages.length })
      )
    ),

  /**
   * Create a new group chat
   */
  createGroup: (
    participants: string[],
    initialMessage: string
  ): Effect.Effect<CreateGroupResponse, BlueBubblesError> =>
    pipe(
      Effect.logInfo("Creating group chat", { participants, initialMessage }),
      Effect.flatMap(() =>
        bluebubblesFetch(config, "/api/v1/chat/new", {
          method: "POST",
          body: JSON.stringify({
            addresses: participants,
            message: initialMessage,
            method: "private-api", // Required on macOS Big Sur+
          }),
        })
      ),
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.json() as Promise<{ data: CreateGroupResponse }>,
          catch: (e) => new BlueBubblesError("Failed to parse create group response", undefined, e),
        })
      ),
      Effect.map((json) => json.data),
      Effect.tap((result) =>
        Effect.logInfo("Group chat created", {
          guid: result.guid,
          participants: result.participants,
        })
      )
    ),

  /**
   * Send a text message to a chat (individual or group)
   * Uses private-api method by default (AppleScript hangs on newer macOS)
   */
  sendMessage: (
    chatGuid: string,
    message: string
  ): Effect.Effect<SendMessageResponse, BlueBubblesError> =>
    pipe(
      Effect.logInfo("Sending message via BlueBubbles", { chatGuid, messageLength: message.length }),
      Effect.flatMap(() =>
        bluebubblesFetch(config, "/api/v1/message/text", {
          method: "POST",
          body: JSON.stringify({
            chatGuid,
            message,
            tempGuid: `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            method: "private-api", // Required on macOS Ventura+ (AppleScript hangs)
          }),
        })
      ),
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.json() as Promise<{ data: SendMessageResponse }>,
          catch: (e) => new BlueBubblesError("Failed to parse send message response", undefined, e),
        })
      ),
      Effect.map((json) => json.data),
      Effect.tap((result) =>
        Effect.logInfo("Message sent via BlueBubbles", {
          guid: result.guid,
          chatGuid,
        })
      )
    ),

  /**
   * Send message to individual by phone number
   */
  sendToNumber: (
    phoneNumber: string,
    message: string
  ): Effect.Effect<SendMessageResponse, BlueBubblesError> => {
    // Format: iMessage;-;+19493020749
    const chatGuid = `iMessage;-;${phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`}`;
    return pipe(
      Effect.logInfo("Sending to phone number", { phoneNumber, chatGuid }),
      Effect.flatMap(() =>
        makeBlueBubblesService(config).sendMessage(chatGuid, message)
      )
    );
  },

  /**
   * Rename a group chat
   * Useful before creating a new group with the same participants
   * (iMessage reuses existing groups with same members)
   */
  renameGroup: (
    chatGuid: string,
    newName: string
  ): Effect.Effect<void, BlueBubblesError> =>
    pipe(
      Effect.logInfo("Renaming group chat", { chatGuid, newName }),
      Effect.flatMap(() =>
        bluebubblesFetch(config, `/api/v1/chat/${encodeURIComponent(chatGuid)}`, {
          method: "PUT",
          body: JSON.stringify({
            displayName: newName,
            method: "private-api",
          }),
        })
      ),
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: () => response.json() as Promise<{ status: number; message: string }>,
          catch: (e) => new BlueBubblesError("Failed to parse rename response", undefined, e),
        })
      ),
      Effect.flatMap((json) =>
        json.status === 200
          ? Effect.void
          : Effect.fail(new BlueBubblesError(`Failed to rename group: ${json.message}`))
      ),
      Effect.tap(() => Effect.logInfo("Group renamed successfully", { chatGuid, newName }))
    ),
});

// ============= Effect Runner =============

export const runEffect = <A, E>(
  effect: Effect.Effect<A, E, never>
): Promise<A> =>
  Effect.runPromise(
    pipe(
      effect,
      Effect.catchAll((error) => {
        console.error("BlueBubbles Effect error:", error);
        return Effect.fail(error);
      })
    )
  );

// ============= Convex Actions =============

/**
 * Check BlueBubbles server status
 */
export const checkServerStatus = internalAction({
  args: {},
  handler: async (): Promise<{
    success: boolean;
    helperConnected?: boolean;
    detectedImessage?: string;
    error?: string;
  }> => {
    const program = pipe(
      getBlueBubblesConfig(),
      Effect.map((config) => makeBlueBubblesService(config)),
      Effect.flatMap((service) => service.getServerInfo()),
      Effect.map((info) => ({
        success: true,
        helperConnected: info.helper_connected,
        detectedImessage: info.detected_imessage,
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof BlueBubblesError || error instanceof BlueBubblesConfigError
            ? error.message
            : "Unknown error",
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * Create a new iMessage group chat
 */
export const createGroupChat = internalAction({
  args: {
    participants: v.array(v.string()),
    initialMessage: v.string(),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    success: boolean;
    groupGuid?: string;
    error?: string;
  }> => {
    const program = pipe(
      getBlueBubblesConfig(),
      Effect.map((config) => makeBlueBubblesService(config)),
      Effect.flatMap((service) =>
        service.createGroup(args.participants, args.initialMessage)
      ),
      Effect.map((result) => ({
        success: true,
        groupGuid: result.guid,
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof BlueBubblesError || error instanceof BlueBubblesConfigError
            ? error.message
            : "Unknown error",
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * Send message to a chat (individual or group)
 */
export const sendMessage = internalAction({
  args: {
    chatGuid: v.string(),
    message: v.string(),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    success: boolean;
    messageGuid?: string;
    error?: string;
  }> => {
    const program = pipe(
      getBlueBubblesConfig(),
      Effect.map((config) => makeBlueBubblesService(config)),
      Effect.flatMap((service) => service.sendMessage(args.chatGuid, args.message)),
      Effect.map((result) => ({
        success: true,
        messageGuid: result.guid,
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof BlueBubblesError || error instanceof BlueBubblesConfigError
            ? error.message
            : "Unknown error",
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * Send message to a phone number
 */
export const sendToPhoneNumber = internalAction({
  args: {
    phoneNumber: v.string(),
    message: v.string(),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    success: boolean;
    messageGuid?: string;
    error?: string;
  }> => {
    const program = pipe(
      getBlueBubblesConfig(),
      Effect.map((config) => makeBlueBubblesService(config)),
      Effect.flatMap((service) => service.sendToNumber(args.phoneNumber, args.message)),
      Effect.map((result) => ({
        success: true,
        messageGuid: result.guid,
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof BlueBubblesError || error instanceof BlueBubblesConfigError
            ? error.message
            : "Unknown error",
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * List recent chats
 */
export const listChats = internalAction({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    success: boolean;
    chats?: Array<{ guid: string; displayName: string | null; participantCount: number }>;
    error?: string;
  }> => {
    const program = pipe(
      getBlueBubblesConfig(),
      Effect.map((config) => makeBlueBubblesService(config)),
      Effect.flatMap((service) => service.listChats(args.limit ?? 50)),
      Effect.map((chats) => ({
        success: true,
        chats: chats.map((c) => ({
          guid: c.guid,
          displayName: c.displayName,
          participantCount: c.participants.length,
        })),
      })),
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof BlueBubblesError || error instanceof BlueBubblesConfigError
            ? error.message
            : "Unknown error",
        })
      )
    );

    return runEffect(program);
  },
});

/**
 * Rename a group chat
 * Useful before creating a new group with same participants (iMessage reuses existing groups)
 */
export const renameGroup = internalAction({
  args: {
    chatGuid: v.string(),
    newName: v.string(),
  },
  handler: async (
    _ctx,
    args
  ): Promise<{
    success: boolean;
    error?: string;
  }> => {
    const program = pipe(
      getBlueBubblesConfig(),
      Effect.map((config) => makeBlueBubblesService(config)),
      Effect.flatMap((service) => service.renameGroup(args.chatGuid, args.newName)),
      Effect.map(() => ({ success: true })),
      Effect.catchAll((error) =>
        Effect.succeed({
          success: false,
          error: error instanceof BlueBubblesError || error instanceof BlueBubblesConfigError
            ? error.message
            : "Unknown error",
        })
      )
    );

    return runEffect(program);
  },
});
