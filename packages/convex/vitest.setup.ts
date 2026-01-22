import { webcrypto } from "node:crypto";

// Ensure Web Crypto API is available (crypto.subtle) in Node.
const needsPolyfill =
  typeof (globalThis as unknown as { crypto?: Crypto }).crypto === "undefined" ||
  typeof (globalThis as unknown as { crypto?: Crypto }).crypto?.subtle ===
    "undefined";

if (needsPolyfill) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

const envDefaults: Record<string, string> = {
  STACK_WEBHOOK_SECRET: "test_stack_webhook_secret",
  BASE_APP_URL: "http://localhost",
  CMUX_TASK_RUN_JWT_SECRET: "test_task_run_jwt_secret",
};

for (const [key, value] of Object.entries(envDefaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
