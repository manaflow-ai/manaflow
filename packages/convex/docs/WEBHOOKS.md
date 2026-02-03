# Sendblue Webhooks

Setup and management of Sendblue webhooks for receiving messages and delivery updates.

## Overview

Sendblue sends webhook notifications when:
- **Incoming message** (`receive`) - User sends a message to your number
- **Outbound status** (`outbound`) - Delivery status updates for messages you sent

## Environment Variables

```bash
cd packages/convex

# Sendblue API credentials
bunx convex env set SENDBLUE_API_KEY "your-api-key"
bunx convex env set SENDBLUE_API_SECRET "your-api-secret"

# Secret for webhook signature verification (you create this)
bunx convex env set SENDBLUE_WEBHOOK_SECRET "your-random-secret-string"
```

The `SENDBLUE_WEBHOOK_SECRET` is a secret you generate. Sendblue includes it in webhook requests via the `sb-signing-secret` header for authenticity verification.

Generate a secure secret:
```bash
openssl rand -base64 32
```

## Webhook URL

Your webhook endpoint is:
```
https://<deployment>.convex.site/api/sendblue/webhook
```

Get your deployment URL:
```bash
bunx convex env get CONVEX_SITE_URL
```

## Setup Webhooks

### Option 1: Via Convex Action (Recommended)

```bash
cd packages/convex
bunx convex run sms:registerWebhook
```

This automatically:
1. Reads `CONVEX_SITE_URL` to build webhook URL
2. **Replaces ALL existing webhooks** (PUT method = cleanup + register)
3. Registers both `receive` and `outbound` hooks with your secret

### Option 2: Manual via Sendblue API

```bash
# List current webhooks
curl "https://api.sendblue.co/api/account/webhooks" \
  -H "sb-api-key-id: YOUR_API_KEY" \
  -H "sb-api-secret-key: YOUR_API_SECRET"

# Register webhooks (replaces all)
curl "https://api.sendblue.co/api/account/webhooks" \
  -X PUT \
  -H "sb-api-key-id: YOUR_API_KEY" \
  -H "sb-api-secret-key: YOUR_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "webhooks": {
      "receive": [{"url": "https://YOUR_DEPLOYMENT.convex.site/api/sendblue/webhook", "secret": "YOUR_SECRET"}],
      "outbound": [{"url": "https://YOUR_DEPLOYMENT.convex.site/api/sendblue/webhook", "secret": "YOUR_SECRET"}]
    }
  }'
```

### Option 3: Sendblue Dashboard

1. Go to [app.sendblue.co](https://app.sendblue.co)
2. Navigate to API Settings → Webhooks
3. Add webhook URL: `https://<deployment>.convex.site/api/sendblue/webhook`
4. Set your signing secret

## Webhook Payloads

### Incoming Message (`receive`)

```json
{
  "accountEmail": "you@example.com",
  "content": "Hello!",
  "media_url": "",
  "is_outbound": false,
  "status": "RECEIVED",
  "error_code": null,
  "error_message": null,
  "message_handle": "abc123-def456",
  "date_sent": "2024-01-01T12:00:00.000Z",
  "date_updated": "2024-01-01T12:00:00.000Z",
  "from_number": "+19493020749",
  "number": "+19493020749",
  "to_number": "+17025285299",
  "was_downgraded": false,
  "plan": "sapphire",
  "service": "iMessage",
  "group_id": "",
  "participants": [],
  "group_display_name": null
}
```

### Outbound Status (`outbound`)

```json
{
  "accountEmail": "you@example.com",
  "content": "Hi there!",
  "is_outbound": true,
  "status": "DELIVERED",
  "error_code": null,
  "error_message": null,
  "message_handle": "xyz789",
  "date_sent": "2024-01-01T12:00:01.000Z",
  "from_number": "+17025285299",
  "to_number": "+19493020749",
  "service": "iMessage",
  "group_id": "",
  "participants": []
}
```

### Group Message

```json
{
  "content": "Hello group!",
  "is_outbound": false,
  "from_number": "+19493020749",
  "to_number": "+17025285299",
  "status": "RECEIVED",
  "service": "iMessage",
  "group_id": "group-abc123",
  "participants": ["+19493020749", "+17025285299", "+15551234567"],
  "group_display_name": "My Group Chat"
}
```

## Status Values

| Status | Description |
|--------|-------------|
| `RECEIVED` | Incoming message received |
| `QUEUED` | Outbound message queued |
| `SENT` | Message sent to carrier |
| `DELIVERED` | Message delivered to recipient |
| `ERROR` | Delivery failed |

## Signature Validation

Sendblue includes your secret in the `sb-signing-secret` header. The webhook handler verifies it:

```typescript
const signature = request.headers.get("sb-signing-secret");
if (signature !== SENDBLUE_WEBHOOK_SECRET) {
  return new Response("Unauthorized", { status: 401 });
}
```

## Message Processing Flow

1. Webhook received at `/api/sendblue/webhook`
2. Signature validated
3. Payload logged to `smsWebhookLogs` table
4. Message stored in `smsMessages` table
5. For inbound messages: `handleInboundMessage` triggered
6. LLM generates response
7. Response sent via Sendblue

## Troubleshooting

### Not receiving webhooks

1. Verify webhook is registered:
   ```bash
   curl "https://api.sendblue.co/api/account/webhooks" \
     -H "sb-api-key-id: YOUR_API_KEY" \
     -H "sb-api-secret-key: YOUR_API_SECRET"
   ```

2. Check URL is correct (must use `https://`)

3. Re-run webhook registration:
   ```bash
   bunx convex run sms:registerWebhook
   ```

### 401 Unauthorized errors

- `SENDBLUE_WEBHOOK_SECRET` doesn't match what's registered
- Re-run `registerWebhook` to sync

### Duplicate messages

- Messages are deduplicated by `message_handle`
- Check `message_handle` is being passed correctly

### Check webhook logs

```bash
cd packages/convex
bunx convex data smsWebhookLogs --format jsonl | tail -10
```

### Monitor live

```bash
bunx convex logs --success
```

## Related Files

- `convex/sms_http.ts` - Webhook handler
- `convex/sendblue.ts` - Sendblue client (includes `registerWebhook`)
- `convex/sms.ts` - Message handling actions
- `convex/sms_queries.ts` - Database operations

See also: [SMS.md](./SMS.md) for full SMS integration docs.
