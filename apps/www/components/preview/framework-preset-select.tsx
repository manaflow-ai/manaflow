"use client";

import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, Check, Sparkles } from "lucide-react";
import { forwardRef, type ReactNode } from "react";
import clsx from "clsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AngularLogo,
  NextLogo,
  NuxtLogo,
  ReactLogo,
  RemixLogo,
  SvelteLogo,
  ViteLogo,
  VueLogo,
} from "@/components/icons/framework-logos";

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

export const FRAMEWORK_PRESETS: Record<FrameworkPreset, FrameworkPresetConfig> =
  {
    other: {
      name: "Other",
      maintenanceScript: "",
      devScript: "",
      icon: "other",
    },
    next: {
      name: "Next.js",
      maintenanceScript: "npm install",
      devScript: "npm run dev",
      icon: "next",
    },
    vite: {
      name: "Vite",
      maintenanceScript: "npm install",
      devScript: "npm run dev",
      icon: "vite",
    },
    remix: {
      name: "Remix",
      maintenanceScript: "npm install",
      devScript: "npm run dev",
      icon: "remix",
    },
    nuxt: {
      name: "Nuxt",
      maintenanceScript: "npm install",
      devScript: "npm run dev",
      icon: "nuxt",
    },
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
    icon: <NextLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  vite: {
    icon: <ViteLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  remix: {
    icon: <RemixLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  nuxt: {
    icon: <NuxtLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  svelte: {
    icon: <SvelteLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  angular: {
    icon: <AngularLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  react: {
    icon: <ReactLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
  vue: {
    icon: <VueLogo className="h-5 w-5" aria-hidden="true" />,
    bgClass: "bg-neutral-100 dark:bg-neutral-800",
    textClass: "",
  },
};

function FrameworkIconBubble({ preset }: { preset: FrameworkPreset }) {
  const meta =
    FRAMEWORK_ICON_META[FRAMEWORK_PRESETS[preset].icon] ??
    FRAMEWORK_ICON_META.other;
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

type FrameworkPresetSelectProps = {
  value: FrameworkPreset;
  onValueChange: (value: FrameworkPreset) => void;
};

const SelectTrigger = forwardRef<
  HTMLButtonElement,
  SelectPrimitive.SelectTriggerProps & { preset: FrameworkPreset }
>(({ className, preset, ...props }, ref) => {
  const config = FRAMEWORK_PRESETS[preset];
  return (
    <SelectPrimitive.Trigger
      ref={ref}
      className={clsx(
        "flex w-full items-center justify-between rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 font-sans",
        "focus:outline-none focus:ring-2 focus:ring-neutral-300 dark:focus:ring-neutral-700",
        "data-[placeholder]:text-neutral-400",
        className
      )}
      {...props}
    >
      <span className="flex items-center gap-3">
        <FrameworkIconBubble preset={preset} />
        <span className="text-left">
          <span className="block font-medium">{config.name}</span>
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
            Autofills install and dev scripts
          </span>
        </span>
      </span>
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="h-4 w-4 text-neutral-400 transition-transform data-[state=open]:rotate-180" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});
SelectTrigger.displayName = "SelectTrigger";

const SelectContent = forwardRef<
  HTMLDivElement,
  SelectPrimitive.SelectContentProps
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      className={clsx(
        "z-50 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-lg font-sans",
        "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
        "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
        "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      position="popper"
      sideOffset={8}
      {...props}
    >
      <SelectPrimitive.Viewport className="max-h-64 overflow-y-auto">
        {children}
      </SelectPrimitive.Viewport>
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

const SelectItem = forwardRef<
  HTMLDivElement,
  SelectPrimitive.SelectItemProps & { preset: FrameworkPreset }
>(({ className, preset, ...props }, ref) => {
  const config = FRAMEWORK_PRESETS[preset];
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={clsx(
        "relative flex w-full cursor-pointer select-none items-center gap-3 px-3 py-2 text-left text-sm outline-none transition",
        "focus:bg-neutral-100 dark:focus:bg-neutral-900",
        "data-[state=checked]:bg-neutral-100 dark:data-[state=checked]:bg-neutral-900",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <FrameworkIconBubble preset={preset} />
      <div className="flex-1">
        <div className="font-medium text-neutral-900 dark:text-neutral-100">
          {config.name}
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          Default: {config.devScript || "Custom"}
        </div>
      </div>
      <SelectPrimitive.ItemIndicator className="absolute right-3">
        <Check className="h-4 w-4 text-neutral-900 dark:text-neutral-100" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = "SelectItem";

export function FrameworkPresetSelect({
  value,
  onValueChange,
}: FrameworkPresetSelectProps) {
  const frameworkOptions = Object.keys(FRAMEWORK_PRESETS) as FrameworkPreset[];

  return (
    <div>
      <label
        id="framework-preset-label"
        className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2"
      >
        Framework Preset
      </label>
      <SelectPrimitive.Root
        value={value}
        onValueChange={(val) => onValueChange(val as FrameworkPreset)}
      >
        <SelectTrigger
          preset={value}
          aria-labelledby="framework-preset-label"
        />
        <SelectContent>
          {frameworkOptions.map((preset) => (
            <SelectItem key={preset} value={preset} preset={preset}>
              {FRAMEWORK_PRESETS[preset].name}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectPrimitive.Root>
      <TooltipProvider>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Workspace root{" "}
          <Tooltip>
            <TooltipTrigger asChild>
              <code
                className="rounded bg-neutral-100 px-1 py-0.5 text-[11px] text-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 cursor-help"
                tabIndex={0}
                role="button"
                aria-describedby="workspace-root-desc"
              >
                /root/workspace
              </code>
            </TooltipTrigger>
            <TooltipContent side="top" id="workspace-root-desc">
              This is the absolute path inside the sandbox environment
            </TooltipContent>
          </Tooltip>{" "}
          maps directly to your repository root.
        </p>
      </TooltipProvider>
    </div>
  );
}
