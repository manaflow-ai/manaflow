# Group Chats

Creating and managing iMessage group chats for the SMS agent.

## ⚠️ Important: Use Sendblue for Group Creation

**Do NOT use BlueBubbles to create groups.** BlueBubbles-created groups include the Mac Mini's email account (founders@manaflow.ai) as an implicit participant, which Sendblue cannot see. Messages in these groups will not trigger webhooks.

**Use Sendblue's `/send-group-message` API** to create groups by sending to multiple phone numbers. This creates phone-only groups that work correctly with Sendblue.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Group Chat Flow                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. CREATE GROUP (Sendblue - RECOMMENDED)                       │
│     ┌──────────────┐                                            │
│     │   Sendblue   │  POST /send-group-message                  │
│     │     API      │  → Send to multiple phone numbers          │
│     │              │  → Returns group_id (sb_group_xxx)         │
│     └──────────────┘                                            │
│                                                                 │
│  2. RECEIVE MESSAGES (Sendblue)                                 │
│     ┌──────────────┐     ┌──────────────┐                       │
│     │   Sendblue   │ ──► │    Convex    │                       │
│     │   Webhook    │     │   Webhook    │                       │
│     └──────────────┘     └──────────────┘                       │
│     Payload includes: group_id, participants                    │
│                                                                 │
│  3. SEND RESPONSES (Sendblue)                                   │
│     ┌──────────────┐     ┌──────────────┐                       │
│     │    Convex    │ ──► │   Sendblue   │                       │
│     │   Action     │     │  Group API   │                       │
│     └──────────────┘     └──────────────┘                       │
│     POST /send-group-message with group_id                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Why NOT BlueBubbles for Group Creation?

| Service | Capability | Issue |
|---------|------------|-------|
| **BlueBubbles** | Creates iMessage groups | Groups include Mac Mini's email (founders@manaflow.ai) → Sendblue can't see them |
| **Sendblue** | Creates groups via send-group-message | Phone-only participants → Works correctly |

**Solution**: Use Sendblue to create AND message groups.

## Creating Groups via Sendblue (RECOMMENDED)

### Convex Action

```typescript
import { internal } from "./_generated/api";

// Create a group chat by sending to multiple numbers
const result = await ctx.runAction(internal.sms.createGroupChat, {
  numbers: ["+19493020749", "+17025285299"],  // User + Sendblue bot
  initialMessage: "Welcome to the group!",
});

// Returns: { success: true, groupId: "sb_group_xxx-xxx-xxx" }
```

### Direct API

```bash
curl "https://api.sendblue.co/api/send-group-message" \
  -X POST \
  -H "sb-api-key-id: YOUR_API_KEY" \
  -H "sb-api-secret-key: YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "numbers": ["+19493020749", "+17025285299"],
    "content": "Welcome to the group!",
    "from_number": "+17025285299"
  }'
```

### Group ID Format

| Source | Format | Example |
|--------|--------|---------|
| Sendblue | `sb_group_{uuid}` | `sb_group_34a7237f-f232-4fc3-98c6-02d66b02beb2` |
| Apple (BlueBubbles) | `iMessage;+;chat{id}` | `iMessage;+;chat785157003275391976` |

Sendblue generates its own `sb_group_*` IDs which are used for all group operations.

## Group Chat Behavior

### iMessage Reuses Groups

iMessage may reuse existing groups with the same participants. If you send to `[A, B]` and a group already exists, the message goes to the existing group.

**Workarounds**:
1. Track conversation state in database keyed by `group_id`
2. Add a 3rd participant to make a unique group
3. Accept that some groups may be reused

## Receiving Group Messages (Sendblue)

When a message arrives in a group, Sendblue webhook includes:

```json
{
  "content": "Hello group!",
  "from_number": "+19493020749",
  "to_number": "+17025285299",
  "group_id": "group-abc123",
  "participants": ["+19493020749", "+17025285299", "+15551234567"],
  "group_display_name": "My Group Chat"
}
```

The webhook handler (`sms_http.ts`) passes `group_id` and `participants` to `handleInboundMessage`.

## Sending Group Messages (Sendblue)

### Via Convex Action

```typescript
await ctx.runAction(internal.sms.sendGroupMessage, {
  groupId: "group-abc123",
  content: "Hello from the bot!",
});
```

### Direct API

```typescript
const response = await sendblueClient.groups.sendMessage({
  content: "Hello group!",
  from_number: "+17025285299",  // Your Sendblue number
  group_id: "group-abc123",
});
```

## Group Message Handling

In `handleInboundMessage`, group messages are handled differently:

1. **Context**: Messages scoped by `group_id` instead of phone number
2. **User identification**: Messages prefixed with sender's last 4 digits: `[1234]: message`
3. **System prompt**: LLM gets group-aware context
4. **Response**: Sent via `sendGroupMessage` instead of `sendMessage`
5. **Typing indicators**: Skipped (not supported in groups)

## Requirements

### Sendblue

- **Dedicated plan** required for group messaging (dedicated phone number)
- On free plan, `group_id` will always be empty
- The Sendblue number must be included in the group participants

## Environment Variables

```bash
cd packages/convex

# Sendblue (required)
bunx convex env set SENDBLUE_API_KEY "your-api-key"
bunx convex env set SENDBLUE_API_SECRET "your-api-secret"
bunx convex env set SENDBLUE_FROM_NUMBER "+17025285299"
bunx convex env set SENDBLUE_WEBHOOK_SECRET "your-webhook-secret"
```

## Testing

### Create a test group via Sendblue

```bash
cd packages/convex
bunx convex run sms:createGroupChat '{
  "numbers": ["+19493020749", "+17025285299"],
  "initialMessage": "Test group!"
}'
```

### Send to existing group

```bash
bunx convex run sms:sendGroupMessage '{
  "groupId": "sb_group_xxx-xxx-xxx",
  "content": "Hello group!"
}'
```

### Check webhook logs

```bash
bunx convex data smsWebhookLogs --format jsonl | grep "sb_group" | tail -5
```

## Troubleshooting

### Group messages not triggering webhook

1. Verify Sendblue webhook is configured (see [WEBHOOKS.md](./WEBHOOKS.md))
2. Check you're on Sendblue dedicated plan
3. Verify the Sendblue number is in the group
4. **Check group was created via Sendblue** (not BlueBubbles!)

### BlueBubbles-created groups don't work

**This is expected.** BlueBubbles-created groups include the Mac Mini's email account which Sendblue cannot see. Create groups via Sendblue instead.

### Messages not delivering

- Verify all participants have iMessage enabled
- Phone numbers must include country code (`+1` for US)
- Check Sendblue API response for errors

### How to migrate from BlueBubbles groups

If you have existing BlueBubbles groups that don't work:
1. Create a new group via Sendblue with the same phone participants
2. Send messages to the new Sendblue group_id

## Related Files

- `convex/sendblue.ts` - Sendblue client (messaging + group creation)
- `convex/sms.ts` - Message handling (includes `createGroupChat` action)
- `convex/sms_http.ts` - Webhook handler (parses group_id)
- `convex/bluebubbles.ts` - BlueBubbles client (NOT recommended for groups)

See also:
- [SMS.md](./SMS.md) - Full SMS integration docs
- [WEBHOOKS.md](./WEBHOOKS.md) - Webhook setup
