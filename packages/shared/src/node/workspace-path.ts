const DEFAULT_CONTAINER_WORKSPACE_PATH = "/root/workspace";

export function getContainerWorkspacePath(): string {
  const fromEnv = process.env.CMUX_WORKSPACE_PATH;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv.trim();
  }
  return DEFAULT_CONTAINER_WORKSPACE_PATH;
}

export { DEFAULT_CONTAINER_WORKSPACE_PATH };
