import type { MacArchitecture, MacDownloadUrls } from "@/lib/releases";

const hasDownloadUrl = (value: string | null): value is string =>
  typeof value === "string" && value.trim() !== "";

const detectionLog = (message: string, details?: Record<string, unknown>) => {
  if (typeof console === "undefined") {
    return;
  }

  if (details) {
    console.log("[cmux direct-download]", message, details);
  } else {
    console.log("[cmux direct-download]", message);
  }
};

export const normalizeMacArchitecture = (
  value: string | null | undefined,
): MacArchitecture | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "universal" || normalized === "universal2") {
    return "universal";
  }

  if (normalized === "arm" || normalized === "arm64" || normalized === "aarch64") {
    return "arm64";
  }

  if (
    normalized === "x86" ||
    normalized === "x86_64" ||
    normalized === "amd64" ||
    normalized === "x64"
  ) {
    return "x64";
  }

  return null;
};

export const inferMacArchitectureFromUserAgent = (
  userAgent: string | null | undefined,
): MacArchitecture | null => {
  if (typeof userAgent !== "string") {
    return null;
  }

  const normalized = userAgent.toLowerCase();

  if (!normalized.includes("mac")) {
    return null;
  }

  if (normalized.includes("arm") || normalized.includes("aarch64")) {
    return "arm64";
  }

  if (
    normalized.includes("x86_64") ||
    normalized.includes("intel") ||
    normalized.includes("x64") ||
    normalized.includes("amd64")
  ) {
    return "x64";
  }

  return null;
};

type NavigatorTouchInfo = {
  platform?: string | null;
  maxTouchPoints?: number | null | undefined;
};

export const touchBasedMacArchitectureHint = (
  info: NavigatorTouchInfo,
): MacArchitecture | null => {
  const { platform, maxTouchPoints } = info;
  const normalizedPlatform = typeof platform === "string" ? platform.toLowerCase() : "";

  if (!normalizedPlatform.includes("mac")) {
    return null;
  }

  const touchPoints =
    typeof maxTouchPoints === "number" && Number.isFinite(maxTouchPoints)
      ? maxTouchPoints
      : 0;

  if (touchPoints > 0 && normalizedPlatform === "macintel") {
    return "arm64";
  }

  return null;
};

export const architectureFromWebGLRenderer = (
  renderer: string | null | undefined,
): MacArchitecture | null => {
  if (typeof renderer !== "string") {
    return null;
  }

  const normalized = renderer.toLowerCase();

  if (normalized.includes("apple") && (normalized.includes(" m") || normalized.includes("gpu"))) {
    return "arm64";
  }

  if (normalized.includes("intel") || normalized.includes("amd") || normalized.includes("radeon")) {
    return "x64";
  }

  return null;
};

const detectArchitectureViaWebGL = async (): Promise<MacArchitecture | null> => {
  if (typeof document === "undefined") {
    return null;
  }

  const getRendererString = (): string | null => {
    try {
      const canvas = document.createElement("canvas");
      const gl =
        (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
        (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
        (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);

      if (!gl) {
        return null;
      }

      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info") as
        | WEBGL_debug_renderer_info
        | null;

      if (!debugInfo) {
        return null;
      }

      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);

      return typeof renderer === "string" ? renderer : null;
    } catch {
      return null;
    }
  };

  const renderer = getRendererString();

  if (!renderer) {
    detectionLog("webgl renderer unavailable");
    return null;
  }

  const architecture = architectureFromWebGLRenderer(renderer);

  detectionLog("webgl renderer inspected", {
    renderer,
    architecture: architecture ?? "unknown",
  });

  return architecture;
};

export const pickMacDownloadUrl = (
  macDownloadUrls: MacDownloadUrls,
  fallbackUrl: string,
  architecture: MacArchitecture | null,
): string => {
  if (architecture) {
    const candidate = macDownloadUrls[architecture];

    if (hasDownloadUrl(candidate)) {
      return candidate;
    }
  }

  if (hasDownloadUrl(macDownloadUrls.universal)) {
    return macDownloadUrls.universal;
  }

  if (hasDownloadUrl(macDownloadUrls.arm64)) {
    return macDownloadUrls.arm64;
  }

  if (hasDownloadUrl(macDownloadUrls.x64)) {
    return macDownloadUrls.x64;
  }

  return fallbackUrl;
};

export const getNavigatorArchitectureHint = (): MacArchitecture | null => {
  if (typeof navigator === "undefined") {
    return null;
  }

  const platform = navigator.platform?.toLowerCase() ?? "";
  const userAgent = navigator.userAgent;
  const normalizedUserAgent = userAgent.toLowerCase();
  const isMac = platform.includes("mac") || normalizedUserAgent.includes("macintosh");

  if (!isMac) {
    return null;
  }

  const navigatorWithUAData = navigator as Navigator & {
    userAgentData?: {
      architecture?: string;
    };
  };

  const uaData = navigatorWithUAData.userAgentData;

  if (uaData) {
    const architectureHint = normalizeMacArchitecture(uaData.architecture);

    if (architectureHint) {
      detectionLog("navigator userAgentData hint", {
        architecture: architectureHint,
      });
      return architectureHint;
    }
  }

  const touchHint = touchBasedMacArchitectureHint({
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });

  if (touchHint) {
    detectionLog("navigator touch hint", { architecture: touchHint });
    return touchHint;
  }

  return null;
};

export const detectClientMacArchitecture = async (): Promise<MacArchitecture | null> => {
  const immediateHint = getNavigatorArchitectureHint();

  if (immediateHint) {
    detectionLog("architecture detected via navigator hint", {
      architecture: immediateHint,
    });
    return immediateHint;
  }

  if (typeof navigator === "undefined") {
    return null;
  }

  const navigatorWithUAData = navigator as Navigator & {
    userAgentData?: {
      architecture?: string;
      getHighEntropyValues?: (
        hints: readonly string[],
      ) => Promise<Record<string, unknown>>;
    };
  };

  const uaData = navigatorWithUAData.userAgentData;

  if (!uaData || typeof uaData.getHighEntropyValues !== "function") {
    const touchHint = touchBasedMacArchitectureHint({
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    });

    if (touchHint) {
      detectionLog("architecture detected via touch fallback", {
        architecture: touchHint,
        stage: "no-ua-data",
      });
      return touchHint;
    }

    const webglHint = await detectArchitectureViaWebGL();

    if (webglHint) {
      detectionLog("architecture detected via webgl renderer", {
        architecture: webglHint,
      });
      return webglHint;
    }

    const userAgentFallback = inferMacArchitectureFromUserAgent(navigator.userAgent);

    detectionLog("architecture inferred from user agent", {
      architecture: userAgentFallback ?? "unknown",
    });

    return userAgentFallback;
  }

  const details = await uaData
    .getHighEntropyValues(["architecture"])
    .catch(() => null);

  if (details && typeof details === "object") {
    const maybeValue = (details as Record<string, unknown>).architecture;
    const normalizedArchitecture = normalizeMacArchitecture(
      typeof maybeValue === "string" ? maybeValue : null,
    );

    if (normalizedArchitecture) {
      detectionLog("architecture detected via high entropy ua data", {
        architecture: normalizedArchitecture,
      });
      return normalizedArchitecture;
    }
  }

  const touchHint = touchBasedMacArchitectureHint({
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  });

  if (touchHint) {
    detectionLog("architecture detected via touch fallback", {
      architecture: touchHint,
      stage: "post-ua-data",
    });
    return touchHint;
  }

  const webglHint = await detectArchitectureViaWebGL();

  if (webglHint) {
    detectionLog("architecture detected via webgl renderer", {
      architecture: webglHint,
    });
    return webglHint;
  }

  const userAgentFallback = inferMacArchitectureFromUserAgent(navigator.userAgent);

  detectionLog("architecture inferred from user agent", {
    architecture: userAgentFallback ?? "unknown",
  });

  return userAgentFallback;
};
