# BlueBubbles Integration

iMessage API via BlueBubbles on Mac Mini, secured with Cloudflare Access.

## Architecture

```
Convex Backend
     │
     ▼
Cloudflare Access (auth layer)
     │
     ▼
Cloudflare Tunnel (stable URL)
     │
     ▼
Mac Mini
     │
     ▼
BlueBubbles Server (localhost:1234)
     │
     ▼
iMessage (Private API)
```

## Environment Variables

Set in Convex (values in `~/.secrets/cmux.env`):

```bash
BLUEBUBBLES_URL        # Cloudflare tunnel URL
BLUEBUBBLES_PASSWORD   # BlueBubbles API password
CF_ACCESS_CLIENT_ID    # Cloudflare Access service token
CF_ACCESS_CLIENT_SECRET
```

## Authentication

All requests require **two layers** of auth:

1. **Cloudflare Access** - Headers on every request
2. **BlueBubbles Password** - Query parameter

### Required Headers

```
CF-Access-Client-Id: <client-id>
CF-Access-Client-Secret: <client-secret>
```

## API Usage

### Helper Function

```typescript
async function bluebubblesFetch(
  endpoint: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = new URL(endpoint, process.env.BLUEBUBBLES_URL);
  url.searchParams.set("password", process.env.BLUEBUBBLES_PASSWORD!);

  return fetch(url.toString(), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID!,
      "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET!,
      ...options.headers,
    },
  });
}
```

### Check Server Status

```typescript
const response = await bluebubblesFetch("/api/v1/server/info");
const data = await response.json();
// data.data.helper_connected should be true
```

### Send Message (Individual)

```typescript
const response = await bluebubblesFetch("/api/v1/message/text", {
  method: "POST",
  body: JSON.stringify({
    chatGuid: "iMessage;-;+19493020749",
    message: "Hello!",
    tempGuid: `temp-${Date.now()}`,
  }),
});
```

### Create Group Chat

```typescript
const response = await bluebubblesFetch("/api/v1/chat/new", {
  method: "POST",
  body: JSON.stringify({
    addresses: ["+19493020749", "+14026137710"],
    message: "Welcome to the group!",
    method: "private-api",  // Required on macOS 11+
  }),
});
const { data } = await response.json();
// data.guid = "iMessage;+;chat123456789"
```

### Rename Group

```typescript
const response = await bluebubblesFetch(`/api/v1/chat/${encodeURIComponent(chatGuid)}`, {
  method: "PUT",
  body: JSON.stringify({
    displayName: "New Group Name",
    method: "private-api",
  }),
});
```

### Send Message to Group

```typescript
const response = await bluebubblesFetch("/api/v1/message/text", {
  method: "POST",
  body: JSON.stringify({
    chatGuid: "iMessage;+;chat123456789",
    message: "Hello group!",
    tempGuid: `temp-${Date.now()}`,
  }),
});
```

### Get Chat Messages

```typescript
const response = await bluebubblesFetch(
  "/api/v1/chat/iMessage;-;+19493020749/messages?limit=50"
);
const { data } = await response.json();
// data = array of messages
```

## Chat GUID Format

| Type | Format | Example |
|------|--------|---------|
| Individual (iMessage) | `iMessage;-;+{phone}` | `iMessage;-;+19493020749` |
| Individual (SMS) | `SMS;-;+{phone}` | `SMS;-;+19493020749` |
| Group | `iMessage;+;chat{id}` | `iMessage;+;chat785157003275391976` |

## Common Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/server/info` | Server status |
| GET | `/api/v1/chat` | List all chats |
| GET | `/api/v1/chat/{guid}/messages` | Get messages in chat |
| POST | `/api/v1/chat/new` | Create new chat/group |
| POST | `/api/v1/message/text` | Send text message |
| POST | `/api/v1/message/attachment` | Send attachment |

## Important: Private API Required

On macOS Ventura (13.0) and newer, **AppleScript methods hang**. Always use the `private-api` method:

```typescript
// Include method: "private-api" in all send requests
body: JSON.stringify({
  chatGuid: "iMessage;-;+19493020749",
  message: "Hello!",
  tempGuid: `temp-${Date.now()}`,
  method: "private-api",  // Required!
})
```

The Convex `bluebubbles.ts` client handles this automatically.

## Limitations

### Group Chat Reuse

**iMessage reuses existing groups with the same participants.**

If you create a group with participants `[A, B]` and a group with those exact participants already exists, iMessage returns the existing group's GUID instead of creating a new one. This is an iMessage behavior, not a BlueBubbles limitation.

Workarounds:
1. **Track state in database** - Store conversation context in Convex, keyed by group GUID
2. **Rename old groups** - Use `renameGroup` to mark old groups as archived
3. **Add unique participant** - Include a different bot number for each "logical" group

### Available Operations

| Operation | macOS 15 (Sequoia) | Notes |
|-----------|-------------------|-------|
| Send message (1:1) | ✅ | Works with private-api |
| Send message (group) | ✅ | Works with private-api |
| Create group | ✅ | Works with private-api (reuses existing if same participants) |
| Rename group | ✅ | PUT with displayName |
| List chats | ✅ | POST to /api/v1/chat/query |
| Get messages | ✅ | Works |

## Use Cases in cmux

### Why BlueBubbles?

Sendblue cannot create group chats. BlueBubbles can send to existing groups.

### Sub-Agent Group Chats

When main SMS agent spawns a sub-agent (coding VM), it:

1. Creates group chat via BlueBubbles with user + agent number
2. Maps group chat GUID to sub-agent conversation ID
3. Routes messages between group chat and sub-agent

### Message Flow

```
User sends to group
     │
     ▼
BlueBubbles webhook (or polling)
     │
     ▼
Lookup session by groupChatGuid
     │
     ▼
Forward to sub-agent conversation
     │
     ▼
Sub-agent responds
     │
     ▼
Send to group via BlueBubbles
```

## Troubleshooting

### 403 Forbidden from Cloudflare
- Missing or invalid `CF-Access-Client-Id` / `CF-Access-Client-Secret` headers

### 401 Unauthorized from BlueBubbles
- Missing or invalid `password` query parameter

### helper_connected: false
- BlueBubbles helper (dylib) not loaded
- Need to restart BlueBubbles on Mac Mini

### Messages not sending
- Verify iMessage signed in on Mac Mini
- Check `detected_imessage` in `/api/v1/server/info`
