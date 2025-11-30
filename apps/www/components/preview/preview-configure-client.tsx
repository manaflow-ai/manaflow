"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Loader2,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  Minus,
  Plus,
  Copy,
  Github,
  ChevronDown,
  Sparkles,
  Check,
} from "lucide-react";
import Link from "next/link";
import { formatEnvVarsContent } from "@cmux/shared/utils/format-env-vars-content";
import clsx from "clsx";

const MASKED_ENV_VALUE = "••••••••••••••••";

export type FrameworkPreset =
  | "other"
  | "next"
  | "vite"
  | "remix"
  | "nuxt"
  | "sveltekit"
  | "angular"
  | "cra"
  | "vue";

type FrameworkIconKey =
  | "other"
  | "next"
  | "vite"
  | "remix"
  | "nuxt"
  | "svelte"
  | "angular"
  | "react"
  | "vue";

type FrameworkPresetConfig = {
  name: string;
  maintenanceScript: string;
  devScript: string;
  icon: FrameworkIconKey;
};

const FRAMEWORK_PRESETS: Record<FrameworkPreset, FrameworkPresetConfig> = {
  other: { name: "Other", maintenanceScript: "", devScript: "", icon: "other" },
  next: { name: "Next.js", maintenanceScript: "npm install", devScript: "npm run dev", icon: "next" },
  vite: { name: "Vite", maintenanceScript: "npm install", devScript: "npm run dev", icon: "vite" },
  remix: { name: "Remix", maintenanceScript: "npm install", devScript: "npm run dev", icon: "remix" },
  nuxt: { name: "Nuxt", maintenanceScript: "npm install", devScript: "npm run dev", icon: "nuxt" },
  sveltekit: {
    name: "SvelteKit",
    maintenanceScript: "npm install",
    devScript: "npm run dev",
    icon: "svelte",
  },
  angular: {
    name: "Angular",
    maintenanceScript: "npm install",
    devScript: "npm start",
    icon: "angular",
  },
  cra: {
    name: "Create React App",
    maintenanceScript: "npm install",
    devScript: "npm start",
    icon: "react",
  },
  vue: {
    name: "Vue",
    maintenanceScript: "npm install",
    devScript: "npm run dev",
    icon: "vue",
  },
};

type SandboxInstance = {
  instanceId: string;
  vscodeUrl: string;
  workerUrl: string;
  vncUrl?: string;
  provider: string;
};

type EnvVar = { name: string; value: string; isSecret: boolean };

type WizardStep = 1 | 2;

type PreviewTeamOption = {
  id: string;
  slug: string | null;
  slugOrId: string;
  displayName: string;
  name: string | null;
};

type PreviewConfigureClientProps = {
  initialTeamSlugOrId: string;
  teams: PreviewTeamOption[];
  repo: string;
  installationId: string | null;
  initialFrameworkPreset?: FrameworkPreset;
  initialEnvVarsContent?: string | null;
  initialMaintenanceScript?: string | null;
  initialDevScript?: string | null;
  startAtConfigureEnvironment?: boolean;
};

function normalizeVncUrl(url: string): string | null {
  try {
    const target = new URL(url);
    target.searchParams.set("autoconnect", "1");
    target.searchParams.set("resize", "scale");
    return target.toString();
  } catch {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}autoconnect=1&resize=scale`;
  }
}

function resolveMorphHostId(
  instanceId?: string,
  workspaceUrl?: string
): string | null {
  if (instanceId && instanceId.trim().length > 0) {
    return instanceId.trim().toLowerCase().replace(/_/g, "-");
  }

  if (!workspaceUrl) {
    return null;
  }

  try {
    const url = new URL(workspaceUrl);
    const directMatch = url.hostname.match(
      /^port-\d+-(morphvm-[^.]+)\.http\.cloud\.morph\.so$/i
    );
    if (directMatch && directMatch[1]) {
      return directMatch[1].toLowerCase();
    }

    const proxyMatch = url.hostname.match(
      /^cmux-([^-]+)-[a-z0-9-]+-\d+\.cmux\.(?:app|dev|sh|local|localhost)$/i
    );
    if (proxyMatch && proxyMatch[1]) {
      return `morphvm-${proxyMatch[1].toLowerCase()}`;
    }
  } catch {
    return null;
  }

  return null;
}

function deriveVncUrl(
  instanceId?: string,
  workspaceUrl?: string
): string | null {
  const morphHostId = resolveMorphHostId(instanceId, workspaceUrl);
  if (!morphHostId) {
    return null;
  }

  const hostname = `port-39380-${morphHostId}.http.cloud.morph.so`;
  const baseUrl = `https://${hostname}/vnc.html`;
  return normalizeVncUrl(baseUrl);
}

const FRAMEWORK_ICON_META: Record<
  FrameworkIconKey,
  { icon: ReactNode; bgClass: string; textClass: string }
> = {
  other: {
    icon: <Sparkles className="h-4 w-4" />,
    bgClass: "bg-neutral-200 dark:bg-neutral-800",
    textClass: "text-neutral-700 dark:text-neutral-100",
  },
  next: {
    icon: (
      <img
        src="/framework-logos/next.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  vite: {
    icon: (
      <img
        src="/framework-logos/vite.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  remix: {
    icon: (
      <img
        src="/framework-logos/remix.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  nuxt: {
    icon: (
      <img
        src="/framework-logos/nuxt.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  svelte: {
    icon: (
      <img
        src="/framework-logos/svelte.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  angular: {
    icon: (
      <img
        src="/framework-logos/angular.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  react: {
    icon: (
      <img
        src="/framework-logos/react.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  vue: {
    icon: (
      <img
        src="/framework-logos/vue.svg"
        alt=""
        aria-hidden="true"
        className="h-5 w-5"
      />
    ),
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
};

function FrameworkIconBubble({ preset }: { preset: FrameworkPreset }) {
  const meta = FRAMEWORK_ICON_META[FRAMEWORK_PRESETS[preset].icon] ?? FRAMEWORK_ICON_META.other;
  return (
    <span
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800",
        meta.bgClass,
        meta.textClass
      )}
      aria-hidden="true"
    >
      {meta.icon}
    </span>
  );
}

const ensureInitialEnvVars = (initial?: EnvVar[]): EnvVar[] => {
  const base = (initial ?? []).map((item) => ({
    name: item.name,
    value: item.value,
    isSecret: item.isSecret ?? true,
  }));
  if (base.length === 0) {
    return [{ name: "", value: "", isSecret: true }];
  }
  const last = base[base.length - 1];
  if (!last || last.name.trim().length > 0 || last.value.trim().length > 0) {
    base.push({ name: "", value: "", isSecret: true });
  }
  return base;
};

function parseEnvBlock(text: string): Array<{ name: string; value: string }> {
  const normalized = text.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const results: Array<{ name: string; value: string }> = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#") || trimmed.startsWith("//")) continue;

    const cleanLine = trimmed.replace(/^export\s+/, "").replace(/^set\s+/, "");
    const eqIdx = cleanLine.indexOf("=");

    if (eqIdx === -1) continue;

    const key = cleanLine.slice(0, eqIdx).trim();
    let value = cleanLine.slice(eqIdx + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key && !/\s/.test(key)) {
      results.push({ name: key, value });
    }
  }

  return results;
}


// Persistent iframe manager for Next.js
type PersistentIframeOptions = {
  allow?: string;
  sandbox?: string;
};

type MountOptions = {
  backgroundColor?: string;
};

class SimplePersistentIframeManager {
  private iframes = new Map<
    string,
    { iframe: HTMLIFrameElement; wrapper: HTMLDivElement; allow?: string; sandbox?: string }
  >();
  private container: HTMLDivElement | null = null;

  constructor() {
    if (typeof document !== "undefined") {
      this.initContainer();
    }
  }

  private initContainer() {
    this.container = document.createElement("div");
    this.container.id = "persistent-iframe-container";
    this.container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      pointer-events: none;
      z-index: 9999;
    `;
    document.body.appendChild(this.container);
  }

  setVisibility(key: string, visible: boolean) {
    const entry = this.iframes.get(key);
    if (!entry) {
      return;
    }
    entry.wrapper.style.visibility = visible ? "visible" : "hidden";
    entry.wrapper.style.pointerEvents = visible ? "auto" : "none";
  }

  getOrCreateIframe(
    key: string,
    url: string,
    options?: PersistentIframeOptions
  ): HTMLIFrameElement {
    const existing = this.iframes.get(key);
    if (existing) {
      if (options?.allow && existing.allow !== options.allow) {
        existing.iframe.allow = options.allow;
        existing.allow = options.allow;
      }
      if (options?.sandbox && existing.sandbox !== options.sandbox) {
        existing.iframe.setAttribute("sandbox", options.sandbox);
        existing.sandbox = options.sandbox;
      }
      if (existing.iframe.src !== url) {
        existing.iframe.src = url;
      }
      return existing.iframe;
    }

    const wrapper = document.createElement("div");
    wrapper.style.cssText = `
      position: fixed;
      visibility: hidden;
      pointer-events: none;
      transform: translate(-100vw, -100vh);
      width: 0;
      height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
    `;
    wrapper.setAttribute("data-iframe-key", key);

    const iframe = document.createElement("iframe");
    iframe.style.cssText = `
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
      background: transparent;
    `;
    iframe.style.transform = "none";
    iframe.src = url;
    if (options?.allow) {
      iframe.allow = options.allow;
    } else {
      iframe.allow = "clipboard-read; clipboard-write; cross-origin-isolated; fullscreen";
    }
    if (options?.sandbox) {
      iframe.setAttribute("sandbox", options.sandbox);
    } else {
      iframe.setAttribute(
        "sandbox",
        "allow-same-origin allow-scripts allow-forms allow-downloads allow-modals allow-popups"
      );
    }

    wrapper.appendChild(iframe);
    this.container?.appendChild(wrapper);
    this.iframes.set(key, {
      iframe,
      wrapper,
      allow: options?.allow,
      sandbox: options?.sandbox,
    });

    return iframe;
  }

  mountIframe(
    key: string,
    targetElement: HTMLElement,
    options?: MountOptions
  ): () => void {
    const entry = this.iframes.get(key);
    if (!entry) return () => {};

    entry.wrapper.style.background = options?.backgroundColor ?? "transparent";

    const syncPosition = () => {
      const rect = targetElement.getBoundingClientRect();
      entry.wrapper.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
      entry.wrapper.style.width = `${rect.width}px`;
      entry.wrapper.style.height = `${rect.height}px`;
    };

    entry.wrapper.style.visibility = "visible";
    entry.wrapper.style.pointerEvents = "auto";
    entry.iframe.style.transform = "none";
    syncPosition();

    const observer = new ResizeObserver(syncPosition);
    observer.observe(targetElement);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      entry.wrapper.style.visibility = "hidden";
      entry.wrapper.style.pointerEvents = "none";
      observer.disconnect();
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }
}

const iframeManager = typeof window !== "undefined" ? new SimplePersistentIframeManager() : null;

function StepBadge({ step, done }: { step: number; done: boolean }) {
  return (
    <span
      className={clsx(
        "flex h-5 w-5 items-center justify-center rounded-full border text-[11px]",
        done
          ? "border-emerald-500 bg-emerald-50 text-emerald-700 dark:border-emerald-400/70 dark:bg-emerald-900/40 dark:text-emerald-100"
          : "border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400"
      )}
    >
      {done ? <Check className="h-3 w-3" /> : step}
    </span>
  );
}

export function PreviewConfigureClient({
  initialTeamSlugOrId,
  teams,
  repo,
  installationId: _installationId,
  initialFrameworkPreset = "other",
  initialEnvVarsContent,
  initialMaintenanceScript,
  initialDevScript,
  startAtConfigureEnvironment = false,
}: PreviewConfigureClientProps) {
  const initialEnvVars = useMemo(() => {
    const parsed = initialEnvVarsContent
      ? parseEnvBlock(initialEnvVarsContent).map((entry) => ({
          name: entry.name,
          value: entry.value,
          isSecret: true,
        }))
      : undefined;
    return ensureInitialEnvVars(parsed);
  }, [initialEnvVarsContent]);
  const initialHasEnvValues = useMemo(
    () => initialEnvVars.some((r) => r.name.trim().length > 0 || r.value.trim().length > 0),
    [initialEnvVars]
  );
  const initialFrameworkConfig =
    FRAMEWORK_PRESETS[initialFrameworkPreset] ?? FRAMEWORK_PRESETS.other;
  const initialMaintenanceScriptValue =
    initialMaintenanceScript ?? initialFrameworkConfig.maintenanceScript;
  const initialDevScriptValue = initialDevScript ?? initialFrameworkConfig.devScript;
  const initialMaintenanceNone = initialMaintenanceScriptValue.trim().length === 0;
  const initialDevNone = initialDevScriptValue.trim().length === 0;
  const initialEnvComplete = initialHasEnvValues;
  const initialMaintenanceComplete = initialMaintenanceNone || initialMaintenanceScriptValue.trim().length > 0;
  const initialDevComplete = initialDevNone || initialDevScriptValue.trim().length > 0;

  const [instance, setInstance] = useState<SandboxInstance | null>(null);
  const [isProvisioning, setIsProvisioning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedTeamSlugOrId = useMemo(
    () => initialTeamSlugOrId || teams[0]?.slugOrId || "",
    [initialTeamSlugOrId, teams]
  );

  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  const [envVars, setEnvVars] = useState<EnvVar[]>(initialEnvVars);
  const [frameworkPreset, setFrameworkPreset] = useState<FrameworkPreset>(initialFrameworkPreset);
  const [maintenanceScript, setMaintenanceScript] = useState(initialMaintenanceScriptValue);
  const [devScript, setDevScript] = useState(initialDevScriptValue);
  const [hasUserEditedScripts, setHasUserEditedScripts] = useState(false);
  const [isFrameworkMenuOpen, setIsFrameworkMenuOpen] = useState(false);
  const [hasCompletedSetup, setHasCompletedSetup] = useState(false);
  const [isEnvOpen, setIsEnvOpen] = useState(false);
  const [isBuildOpen, setIsBuildOpen] = useState(false);
  const [envNone, setEnvNone] = useState(false);
  const [maintenanceNone, setMaintenanceNone] = useState(() => initialMaintenanceNone);
  const [devNone, setDevNone] = useState(() => initialDevNone);
  const [runConfirmed, setRunConfirmed] = useState(false);
  const [browserConfirmed, setBrowserConfirmed] = useState(false);
  const [commandsCopied, setCommandsCopied] = useState(false);
  const [isEnvSectionOpen, setIsEnvSectionOpen] = useState(() => !initialEnvComplete);
  const [isMaintenanceSectionOpen, setIsMaintenanceSectionOpen] = useState(
    () => !initialMaintenanceComplete
  );
  const [isDevSectionOpen, setIsDevSectionOpen] = useState(() => !initialDevComplete);
  const [isRunSectionOpen, setIsRunSectionOpen] = useState(true);
  const [isBrowserSetupSectionOpen, setIsBrowserSetupSectionOpen] = useState(true);

  const [areEnvValuesHidden, setAreEnvValuesHidden] = useState(true);
  const [activeEnvValueIndex, setActiveEnvValueIndex] = useState<number | null>(null);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (initialHasEnvValues) {
      setIsEnvSectionOpen(false);
    }
  }, [initialHasEnvValues]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        frameworkSelectRef.current &&
        !frameworkSelectRef.current.contains(event.target as Node)
      ) {
        setIsFrameworkMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsFrameworkMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const persistentIframeManager = iframeManager;

  const keyInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const lastSubmittedEnvContent = useRef<string | null>(null);
  const frameworkSelectRef = useRef<HTMLDivElement | null>(null);
  const copyResetTimeoutRef = useRef<number | null>(null);
  const envSectionCollapsedOnEnterRef = useRef(false);

  useEffect(() => {
    return () => {
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
    };
  }, []);

  const vscodePersistKey = instance?.instanceId ? `preview-${instance.instanceId}:vscode` : "vscode";
  const browserPersistKey = instance?.instanceId ? `preview-${instance.instanceId}:browser` : "browser";

  const selectedTeam = useMemo(
    () => teams.find((team) => team.slugOrId === selectedTeamSlugOrId) ?? teams[0] ?? null,
    [selectedTeamSlugOrId, teams]
  );

  const resolvedTeamSlugOrId =
    selectedTeam?.slugOrId ?? initialTeamSlugOrId ?? teams[0]?.slugOrId ?? "";
  const selectedTeamSlugOrIdRef = useRef(resolvedTeamSlugOrId);
  const frameworkOptions = useMemo(
    () => Object.entries(FRAMEWORK_PRESETS) as Array<[FrameworkPreset, FrameworkPresetConfig]>,
    []
  );
  const selectedFrameworkConfig = FRAMEWORK_PRESETS[frameworkPreset];

  useEffect(() => {
    selectedTeamSlugOrIdRef.current = resolvedTeamSlugOrId;
  }, [resolvedTeamSlugOrId]);

  const resolvedVncUrl = useMemo(() => {
    if (instance?.vncUrl) {
      return normalizeVncUrl(instance.vncUrl) ?? instance.vncUrl;
    }
    return deriveVncUrl(instance?.instanceId, instance?.vscodeUrl);
  }, [instance?.instanceId, instance?.vncUrl, instance?.vscodeUrl]);

  const workspacePlaceholder = useMemo(
    () =>
      instance?.vscodeUrl
        ? null
        : {
            title: instance?.instanceId
              ? "Waiting for VS Code"
              : "VS Code workspace not ready",
            description: instance?.instanceId
              ? "The editor opens automatically once the environment finishes booting."
              : "Provisioning the workspace. We'll open VS Code as soon as it's ready.",
          },
    [instance?.instanceId, instance?.vscodeUrl]
  );

  const hasEnvValues = useMemo(
    () => envVars.some((r) => r.name.trim().length > 0 || r.value.trim().length > 0),
    [envVars]
  );
  const maintenanceScriptValue = maintenanceScript.trim();
  const devScriptValue = devScript.trim();
  const envDone = envNone || hasEnvValues;
  const maintenanceDone = maintenanceNone || maintenanceScriptValue.length > 0;
  const devDone = devNone || devScriptValue.length > 0;

  // Collapse env section when entering configure step if it's already satisfied
  useEffect(() => {
    if (!hasCompletedSetup || !envDone || envSectionCollapsedOnEnterRef.current) {
      return;
    }
    setIsEnvSectionOpen(false);
    envSectionCollapsedOnEnterRef.current = true;
  }, [envDone, hasCompletedSetup]);

  // Auto-enter configuration once VS Code is available when resuming an existing environment
  useEffect(() => {
    if (startAtConfigureEnvironment && instance?.vscodeUrl && !hasCompletedSetup) {
      setHasCompletedSetup(true);
    }
  }, [hasCompletedSetup, instance?.vscodeUrl, startAtConfigureEnvironment]);

  const handleEnterConfigureEnvironment = useCallback(() => {
    setHasCompletedSetup(true);
  }, []);

  const browserPlaceholder = useMemo(
    () =>
      resolvedVncUrl
        ? null
        : {
            title: instance?.instanceId
              ? "Waiting for browser"
              : "Browser preview unavailable",
            description: instance?.instanceId
              ? "We'll embed the browser session as soon as the environment exposes it."
              : "Launch the workspace so the browser agent can stream the preview here.",
          },
    [instance?.instanceId, resolvedVncUrl]
  );

  const provisionVM = useCallback(async () => {
    if (!resolvedTeamSlugOrId) {
      setErrorMessage("Select a team to start provisioning.");
      return;
    }

    setIsProvisioning(true);
    setErrorMessage(null);

    try {
      const response = await fetch("/api/sandboxes/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId: resolvedTeamSlugOrId,
          repoUrl: `https://github.com/${repo}`,
          branch: "main",
          ttlSeconds: 3600,
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const data = (await response.json()) as SandboxInstance;
      const normalizedFromResponse =
        data.vncUrl && data.vncUrl.trim().length > 0
          ? normalizeVncUrl(data.vncUrl) ?? data.vncUrl
          : null;
      const derived = normalizedFromResponse ?? deriveVncUrl(data.instanceId, data.vscodeUrl);

      if (selectedTeamSlugOrIdRef.current !== resolvedTeamSlugOrId) {
        return;
      }

      setInstance({
        ...data,
        vncUrl: derived ?? undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to provision workspace";
      if (selectedTeamSlugOrIdRef.current === resolvedTeamSlugOrId) {
        setErrorMessage(message);
      }
      console.error("Failed to provision workspace:", error);
    } finally {
      setIsProvisioning(false);
    }
  }, [repo, resolvedTeamSlugOrId]);

  useEffect(() => {
    if (!resolvedTeamSlugOrId) {
      return;
    }
    if (!instance && !isProvisioning && !errorMessage) {
      void provisionVM();
    }
  }, [instance, isProvisioning, errorMessage, provisionVM, resolvedTeamSlugOrId]);

  useEffect(() => {
    if (pendingFocusIndex !== null) {
      const el = keyInputRefs.current[pendingFocusIndex];
      if (el) {
        setTimeout(() => {
          el.focus();
          try {
            el.scrollIntoView({ block: "nearest" });
          } catch (_e) {
            void 0;
          }
        }, 0);
        setPendingFocusIndex(null);
      }
    }
  }, [pendingFocusIndex, envVars]);

  // Auto-apply env vars to sandbox
  useEffect(() => {
    if (!instance?.instanceId || !resolvedTeamSlugOrId) {
      return;
    }

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ name: r.name, value: r.value }))
    );

    if (envVarsContent.length === 0 && lastSubmittedEnvContent.current === null) {
      return;
    }

    if (envVarsContent === lastSubmittedEnvContent.current) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        await fetch(`/api/sandboxes/${instance.instanceId}/env`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamSlugOrId: resolvedTeamSlugOrId, envVarsContent }),
        });
        lastSubmittedEnvContent.current = envVarsContent;
      } catch (error) {
        console.error("Failed to apply sandbox environment vars", error);
      }
    }, 400);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [envVars, instance?.instanceId, resolvedTeamSlugOrId]);

  const updateEnvVars = useCallback((updater: (prev: EnvVar[]) => EnvVar[]) => {
    setEnvVars((prev) => updater(prev));
  }, []);

  const handleFrameworkPresetChange = useCallback((preset: FrameworkPreset) => {
    setFrameworkPreset(preset);
    setIsFrameworkMenuOpen(false);
    // Only auto-fill if user hasn't manually edited the scripts
    if (!hasUserEditedScripts) {
      const presetConfig = FRAMEWORK_PRESETS[preset];
      setMaintenanceScript(presetConfig.maintenanceScript);
      setDevScript(presetConfig.devScript);
      // Update none states based on whether the preset has scripts
      setMaintenanceNone(presetConfig.maintenanceScript.trim().length === 0);
      setDevNone(presetConfig.devScript.trim().length === 0);
    }
  }, [hasUserEditedScripts]);

  const handleMaintenanceScriptChange = useCallback((value: string) => {
    setMaintenanceNone(false);
    setMaintenanceScript(value);
    setHasUserEditedScripts(true);
  }, []);

  const handleDevScriptChange = useCallback((value: string) => {
    setDevNone(false);
    setDevScript(value);
    setHasUserEditedScripts(true);
  }, []);

  const handleToggleEnvNone = useCallback(
    (value: boolean) => {
      setEnvNone(value);
      setActiveEnvValueIndex(null);
      if (value) {
        setAreEnvValuesHidden(true);
        setEnvVars([{ name: "", value: "", isSecret: true }]);
        setIsEnvOpen(false);
      } else {
        setIsEnvOpen(true);
      }
    },
    []
  );

  const handleToggleMaintenanceNone = useCallback((value: boolean) => {
    setMaintenanceNone(value);
    setHasUserEditedScripts(true);
    if (value) {
      setMaintenanceScript("");
    }
  }, []);

  const handleToggleDevNone = useCallback((value: boolean) => {
    setDevNone(value);
    setHasUserEditedScripts(true);
    if (value) {
      setDevScript("");
    }
  }, []);

  const handleCopyCommands = useCallback(async () => {
    const combined = [maintenanceScript.trim(), devScript.trim()].filter(Boolean).join(" && ");
    if (!combined) {
      return;
    }

    try {
      await navigator.clipboard.writeText(combined);
      setCommandsCopied(true);
      if (copyResetTimeoutRef.current !== null) {
        window.clearTimeout(copyResetTimeoutRef.current);
      }
      copyResetTimeoutRef.current = window.setTimeout(() => {
        setCommandsCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Failed to copy commands:", error);
    }
  }, [devScript, maintenanceScript]);

  useEffect(() => {
    setRunConfirmed(false);
  }, [maintenanceScriptValue, devScriptValue, maintenanceNone, devNone]);

  const handleSaveConfiguration = async () => {
    if (!resolvedTeamSlugOrId) {
      setErrorMessage("Select a team before saving.");
      return;
    }

    if (!instance?.instanceId) {
      console.error("Missing instanceId for configuration save");
      return;
    }

    const now = new Date();
    const dateTime = now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const repoName = repo.split("/").pop() || "preview";
    const envName = `${repoName}-${dateTime}`;

    const envVarsContent = formatEnvVarsContent(
      envVars
        .filter((r) => r.name.trim().length > 0)
        .map((r) => ({ name: r.name, value: r.value }))
    );

    const normalizedMaintenanceScript = maintenanceScript.trim();
    const normalizedDevScript = devScript.trim();
    const requestMaintenanceScript =
      normalizedMaintenanceScript.length > 0 ? normalizedMaintenanceScript : undefined;
    const requestDevScript =
      normalizedDevScript.length > 0 ? normalizedDevScript : undefined;

    setIsSaving(true);
    setErrorMessage(null);

    try {
      const envResponse = await fetch("/api/environments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId: resolvedTeamSlugOrId,
          name: envName,
          morphInstanceId: instance.instanceId,
          envVarsContent,
          selectedRepos: [repo],
          maintenanceScript: requestMaintenanceScript,
          devScript: requestDevScript,
          exposedPorts: undefined,
          description: undefined,
        }),
      });

      if (!envResponse.ok) {
        throw new Error(await envResponse.text());
      }

      const envData = await envResponse.json();
      const environmentId = envData.id;

      const previewResponse = await fetch("/api/preview/configs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamSlugOrId: resolvedTeamSlugOrId,
          repoFullName: repo,
          environmentId,
          repoInstallationId: _installationId ? Number(_installationId) : undefined,
          repoDefaultBranch: "main",
          status: "active",
        }),
      });

      if (!previewResponse.ok) {
        throw new Error(await previewResponse.text());
      }

      window.location.href = "/preview";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save configuration";
      setErrorMessage(message);
      console.error("Failed to save preview configuration:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleNextStep = () => {
    if (currentStep === 1) {
      setIsEnvOpen(false);
      setIsBuildOpen(false);
    }
    if (currentStep < 2) {
      setCurrentStep((currentStep + 1) as WizardStep);
    }
  };

  const handlePrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as WizardStep);
    }
  };

  // Pre-create iframes during setup so they're ready when user clicks Next
  useEffect(() => {
    if (!instance || !persistentIframeManager) return;

    // Pre-create VS Code iframe during setup
    if (instance.vscodeUrl) {
      const vscodeUrl = new URL(instance.vscodeUrl);
      vscodeUrl.searchParams.set("folder", "/root/workspace");
      persistentIframeManager.getOrCreateIframe(vscodePersistKey, vscodeUrl.toString());
    }

    // Pre-create browser iframe if available
    if (resolvedVncUrl) {
      persistentIframeManager.getOrCreateIframe(browserPersistKey, resolvedVncUrl);
    }
  }, [instance, persistentIframeManager, resolvedVncUrl, vscodePersistKey, browserPersistKey]);

  // Mount iframes to their targets when visible
  useLayoutEffect(() => {
    if (!instance || !persistentIframeManager || !hasCompletedSetup) return;

    const cleanupFunctions: Array<() => void> = [];

    if (instance.vscodeUrl && currentStep === 1) {
      const target = document.querySelector(
        `[data-iframe-target="${vscodePersistKey}"]`,
      ) as HTMLElement | null;
      if (target) {
        cleanupFunctions.push(persistentIframeManager.mountIframe(vscodePersistKey, target));
      }
    }

    if (resolvedVncUrl && currentStep === 2) {
      const target = document.querySelector(
        `[data-iframe-target="${browserPersistKey}"]`,
      ) as HTMLElement | null;
      if (target) {
        cleanupFunctions.push(
          persistentIframeManager.mountIframe(browserPersistKey, target, {
            backgroundColor: "#000000",
          }),
        );
      }
    }

    return () => {
      cleanupFunctions.forEach((fn) => fn());
    };
  }, [
    browserPersistKey,
    instance,
    persistentIframeManager,
    currentStep,
    hasCompletedSetup,
    resolvedVncUrl,
    vscodePersistKey,
  ]);

  // Control iframe visibility based on current step and setup state
  useEffect(() => {
    if (!persistentIframeManager) {
      return;
    }

    // Hide iframes during setup screen, show based on step after setup
    const workspaceVisible = hasCompletedSetup && currentStep === 1 && Boolean(instance?.vscodeUrl);
    const browserVisible = hasCompletedSetup && currentStep === 2 && Boolean(resolvedVncUrl);

    persistentIframeManager.setVisibility(vscodePersistKey, workspaceVisible);
    persistentIframeManager.setVisibility(browserPersistKey, browserVisible);
  }, [
    browserPersistKey,
    currentStep,
    hasCompletedSetup,
    persistentIframeManager,
    resolvedVncUrl,
    instance?.vscodeUrl,
    vscodePersistKey,
  ]);

  if (errorMessage && !instance) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#05050a] text-white">
        <div className="text-center max-w-md px-6">
          <h1 className="text-2xl font-bold text-red-400">Error</h1>
          <p className="mt-2 text-neutral-400">{errorMessage}</p>
          <button
            type="button"
            onClick={() => {
              setErrorMessage(null);
              void provisionVM();
            }}
            className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-neutral-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Show setup screen while provisioning OR until user clicks Next
  if (!hasCompletedSetup) {
    const isWorkspaceReady = Boolean(instance?.vscodeUrl);

    // When editing an existing environment, show loader until VS Code is ready
    if (startAtConfigureEnvironment && !isWorkspaceReady) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-white dark:bg-black font-mono">
          <div className="text-center px-6">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-neutral-400" />
            <h1 className="mt-4 text-lg font-medium text-neutral-900 dark:text-neutral-100">
              Resuming your VS Code workspace...
            </h1>
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
              We&apos;ll show the configuration form once your environment is ready.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-dvh bg-white dark:bg-black font-mono">
        {/* Main Content */}
        <div className="max-w-2xl mx-auto px-6 py-10">
          <div className="mb-3">
            <Link
              href="/preview"
              className="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              <ArrowLeft className="h-3 w-3" />
              Go to preview.new
            </Link>
          </div>

          {/* Importing Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
              Configure Project
            </h1>
            <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <Github className="h-4 w-4" />
              <span className="font-mono">{repo}</span>
            </div>
          </div>

          <div className="space-y-6">
            {/* Framework Preset */}
            <div>
              <label className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2">
                Framework Preset
              </label>
              <div className="relative" ref={frameworkSelectRef}>
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={isFrameworkMenuOpen}
                  onClick={() => setIsFrameworkMenuOpen((prev) => !prev)}
                  className="flex w-full items-center justify-between rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700"
                >
                  <span className="flex items-center gap-3">
                    <FrameworkIconBubble preset={frameworkPreset} />
                    <span className="text-left">
                      <span className="block font-medium">{selectedFrameworkConfig.name}</span>
                      <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                        Autofills install and dev scripts
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    className={clsx(
                      "h-4 w-4 text-neutral-400 transition-transform",
                      isFrameworkMenuOpen && "rotate-180"
                    )}
                  />
                </button>
                {isFrameworkMenuOpen ? (
                  <div className="absolute z-20 mt-2 w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-lg">
                    <ul className="max-h-64 overflow-y-auto py-1" role="listbox">
                      {frameworkOptions.map(([key, config]) => (
                        <li key={key}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={frameworkPreset === key}
                            onClick={() => handleFrameworkPresetChange(key as FrameworkPreset)}
                            className={clsx(
                              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition",
                              frameworkPreset === key
                                ? "bg-neutral-100 dark:bg-neutral-900"
                                : "hover:bg-neutral-50 dark:hover:bg-neutral-900/80"
                            )}
                          >
                            <FrameworkIconBubble preset={key as FrameworkPreset} />
                            <div className="flex-1">
                              <div className="font-medium text-neutral-900 dark:text-neutral-100">
                                {config.name}
                              </div>
                              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                                Default: {config.devScript || "Custom"}
                              </div>
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                Workspace root <code className="rounded bg-neutral-100 px-1 py-0.5 text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200">/root/workspace</code> maps directly to your repository root.
              </p>
            </div>

            {/* Maintenance and Dev Scripts - Collapsible */}
            <details className="group" open={isBuildOpen} onToggle={(e) => setIsBuildOpen(e.currentTarget.open)}>
              <summary className="flex items-center gap-2 cursor-pointer text-base font-semibold text-neutral-900 dark:text-neutral-100 list-none">
                <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
                Maintenance and Dev Scripts
              </summary>
              <div className="mt-4 pl-6 space-y-4">
                <div>
                  <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
                    Maintenance Script
                  </label>
                  <textarea
                    value={maintenanceScript ?? ""}
                    onChange={(e) => handleMaintenanceScriptChange(e.target.value)}
                    placeholder={"npm install, bun install, pip install -r requirements.txt"}
                    rows={2}
                    className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
                  />
                  <p className="text-xs text-neutral-400 mt-1">Runs after git pull to install dependencies (e.g. npm install, bun install, pip install -r requirements.txt)</p>
                </div>
                <div>
                  <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1.5">
                    Dev Script
                  </label>
                  <textarea
                    value={devScript ?? ""}
                    onChange={(e) => handleDevScriptChange(e.target.value)}
                    placeholder={"npm run dev, bun dev, python manage.py runserver"}
                    rows={2}
                    className="w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 resize-none"
                  />
                  <p className="text-xs text-neutral-400 mt-1">Starts the development server (e.g. npm run dev, bun dev, python manage.py runserver)</p>
                </div>
            </div>
          </details>

            {/* Environment Variables - Collapsible */}
            <details className="group" open={isEnvOpen} onToggle={(e) => setIsEnvOpen(e.currentTarget.open)}>
              <summary className="flex items-center gap-2 cursor-pointer text-base font-semibold text-neutral-900 dark:text-neutral-100 list-none">
                <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
                <span>Environment Variables</span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setActiveEnvValueIndex(null);
                      setAreEnvValuesHidden((previous) => !previous);
                    }}
                    className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 transition p-0.5"
                    aria-label={areEnvValuesHidden ? "Reveal values" : "Hide values"}
                  >
                    {areEnvValuesHidden ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </summary>

              <div
                className="mt-4 space-y-2 pl-6"
                onPasteCapture={(e) => {
                  const text = e.clipboardData?.getData("text") ?? "";
                  if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
                    e.preventDefault();
                    const items = parseEnvBlock(text);
                    if (items.length > 0) {
                      setEnvNone(false);
                      updateEnvVars((prev) => {
                        const map = new Map(
                          prev
                            .filter((r) => r.name.trim().length > 0 || r.value.trim().length > 0)
                            .map((r) => [r.name, r] as const)
                        );
                        for (const it of items) {
                          if (!it.name) continue;
                          const existing = map.get(it.name);
                          if (existing) {
                            map.set(it.name, { ...existing, value: it.value });
                          } else {
                            map.set(it.name, { name: it.name, value: it.value, isSecret: true });
                          }
                        }
                        const next = Array.from(map.values());
                        next.push({ name: "", value: "", isSecret: true });
                        setPendingFocusIndex(next.length - 1);
                        return next;
                      });
                    }
                  }
                }}
              >
                <div
                  className="grid gap-2 text-xs text-neutral-500 dark:text-neutral-500 items-center pr-10"
                  style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px" }}
                >
                  <span>Name</span>
                  <span>Value</span>
                  <span />
                </div>

                {envVars.map((row, idx) => {
                  const rowKey = idx;
                  const isEditingValue = activeEnvValueIndex === idx;
                  const shouldMaskValue = areEnvValuesHidden && row.value.trim().length > 0 && !isEditingValue;
                  return (
                    <div
                      key={rowKey}
                      className="grid gap-2 items-center pr-10"
                    style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 40px" }}
                  >
                    <input
                      type="text"
                      value={row.name}
                      disabled={envNone}
                      ref={(el) => {
                        keyInputRefs.current[idx] = el;
                      }}
                      onChange={(e) => {
                        const v = e.target.value;
                          setEnvNone(false);
                          updateEnvVars((prev) => {
                            const next = [...prev];
                            const current = next[idx];
                            if (current) {
                              next[idx] = { ...current, name: v };
                            }
                          return next;
                        });
                      }}
                      placeholder="EXAMPLE_NAME"
                      className="w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <input
                      type={shouldMaskValue ? "password" : "text"}
                      value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                      disabled={envNone}
                      onChange={
                        shouldMaskValue
                          ? undefined
                          : (e) => {
                              const v = e.target.value;
                                setEnvNone(false);
                                updateEnvVars((prev) => {
                                  const next = [...prev];
                                  const current = next[idx];
                                  if (current) {
                                    next[idx] = { ...current, value: v };
                                  }
                                  return next;
                                });
                              }
                      }
                      onFocus={() => setActiveEnvValueIndex(idx)}
                      onBlur={() => setActiveEnvValueIndex((current) => (current === idx ? null : current))}
                      readOnly={shouldMaskValue}
                      placeholder="I9JU23NF394R6HH"
                      className="w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    />
                    <button
                      type="button"
                      disabled={envNone}
                      onClick={() => {
                        updateEnvVars((prev) => {
                          const next = prev.filter((_, i) => i !== idx);
                          return next.length > 0 ? next : [{ name: "", value: "", isSecret: true }];
                        });
                      }}
                      className="h-9 w-9 rounded-md border border-neutral-200 dark:border-neutral-800 text-neutral-500 dark:text-neutral-400 grid place-items-center hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-60 disabled:cursor-not-allowed"
                      aria-label="Remove variable"
                    >
                      <Minus className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() =>
                      updateEnvVars((prev) => [...prev, { name: "", value: "", isSecret: true }])
                    }
                    disabled={envNone}
                    className="inline-flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-4 h-4" /> Add Variable
                  </button>
                </div>
              </div>

              <p className="text-xs text-neutral-400 dark:text-neutral-400 pl-6 mt-2">
                Tip: Paste a .env file to auto-fill
              </p>
            </details>
          </div>

          {/* Next Button */}
          <div className="mt-10 pt-6 border-t border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
                {isProvisioning ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    <span>Provisioning workspace...</span>
                  </>
                ) : isWorkspaceReady ? (
                  <>
                    <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                    <span>Workspace ready</span>
                  </>
                ) : (
                  <>
                    <span className="inline-block h-2 w-2 rounded-full bg-neutral-400 dark:bg-neutral-600" />
                    <span>Waiting for workspace...</span>
                  </>
                )}
              </div>
              <button
                type="button"
                disabled={!isWorkspaceReady}
                onClick={handleEnterConfigureEnvironment}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-md px-5 py-2.5 text-sm font-semibold transition",
                  isWorkspaceReady
                    ? "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-800 dark:hover:bg-neutral-200"
                    : "bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 opacity-50 cursor-not-allowed"
                )}
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderStep1Content = () => (
    <div className="space-y-5">
      {/* Workspace Info */}
      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-relaxed">
        Your workspace root at <code className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-700 dark:text-neutral-300">/root/workspace</code> maps directly to your repo root.
      </p>

      {/* Maintenance Script */}
      <details className="group" open={isMaintenanceSectionOpen} onToggle={(e) => setIsMaintenanceSectionOpen(e.currentTarget.open)}>
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
          <StepBadge step={1} done={maintenanceDone} />
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Maintenance script</span>
        </summary>
        <div className="mt-3 ml-6 space-y-2">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Runs after git pull to install dependencies.
          </p>
          <textarea
            value={maintenanceScript ?? ""}
            onChange={(e) => handleMaintenanceScriptChange(e.target.value)}
            placeholder={"npm install, bun install, pip install -r requirements.txt"}
            disabled={maintenanceNone}
            rows={2}
            className="w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-[12px] font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed resize-none"
          />
          <div className="flex items-center justify-end">
            <label className="flex items-center gap-1.5 text-[10px] text-neutral-400 cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300">
              <input type="checkbox" checked={maintenanceNone} onChange={(e) => handleToggleMaintenanceNone(e.target.checked)} className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-emerald-500 focus:ring-2 focus:ring-emerald-500/40" />
              None
            </label>
          </div>
        </div>
      </details>

      {/* Dev Script */}
      <details className="group" open={isDevSectionOpen} onToggle={(e) => setIsDevSectionOpen(e.currentTarget.open)}>
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
          <StepBadge step={2} done={devDone} />
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Dev script</span>
        </summary>
        <div className="mt-3 ml-6 space-y-2">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Starts the development server.
          </p>
          <textarea
            value={devScript ?? ""}
            onChange={(e) => handleDevScriptChange(e.target.value)}
            placeholder={"npm run dev, bun dev, python manage.py runserver"}
            disabled={devNone}
            rows={2}
            className="w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-[12px] font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed resize-none"
          />
          <div className="flex items-center justify-end">
            <label className="flex items-center gap-1.5 text-[10px] text-neutral-400 cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300">
              <input type="checkbox" checked={devNone} onChange={(e) => handleToggleDevNone(e.target.checked)} className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-emerald-500 focus:ring-2 focus:ring-emerald-500/40" />
              None
            </label>
          </div>
        </div>
      </details>

      {/* Environment Variables */}
      <details className="group" open={isEnvSectionOpen} onToggle={(e) => setIsEnvSectionOpen(e.currentTarget.open)}>
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
          <StepBadge step={3} done={envDone} />
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Environment variables</span>
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setActiveEnvValueIndex(null); setAreEnvValuesHidden((prev) => !prev); }}
            className="ml-auto text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-0.5"
            aria-label={areEnvValuesHidden ? "Reveal values" : "Hide values"}
          >
            {areEnvValuesHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        </summary>
        <div
          className="mt-3 ml-6 space-y-2"
          onPasteCapture={(e) => {
            const text = e.clipboardData?.getData("text") ?? "";
            if (text && (/\n/.test(text) || /(=|:)\s*\S/.test(text))) {
              e.preventDefault();
              const items = parseEnvBlock(text);
              if (items.length > 0) {
                setEnvNone(false);
                updateEnvVars((prev) => {
                  const map = new Map(prev.filter((r) => r.name.trim().length > 0 || r.value.trim().length > 0).map((r) => [r.name, r] as const));
                  for (const it of items) {
                    if (!it.name) continue;
                    const existing = map.get(it.name);
                    if (existing) map.set(it.name, { ...existing, value: it.value });
                    else map.set(it.name, { name: it.name, value: it.value, isSecret: true });
                  }
                  const next = Array.from(map.values());
                  next.push({ name: "", value: "", isSecret: true });
                  setPendingFocusIndex(next.length - 1);
                  return next;
                });
              }
            }
          }}
        >
          <div className="grid gap-2 text-[10px] text-neutral-500 items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 28px" }}>
            <span>Key</span>
            <span>Value</span>
            <span />
          </div>
          {envVars.map((row, idx) => {
            const isEditingValue = activeEnvValueIndex === idx;
            const shouldMaskValue = areEnvValuesHidden && row.value.trim().length > 0 && !isEditingValue;
            return (
              <div key={idx} className="grid gap-2 items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr) 28px" }}>
                <input
                  type="text"
                  value={row.name}
                  disabled={envNone}
                  ref={(el) => { keyInputRefs.current[idx] = el; }}
                  onChange={(e) => { setEnvNone(false); updateEnvVars((prev) => { const next = [...prev]; if (next[idx]) next[idx] = { ...next[idx], name: e.target.value }; return next; }); }}
                  placeholder="EXAMPLE_NAME"
                  className="w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-[12px] font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <input
                  type="text"
                  value={shouldMaskValue ? MASKED_ENV_VALUE : row.value}
                  disabled={envNone}
                  onChange={shouldMaskValue ? undefined : (e) => { setEnvNone(false); updateEnvVars((prev) => { const next = [...prev]; if (next[idx]) next[idx] = { ...next[idx], value: e.target.value }; return next; }); }}
                  onFocus={() => setActiveEnvValueIndex(idx)}
                  onBlur={() => setActiveEnvValueIndex((current) => (current === idx ? null : current))}
                  readOnly={shouldMaskValue}
                  placeholder="I9JU23NF394R6HH"
                  className="w-full min-w-0 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5 py-1.5 text-[12px] font-mono text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700 disabled:opacity-60 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  disabled={envNone}
                  onClick={() => updateEnvVars((prev) => { const next = prev.filter((_, i) => i !== idx); return next.length > 0 ? next : [{ name: "", value: "", isSecret: true }]; })}
                  className="h-7 w-7 rounded border border-neutral-200 dark:border-neutral-800 text-neutral-400 grid place-items-center hover:border-neutral-300 dark:hover:border-neutral-700 hover:text-neutral-600 dark:hover:text-neutral-200 disabled:opacity-50"
                  aria-label="Remove"
                >
                  <Minus className="w-3 h-3" />
                </button>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={envNone}
              onClick={() => updateEnvVars((prev) => [...prev, { name: "", value: "", isSecret: true }])}
              className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 disabled:opacity-50"
            >
              <Plus className="w-3 h-3" /> Add
            </button>
            <label className="flex items-center gap-1.5 text-[10px] text-neutral-400 cursor-pointer hover:text-neutral-600 dark:hover:text-neutral-300">
              <input type="checkbox" checked={envNone} onChange={(e) => handleToggleEnvNone(e.target.checked)} className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-emerald-500 focus:ring-2 focus:ring-emerald-500/40" />
              None
            </label>
          </div>
          <p className="text-[10px] text-neutral-400">Tip: Paste .env to auto-fill</p>
        </div>
      </details>

      {/* Run Scripts */}
      <details className="group" open={isRunSectionOpen} onToggle={(e) => setIsRunSectionOpen(e.currentTarget.open)}>
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
          <StepBadge step={4} done={runConfirmed} />
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Run scripts in VS Code terminal</span>
        </summary>
        <div className="mt-3 ml-6 space-y-3">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Open terminal (<kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-sans">Ctrl+Shift+`</kbd> or <kbd className="px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-sans">Cmd+J</kbd>) and paste:
          </p>
          <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800/50">
                <span className="text-[10px] uppercase tracking-wide text-neutral-500">Commands</span>
                {(maintenanceScriptValue || devScriptValue) && (
                  <button type="button" onClick={handleCopyCommands} className={clsx("p-0.5", commandsCopied ? "text-emerald-500" : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300")}>
                    {commandsCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                )}
              </div>
              <pre className="px-3 py-2 text-[11px] font-mono text-neutral-900 dark:text-neutral-100 overflow-x-auto whitespace-pre-wrap break-all select-all">
                {(maintenanceScriptValue || devScriptValue)
                  ? [maintenanceScript.trim(), devScript.trim()].filter(Boolean).join(" && ")
                  : <span className="text-neutral-400 italic">Enter scripts above to see commands</span>}
              </pre>
            </div>
          <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300">
            <input type="checkbox" checked={runConfirmed} onChange={(e) => setRunConfirmed(e.target.checked)} className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-emerald-500 focus:ring-2 focus:ring-emerald-500/40" />
            Proceed once dev script is running
          </label>
        </div>
      </details>
    </div>
  );

  const renderStep2Content = () => (
    <div className="space-y-5">
      {/* Browser Setup Info */}
      <details className="group" open={isBrowserSetupSectionOpen} onToggle={(e) => setIsBrowserSetupSectionOpen(e.currentTarget.open)}>
        <summary className="flex items-center gap-2 cursor-pointer list-none">
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 transition-transform -rotate-90 group-open:rotate-0" />
          <StepBadge step={5} done={browserConfirmed} />
          <span className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100">Configure browser</span>
        </summary>
        <div className="mt-3 ml-6 space-y-3">
          <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
            Use the browser on the right to set up authentication:
          </p>
          <ul className="space-y-2 text-[11px] text-neutral-600 dark:text-neutral-400">
            <li className="flex items-start gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">1</span>
              <span>Sign in to any dashboards or SaaS tools</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">2</span>
              <span>Dismiss cookie banners, popups, or MFA prompts</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800 text-[10px] text-neutral-500 dark:text-neutral-400 flex-shrink-0 mt-0.5">3</span>
              <span>Navigate to your dev server URL (e.g., localhost:3000)</span>
            </li>
          </ul>
          <label className="flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-neutral-400 cursor-pointer hover:text-neutral-700 dark:hover:text-neutral-300 pt-1">
            <input type="checkbox" checked={browserConfirmed} onChange={(e) => setBrowserConfirmed(e.target.checked)} className="h-3.5 w-3.5 rounded border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-emerald-500 focus:ring-2 focus:ring-emerald-500/40" />
            Browser is set up properly
          </label>
        </div>
      </details>

      {/* Note about terminal */}
      <div className="rounded-md border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 px-3 py-2.5">
        <p className="text-[11px] text-amber-800 dark:text-amber-200">
          <strong>Note:</strong> Running terminals will be stopped on save. The maintenance and dev scripts run automatically on each preview.
        </p>
      </div>
    </div>
  );

  const renderPreviewPanel = () => {
    const isVscodeStep = currentStep === 1;
    const placeholder = isVscodeStep ? workspacePlaceholder : browserPlaceholder;
    const iframeKey = isVscodeStep ? vscodePersistKey : browserPersistKey;

    return (
      <div className="h-full flex flex-col overflow-hidden relative">
        {placeholder ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-4 text-center text-neutral-500 dark:text-neutral-400">
            <div className="text-sm font-medium text-neutral-600 dark:text-neutral-200">
              {placeholder.title}
            </div>
            {placeholder.description ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {placeholder.description}
              </p>
            ) : null}
          </div>
        ) : null}
        <div
          className={clsx(
            "absolute inset-0",
            placeholder ? "opacity-0" : "opacity-100"
          )}
          data-iframe-target={iframeKey}
        />
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-50 dark:bg-neutral-950 font-mono text-[15px] leading-6">
      {/* Left: Configuration Form */}
      <div className="w-[420px] flex flex-col overflow-hidden border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-black">
        <div className="flex-shrink-0 px-5 pt-4 pb-2">
          <Link
            href="/preview"
            className="inline-flex items-center gap-1 text-[11px] text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 mb-3"
          >
            <ArrowLeft className="h-3 w-3" />
            Go to preview.new
          </Link>
          <h1 className="text-base font-semibold text-neutral-900 dark:text-neutral-100 tracking-tight">
            Configure environment
          </h1>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {currentStep === 1 ? renderStep1Content() : renderStep2Content()}
        </div>

        <div className="flex-shrink-0 border-t border-neutral-200 dark:border-neutral-800 p-6 bg-white dark:bg-black">
          {errorMessage && (
            <div className="rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/50 p-3 mb-4">
              <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={handlePrevStep}
                className="inline-flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 px-4 py-2 text-sm font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            ) : (
              <div />
            )}

            {currentStep < 2 ? (
              <button
                type="button"
                onClick={handleNextStep}
                className="inline-flex items-center gap-2 rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition"
              >
                Next
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSaveConfiguration}
                disabled={isSaving}
                className="inline-flex items-center justify-center rounded-md bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 px-4 py-2 text-sm font-semibold hover:bg-neutral-800 dark:hover:bg-neutral-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  "Save configuration"
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Right: Preview Panel */}
      <div className="flex-1 flex flex-col bg-neutral-950 overflow-hidden">
        {renderPreviewPanel()}
      </div>
    </div>
  );
}
