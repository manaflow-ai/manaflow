import { createOpencode } from "@opencode-ai/sdk"

const opencode = await createOpencode({
  hostname: "0.0.0.0",
  port: 4096,
  config: {
    model: "opencode/grok-code",
  },
})

console.log(`Server running at ${opencode.server.url}`)
