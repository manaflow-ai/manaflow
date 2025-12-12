import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Load root .env so tests have Stack and GitHub env values
// In ESM, __dirname is not defined; derive it from import.meta.url
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Only load .env if it exists - supports both direnv users (no .env needed)
// and traditional .env file users. dotenv won't override existing env vars.
const envPath = path.resolve(__dirname, "../../.env");
if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

export default defineConfig({
  // Avoid Vite plugin type mismatches by setting alias directly
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
  },
  envPrefix: "NEXT_PUBLIC_",
});
