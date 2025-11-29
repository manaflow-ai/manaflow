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
  | "astro"
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
  | "astro"
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
  astro: { name: "Astro", maintenanceScript: "npm install", devScript: "npm run dev", icon: "astro" },
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
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M18.665 21.978C16.758 23.255 14.465 24 12 24 5.377 24 0 18.623 0 12S5.377 0 12 0s12 5.377 12 12c0 3.583-1.574 6.801-4.067 9.001L9.219 7.2H7.2v9.596h1.615V9.251l9.85 12.727Zm-3.332-8.533 1.6 2.061V7.2h-1.6v6.245Z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-neutral-900",
    textClass: "text-white",
  },
  vite: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="m8.286 10.578.512-8.657a.306.306 0 0 1 .247-.282L17.377.006a.306.306 0 0 1 .353.385l-1.558 5.403a.306.306 0 0 0 .352.385l2.388-.46a.306.306 0 0 1 .332.438l-6.79 13.55-.123.19a.294.294 0 0 1-.252.14c-.177 0-.35-.152-.305-.369l1.095-5.301a.306.306 0 0 0-.388-.355l-1.433.435a.306.306 0 0 1-.389-.354l.69-3.375a.306.306 0 0 0-.37-.36l-2.32.536a.306.306 0 0 1-.374-.316zm14.976-7.926L17.284 3.74l-.544 1.887 2.077-.4a.8.8 0 0 1 .84.369.8.8 0 0 1 .034.783L12.9 19.93l-.013.025-.015.023-.122.19a.801.801 0 0 1-.672.37.826.826 0 0 1-.634-.302.8.8 0 0 1-.16-.67l1.029-4.981-1.12.34a.81.81 0 0 1-.86-.262.802.802 0 0 1-.165-.67l.63-3.08-2.027.468a.808.808 0 0 1-.768-.233.81.81 0 0 1-.217-.6l.389-6.57-7.44-1.33a.612.612 0 0 0-.64.906L11.58 23.691a.612.612 0 0 0 1.066-.004l11.26-20.135a.612.612 0 0 0-.644-.9z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-gradient-to-br from-indigo-500 via-purple-500 to-amber-400",
    textClass: "text-white",
  },
  remix: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M21.511 18.508c.216 2.773.216 4.073.216 5.492H15.31c0-.309.006-.592.011-.878.018-.892.036-1.821-.109-3.698-.19-2.747-1.374-3.358-3.55-3.358H1.574v-5h10.396c2.748 0 4.122-.835 4.122-3.049 0-1.946-1.374-3.125-4.122-3.125H1.573V0h11.541c6.221 0 9.313 2.938 9.313 7.632 0 3.511-2.176 5.8-5.114 6.182 2.48.497 3.93 1.909 4.198 4.694ZM1.573 24v-3.727h6.784c1.133 0 1.379.84 1.379 1.342V24Z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-neutral-800",
    textClass: "text-white",
  },
  nuxt: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="m2.5 17.75 5.25-9.5 4.3 7.5 2.95-5.5 6.5 11.5h-3.2l-3.3-5.8-2.8 5.8-4.3-7.5-3.35 6H2.5Z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-emerald-600",
    textClass: "text-white",
  },
  astro: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M8.358 20.162c-1.186-1.07-1.532-3.316-1.038-4.944.856 1.026 2.043 1.352 3.272 1.535 1.897.283 3.76.177 5.522-.678.202-.098.388-.229.608-.36.166.473.209.95.151 1.437-.14 1.185-.738 2.1-1.688 2.794-.38.277-.782.525-1.175.787-1.205.804-1.531 1.747-1.078 3.119l.044.148a3.158 3.158 0 0 1-1.407-1.188 3.31 3.31 0 0 1-.544-1.815c-.004-.32-.004-.642-.048-.958-.106-.769-.472-1.113-1.161-1.133-.707-.02-1.267.411-1.415 1.09-.012.053-.028.104-.045.165h.002zm-5.961-4.445s3.24-1.575 6.49-1.575l2.451-7.565c.092-.366.36-.614.662-.614.302 0 .57.248.662.614l2.45 7.565c3.85 0 6.491 1.575 6.491 1.575L16.088.727C15.93.285 15.663 0 15.303 0H8.697c-.36 0-.615.285-.784.727l-5.516 14.99z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-neutral-900",
    textClass: "text-white",
  },
  svelte: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M10.354 21.125a4.44 4.44 0 0 1-4.765-1.767 4.109 4.109 0 0 1-.703-3.107 3.898 3.898 0 0 1 .134-.522l.105-.321.287.21a7.21 7.21 0 0 0 2.186 1.092l.208.063-.02.208a1.253 1.253 0 0 0 .226.83 1.337 1.337 0 0 0 1.435.533 1.231 1.231 0 0 0 .343-.15l5.59-3.562a1.164 1.164 0 0 0 .524-.778 1.242 1.242 0 0 0-.211-.937 1.338 1.338 0 0 0-1.435-.533 1.23 1.23 0 0 0-.343.15l-2.133 1.36a4.078 4.078 0 0 1-1.135.499 4.44 4.44 0 0 1-4.765-1.766 4.108 4.108 0 0 1-.702-3.108 3.855 3.855 0 0 1 1.742-2.582l5.589-3.563a4.072 4.072 0 0 1 1.135-.499 4.44 4.44 0 0 1 4.765 1.767 4.109 4.109 0 0 1 .703 3.107 3.943 3.943 0 0 1-.134.522l-.105.321-.286-.21a7.204 7.204 0 0 0-2.187-1.093l-.208-.063.02-.207a1.255 1.255 0 0 0-.226-.831 1.337 1.337 0 0 0-1.435-.532 1.231 1.231 0 0 0-.343.15L8.62 9.368a1.162 1.162 0 0 0-.524.778 1.24 1.24 0 0 0 .211.937 1.338 1.338 0 0 0 1.435.533 1.235 1.235 0 0 0 .344-.151l2.132-1.36a4.067 4.067 0 0 1 1.135-.498 4.44 4.44 0 0 1 4.765 1.766 4.108 4.108 0 0 1 .702 3.108 3.857 3.857 0 0 1-1.742 2.583l-5.589 3.562a4.072 4.072 0 0 1-1.135.499m10.358-17.95C18.484-.015 14.082-.96 10.9 1.068L5.31 4.63a6.412 6.412 0 0 0-2.896 4.295 6.753 6.753 0 0 0 .666 4.336 6.43 6.43 0 0 0-.96 2.396 6.833 6.833 0 0 0 1.168 5.167c2.229 3.19 6.63 4.135 9.812 2.108l5.59-3.562a6.41 6.41 0 0 0 2.896-4.295 6.756 6.756 0 0 0-.665-4.336 6.429 6.429 0 0 0 .958-2.396 6.831 6.831 0 0 0-1.167-5.168Z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-orange-500",
    textClass: "text-white",
  },
  angular: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M11.985 0 2.1 3.65l1.5 13.05 8.385 4.8 8.4-4.8 1.5-13.05L11.985 0Zm0 3.45 5.1 1.8-.6 6.6h-2.1l.3-3.15-2.7 1.05-2.7-1.05.3 3.15h-2.1l-.6-6.6 5.1-1.8Zm0 8.55 2.85 1.05-.9 4.35-1.95 1.05-1.95-1.05-.9-4.35Z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-red-600",
    textClass: "text-white",
  },
  react: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0-6.2c1.35 0 2.53.27 3.16.7.6.4.77.86.47 1.5-.24.53-.73 1.16-1.37 1.82.32.34.62.7.9 1.07 1.13-.35 2.21-.54 3.07-.54 1.35 0 2.53.27 3.16.7.6.4.77.86.47 1.5-.52 1.15-1.95 2.63-3.81 3.92.13.53.23 1.06.3 1.6 1.21.26 2.33.68 3.04 1.18.6.4.77.86.47 1.5-.24.53-.73 1.16-1.37 1.82-.64.66-1.35 1.25-2.08 1.77-.73.52-1.48.96-2.2 1.3-.73.35-1.42.6-2.02.73-.6.14-1.12.15-1.5 0-.38.15-.9.14-1.5 0-.6-.14-1.29-.38-2.02-.73-.72-.34-1.47-.78-2.2-1.3a16.3 16.3 0 0 1-2.08-1.77c-.64-.66-1.13-1.29-1.37-1.82-.3-.64-.13-1.1.47-1.5.71-.5 1.83-.92 3.04-1.18.07-.54.17-1.07.3-1.6-1.86-1.29-3.29-2.77-3.81-3.92-.3-.64-.13-1.1.47-1.5.63-.43 1.8-.7 3.16-.7.86 0 1.94.2 3.07.54.28-.37.58-.73.9-1.07-.64-.66-1.13-1.29-1.37-1.82-.3-.64-.13-1.1.47-1.5C9.47 3.27 10.65 3 12 3Zm0 1c-1.15 0-2.18.2-2.75.58-.26.17-.28.28-.16.55.17.37.57.88 1.13 1.46.2.2.42.43.64.67-.46.52-.87 1.06-1.24 1.62-1.3-.4-2.5-.63-3.38-.63-1.15 0-2.18.2-2.75.58-.26.17-.28.28-.16.55.37.82 1.57 2.08 3.47 3.36l.35.24c-.16.66-.27 1.33-.33 2.01-1.17.26-2.26.66-2.97 1.15-.26.18-.28.3-.16.56.17.38.57.88 1.13 1.46.56.58 1.19 1.12 1.87 1.6.68.48 1.37.9 2.04 1.22.68.32 1.31.54 1.82.66.5.12.85.12 1 .06l.18-.06c.15.06.5.06 1-.06.51-.12 1.14-.34 1.82-.66.67-.32 1.36-.74 2.04-1.22.68-.48 1.31-1.02 1.87-1.6.56-.58.96-1.08 1.13-1.46.12-.26.1-.38-.16-.56-.71-.49-1.8-.89-2.97-1.15a12.5 12.5 0 0 0-.33-2.01l.35-.24c1.9-1.28 3.1-2.54 3.47-3.36.12-.27.1-.38-.16-.56-.57-.38-1.6-.58-2.75-.58-.88 0-2.08.23-3.38.63a13 13 0 0 0-1.24-1.62 17 17 0 0 0 .64-.67c.56-.58.96-1.09 1.13-1.46.12-.27.1-.38-.16-.56-.57-.38-1.6-.58-2.75-.58Z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-sky-100",
    textClass: "text-sky-700",
  },
  vue: {
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
        <path
          d="M12 3.1 9.07 8.2 6.14 3.1H0l12 20.9L24 3.1h-6.14L14.93 8.2 12 3.1Z"
          fill="currentColor"
        />
      </svg>
    ),
    bgClass: "bg-emerald-600",
    textClass: "text-white",
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
