export interface HostConfig {
  client: string;
  server: string;
  vscode: string;
  opencode: string;
  ampProxy: string;
  sandboxApi: string;
}

export const defaultHostConfig: HostConfig = {
  client: "localhost:5173",
  server: "localhost:9779",
  vscode: "localhost:39377",
  opencode: "127.0.0.1",
  ampProxy: "localhost",
  sandboxApi: "localhost:46833",
};

export const getHostUrl = (
  host: string,
  path: string = "",
  protocol: "http" | "https" = "http",
): string => {
  const cleanHost = host.replace(/^https?:\/\//, "");
  return `${protocol}://${cleanHost}${path}`;
};
