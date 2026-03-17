import { resolve } from "node:path";

export type SetAsDefaultProtocolClientCall =
  | { kind: "simple"; scheme: string }
  | { kind: "withArgs"; scheme: string; execPath: string; args: string[] };

function looksLikeOption(arg: string): boolean {
  return arg.startsWith("-");
}

function looksLikeUrl(arg: string): boolean {
  // Protocol URLs may include auth tokens; treat all URLs as non-paths here.
  try {
    new URL(arg);
    return true;
  } catch {
    return arg.includes("://");
  }
}

function isLikelyAppPathArg(arg: string): boolean {
  return arg.length > 0 && !looksLikeOption(arg) && !looksLikeUrl(arg);
}

export function computeSetAsDefaultProtocolClientCall(params: {
  scheme: string;
  defaultApp: boolean;
  execPath: string;
  argv: readonly string[];
}): SetAsDefaultProtocolClientCall {
  if (!params.defaultApp) {
    return { kind: "simple", scheme: params.scheme };
  }

  // In development, Electron is launched as the "default app" (Electron.app).
  // Registering a protocol handler must include an app path argument so the OS
  // can relaunch Electron with our app when a manaflow:// URL is opened.
  const appPathArg = params.argv.slice(1).find(isLikelyAppPathArg);
  if (!appPathArg) {
    return { kind: "simple", scheme: params.scheme };
  }

  return {
    kind: "withArgs",
    scheme: params.scheme,
    execPath: params.execPath,
    args: [resolve(appPathArg)],
  };
}
