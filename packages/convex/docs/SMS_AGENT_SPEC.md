# SMS Agent Spec

Personal AI agent accessible via iMessage that can access user integrations and spawn sub-agents.

## Architecture Overview

```
User (iMessage)
     │
     ▼
Sendblue Webhook ──────────────────────────┐
     │                                     │
     ▼                                     │
Main Agent (Claude Opus 4.5)               │
     │                                     │
     ├─► Google APIs (Gmail, Calendar)     │
     │                                     │
     ├─► Spawn Sub-Agent VM ───────────────┤
     │         │                           │
     │         ▼                           │
     │   BlueBubbles ──► Create Group Chat │
     │         │              │            │
     │         ▼              ▼            │
     │   Sub-Agent ◄──── User + Agent      │
     │   (Claude Code)   in group chat     │
     │                                     │
     └─► Other Tools (weather, calc, etc.) │
```

## Features

### 1. Google Integration

Users connect Google accounts to enable Gmail and Calendar access.

#### OAuth Flow

```
User texts: "connect my google"
     │
     ▼
Agent returns OAuth URL (short link)
     │
     ▼
User opens link, authenticates with Google
     │
     ▼
Callback stores refresh token in Convex
     │
     ▼
Agent confirms: "connected! i can now access your gmail and calendar"
```

#### Gmail Capabilities

| Tool | Description |
|------|-------------|
| `gmail_search` | Search emails by query (from:, to:, subject:, etc.) |
| `gmail_read` | Read full email content by ID |
| `gmail_send` | Send email (to, subject, body) |
| `gmail_reply` | Reply to email thread |
| `gmail_labels` | List/apply labels |
| `gmail_unread_count` | Get unread count (optionally filtered) |

#### Calendar Capabilities

| Tool | Description |
|------|-------------|
| `calendar_list` | List upcoming events (default: next 7 days) |
| `calendar_search` | Search events by title/description |
| `calendar_create` | Create new event |
| `calendar_update` | Update existing event |
| `calendar_delete` | Delete/cancel event |
| `calendar_freebusy` | Check availability for time range |

#### Multiple Accounts

Users can connect multiple Google accounts:

```typescript
// Schema
googleAccounts: defineTable({
  userId: v.string(),           // cmux user ID (or phone number for SMS-only)
  email: v.string(),            // Google account email
  accessToken: v.string(),      // Encrypted
  refreshToken: v.string(),     // Encrypted
  expiresAt: v.number(),
  scopes: v.array(v.string()),
  isDefault: v.boolean(),       // Default account for this user
})
  .index("by_user", ["userId"])
  .index("by_email", ["email"])
```

Usage:
```
User: "what's on my calendar today"
Agent: (uses default account)

User: "check my work email for messages from alice"
Agent: "which account? you have: personal@gmail.com, work@company.com"
User: "work"
Agent: (uses work@company.com)
```

### 2. Sub-Agent Spawning

Main agent can spawn Claude Code instances in VMs for complex coding tasks.

#### Spawn Flow

```
User: "help me build a todo app in react"
     │
     ▼
Main Agent: "i'll spin up a coding agent for this. one sec..."
     │
     ▼
acp.startConversation({
  teamSlugOrId: "manaflow",
  providerId: "claude",
  cwd: "/workspace",
})
     │
     ▼
BlueBubbles: Create group chat with user + agent number
     │
     ▼
Main Agent: "created a group chat for this project. the coding agent will message you there."
     │
     ▼
Sub-Agent (in group): "hi! i'm ready to help build your todo app. what features do you want?"
```

#### VM Lifecycle

```typescript
// Spawn VM and conversation
const { conversationId, sandboxId } = await ctx.runAction(
  internal.acp.startConversation,
  {
    teamSlugOrId: "manaflow",
    providerId: "claude",
    cwd: "/workspace",
  }
);

// Send initial prompt
const messageId = await ctx.runMutation(
  internal.conversationMessages.create,
  {
    conversationId,
    role: "user",
    content: [{ type: "text", text: userPrompt }],
  }
);

await ctx.scheduler.runAfter(0, internal.acp.deliverMessageInternal, {
  conversationId,
  messageId,
  attempt: 0,
});
```

#### Group Chat Mapping

```typescript
// Schema
smsAgentSessions: defineTable({
  // Parent (1:1 chat with main agent)
  parentChatGuid: v.string(),     // iMessage;-;+19493020749
  userPhoneNumber: v.string(),

  // Sub-agent
  conversationId: v.id("conversations"),
  sandboxId: v.string(),

  // Group chat for this sub-agent
  groupChatGuid: v.string(),      // iMessage;+;chat123456789

  // State
  status: v.string(),             // active, paused, completed, failed
  createdAt: v.number(),
  lastMessageAt: v.number(),
})
  .index("by_parent_chat", ["parentChatGuid"])
  .index("by_group_chat", ["groupChatGuid"])
  .index("by_conversation", ["conversationId"])
```

#### Message Routing

```
Inbound message from group chat
     │
     ▼
Lookup session by groupChatGuid
     │
     ▼
Forward to sub-agent conversation
     │
     ▼
conversationMessages.create + deliverMessageInternal
     │
     ▼
Sub-agent responds
     │
     ▼
Send response to group chat via BlueBubbles
```

### 3. BlueBubbles Integration

Used for creating and managing group chats (Sendblue doesn't support group messaging).

#### Capabilities

| Action | Endpoint | Status |
|--------|----------|--------|
| Send message | `POST /api/v1/message/text` | ✅ Works (use `method: "private-api"`) |
| List chats | `POST /api/v1/chat/query` | ✅ Works |
| Get messages | `GET /api/v1/chat/{guid}/messages` | ✅ Works |
| Create group | `POST /api/v1/chat/new` | ✅ Works (use `method: "private-api"`) |
| Rename group | `PUT /api/v1/chat/{guid}` | ✅ Works (use `displayName`) |

#### Group Chat Behavior

**Important:** iMessage reuses groups with the same participants. Creating a group with `[A, B]` when one already exists returns the existing group's GUID.

Workaround: Track conversation state in database keyed by group GUID, not by creating new groups.

#### Convex Actions

```typescript
// Create group chat
await ctx.runAction(internal.bluebubbles.createGroupChat, {
  participants: ["+19493020749", "+17146990169"],
  initialMessage: "Hello!",
});
// Returns: { success: true, groupGuid: "iMessage;+;chat123456789" }

// Send to group
await ctx.runAction(internal.bluebubbles.sendMessage, {
  chatGuid: "iMessage;+;chat123456789",
  message: "Hello group!",
});

// Rename group
await ctx.runAction(internal.bluebubbles.renameGroup, {
  chatGuid: "iMessage;+;chat123456789",
  newName: "Archived Group",
});
```

## Authentication

### SMS-Only Users (No cmux Account)

Phone number is the identity. Google tokens stored per phone number.

```typescript
// Lookup or create user by phone
const user = await ctx.runQuery(internal.smsUsers.getOrCreate, {
  phoneNumber: "+19493020749",
});
```

### cmux Users

If user has cmux account, link phone number to account for unified integrations.

```typescript
// Link phone to existing cmux user
await ctx.runMutation(internal.smsUsers.linkToAccount, {
  phoneNumber: "+19493020749",
  userId: "user_abc123",
});
```

## Tool Definitions

### Main Agent Tools

```typescript
const tools = {
  // Existing fake bash tools
  bash: { /* echo, date, weather, calc, etc. */ },

  // Google (requires connected account)
  gmail_search: {
    description: "Search user's Gmail",
    inputSchema: z.object({
      query: z.string(),
      maxResults: z.number().optional().default(10),
    }),
  },
  gmail_read: {
    description: "Read full email by ID",
    inputSchema: z.object({ messageId: z.string() }),
  },
  calendar_list: {
    description: "List upcoming calendar events",
    inputSchema: z.object({
      daysAhead: z.number().optional().default(7),
    }),
  },
  calendar_create: {
    description: "Create calendar event",
    inputSchema: z.object({
      title: z.string(),
      startTime: z.string(), // ISO 8601
      endTime: z.string(),
      description: z.string().optional(),
    }),
  },

  // Sub-agent spawning
  spawn_coding_agent: {
    description: "Spawn a Claude Code instance for complex coding tasks. Creates a group chat for the user to interact with the sub-agent.",
    inputSchema: z.object({
      task: z.string().describe("Initial task/prompt for the coding agent"),
      repo: z.string().optional().describe("GitHub repo to clone (owner/repo)"),
    }),
  },
};
```

## Environment Variables

### Convex

```bash
# Sendblue (outbound SMS, typing indicators)
SENDBLUE_API_KEY
SENDBLUE_API_SECRET
SENDBLUE_FROM_NUMBER
SENDBLUE_WEBHOOK_SECRET

# BlueBubbles (group chat creation)
BLUEBUBBLES_URL
BLUEBUBBLES_PASSWORD
CF_ACCESS_CLIENT_ID
CF_ACCESS_CLIENT_SECRET

# Google OAuth
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET

# AWS Bedrock (LLM)
AWS_BEARER_TOKEN_BEDROCK
AWS_REGION
```

## File Structure

```
packages/convex/convex/
├── sms.ts                 # Main SMS actions (existing)
├── sms_llm.ts             # LLM service with tools (existing)
├── sms_queries.ts         # SMS message storage (existing)
├── sms_http.ts            # Sendblue webhook (existing)
├── sendblue.ts            # Sendblue client (existing)
├── bluebubbles.ts         # BlueBubbles client (new)
├── sms_google.ts          # Google OAuth + API calls (new)
├── sms_subagent.ts        # Sub-agent spawning (new)
├── sms_users.ts           # SMS user management (new)
└── schema.ts              # Add new tables
```

## Implementation Order

1. **Phase 1: BlueBubbles Integration**
   - [ ] Create `bluebubbles.ts` client library
   - [ ] Test group chat creation
   - [ ] Handle inbound messages from groups

2. **Phase 2: Sub-Agent Spawning**
   - [ ] Create `sms_subagent.ts` with spawn logic
   - [ ] Add `smsAgentSessions` table
   - [ ] Wire up message routing (group → sub-agent → group)
   - [ ] Add `spawn_coding_agent` tool to main agent

3. **Phase 3: Google Integration**
   - [ ] Set up Google Cloud project + OAuth credentials
   - [ ] Create `sms_google.ts` with OAuth flow
   - [ ] Add `googleAccounts` table
   - [ ] Implement Gmail tools
   - [ ] Implement Calendar tools
   - [ ] Add tools to main agent

4. **Phase 4: Polish**
   - [ ] Short link generation for OAuth URLs
   - [ ] Error handling and retry logic
   - [ ] Rate limiting
   - [ ] Session cleanup (idle VMs)

## Open Questions

1. **Auth linking**: How do SMS users claim/link to a cmux web account?
2. **Billing**: How to handle VM costs for SMS-only users?
3. **Rate limits**: Per-user limits on sub-agent spawns?
4. **Notifications**: Push sub-agent completion status to user?
