import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const hostEnv = createEnv({
  clientPrefix: "NEXT_PUBLIC_CMUX_HOST_",
  server: {
    // Host configurations for different services
    CMUX_HOST_CLIENT: z.string().default("localhost:5173"),
    CMUX_HOST_SERVER: z.string().default("localhost:9779"),
    CMUX_HOST_VSCODE: z.string().default("localhost:39377"),
    CMUX_HOST_OPENCODE: z.string().default("127.0.0.1"),
    CMUX_HOST_AMP_PROXY: z.string().default("localhost"),
    CMUX_HOST_SANDBOX_API: z.string().default("localhost:46833"),
  },
  client: {
    // Client-exposed host configurations
    NEXT_PUBLIC_CMUX_HOST_CLIENT: z.string().default("localhost:5173"),
    NEXT_PUBLIC_CMUX_HOST_SERVER: z.string().default("localhost:9779"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

// Helper functions to get full URLs
export const getHostUrl = (
  host: string,
  path: string = "",
  protocol: "http" | "https" = "http",
): string => {
  const cleanHost = host.replace(/^https?:\/\//, "");
  return `${protocol}://${cleanHost}${path}`;
};

export const getClientUrl = (path: string = ""): string =>
  getHostUrl(hostEnv.CMUX_HOST_CLIENT, path);

export const getServerUrl = (path: string = ""): string =>
  getHostUrl(hostEnv.CMUX_HOST_SERVER, path);

export const getVSCodeUrl = (path: string = ""): string =>
  getHostUrl(hostEnv.CMUX_HOST_VSCODE, path);

export const getOpencodeUrl = (path: string = ""): string =>
  getHostUrl(hostEnv.CMUX_HOST_OPENCODE, path);

export const getAmpProxyUrl = (path: string = ""): string =>
  getHostUrl(hostEnv.CMUX_HOST_AMP_PROXY, path);

export const getSandboxApiUrl = (path: string = ""): string =>
  getHostUrl(hostEnv.CMUX_HOST_SANDBOX_API, path);

// Default host configurations for reference
export const DEFAULT_HOSTS = {
  CLIENT: "localhost:5173",
  SERVER: "localhost:9779",
  VSCODE: "localhost:39377",
  OPENCODE: "127.0.0.1",
  AMP_PROXY: "localhost",
  SANDBOX_API: "localhost:46833",
} as const;
