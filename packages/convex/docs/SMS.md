# SMS/iMessage Integration

SMS/iMessage chatbot using Convex + Sendblue + AWS Bedrock (Claude Opus 4.5).

## Architecture

- **Convex**: Backend (functions, database, webhooks)
- **Sendblue**: SMS/iMessage API (+17025285299)
- **AWS Bedrock**: LLM (Claude Opus 4.5 via cross-region inference profile)

## Key Files

- `sendblue.ts` - Sendblue client library (Effect-based)
- `sms_llm.ts` - LLM service (Bedrock + AI SDK)
- `sms.ts` - Actions (sendMessage, handleInboundMessage, etc.)
- `sms_queries.ts` - Queries and mutations
- `sms_http.ts` - Webhook endpoint
- `schema.ts` - DB schema (smsMessages, smsWebhookLogs tables)

## E2E Testing Flow

### Send test message via macOS iMessage:
```bash
osascript <<'EOF'
tell application "Messages"
    set targetBuddy to "+17025285299"
    set targetService to id of 1st account whose service type = iMessage
    set targetBuddyID to buddy targetBuddy of account id targetService
    send "Your test message here" to targetBuddyID
end tell
EOF
```

### Monitor Convex logs:
```bash
cd packages/convex
bunx convex logs --history 20
# Or stream live:
bunx convex logs --success
```

### Expected flow in logs:
1. `Received Sendblue webhook` - Webhook received
2. `sms_queries:logWebhook` - Logged
3. `sms_queries:processWebhookMessage` - Stored in DB
4. `sms:handleInboundMessage` - Processing starts
5. `sms:sendTypingIndicator` - Typing bubble shown
6. `sms_queries:getConversationHistory` - Fetch context
7. (LLM call happens here)
8. `sms:sendMessage` - Response sent
9. `LLM response sent` - Success

### Common issues:
- **Model ID error**: Use cross-region inference profile (`global.anthropic.*`) not direct model ID
- **Config error**: Check `AWS_BEARER_TOKEN_BEDROCK` env var in Convex
- **Typing indicator fails**: Sendblue requires an existing outbound message before typing indicators work. We check for an established route before attempting (see `hasOutboundMessage` query).

## Agent Loop with Tools

The LLM service supports an agent loop with fake bash tools:

```typescript
llmService.generateAgentResponse(history, isGroup, maxSteps, areaCode)
```

**Available fake commands**: `echo`, `date`, `whoami`, `pwd`, `ls`, `cat`, `weather`, `calc`, `help`

**Area code context**: The user's phone area code is extracted and included in the system prompt to help infer timezone (e.g., 949 → Orange County CA → Pacific Time).

**Prompt caching**: Uses Anthropic's ephemeral caching (`cacheControl: { type: "ephemeral" }`) for cost savings on repeated system prompts.

## Environment Variables

Set in Convex dashboard or via CLI:
```bash
cd packages/convex

# Sendblue
bunx convex env set SENDBLUE_API_KEY "..."
bunx convex env set SENDBLUE_API_SECRET "..."
bunx convex env set SENDBLUE_FROM_NUMBER "+17025285299"
bunx convex env set SENDBLUE_WEBHOOK_SECRET "..."

# AWS Bedrock
bunx convex env set AWS_BEARER_TOKEN_BEDROCK "..."
```

## Webhook Registration

After deploying, register webhook with Sendblue:
```bash
cd packages/convex
bunx convex run sms:registerWebhook
```

This registers `https://<deployment>.convex.site/api/sendblue/webhook` with Sendblue.

See [WEBHOOKS.md](./WEBHOOKS.md) for detailed webhook setup and troubleshooting.

## Group Chat Support

**Requires Sendblue dedicated plan.**

Group chats are automatically detected via `group_id` in webhook payload:
- Messages scoped by `group_id` instead of phone number
- User messages prefixed with sender's last 4 digits: `[1234]: message`
- LLM gets group-aware system prompt
- Responses sent via `sendGroupMessage` action
- Typing indicators skipped (not supported in groups)

On free plan, `group_id` will always be empty.

### Creating Groups

**Use Sendblue (not BlueBubbles) to create groups:**

```typescript
await ctx.runAction(internal.sms.createGroupChat, {
  numbers: ["+19493020749", "+17025285299"],
  initialMessage: "Welcome to the group!",
});
```

See [GROUP_CHATS.md](./GROUP_CHATS.md) for details and troubleshooting.

## Database Tables

### smsMessages
- `content`, `fromNumber`, `toNumber`, `isOutbound`, `status`
- `messageHandle` - Sendblue's unique ID for deduplication
- `groupId`, `participants` - for group chats

### smsWebhookLogs
- Raw webhook payloads for debugging

## Query Data

```bash
cd packages/convex
bunx convex data smsMessages --format jsonl | tail -10
bunx convex data smsWebhookLogs --format jsonl | tail -5
```

## Related Docs

- [WEBHOOKS.md](./WEBHOOKS.md) - Webhook setup and troubleshooting
- [GROUP_CHATS.md](./GROUP_CHATS.md) - Group chat creation via Sendblue
