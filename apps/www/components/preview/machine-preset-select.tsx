"use client";

import {
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotPresetWithLatest,
} from "@cmux/shared";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ChevronDown, Check, Cpu } from "lucide-react";
import { forwardRef } from "react";
import clsx from "clsx";

export type MachinePresetId = MorphSnapshotPresetWithLatest["id"];

type MachinePresetSelectProps = {
  value: MachinePresetId;
  onValueChange: (value: MachinePresetId) => void;
};

const SelectTrigger = forwardRef<
  HTMLButtonElement,
  SelectPrimitive.SelectTriggerProps & { preset: MorphSnapshotPresetWithLatest }
>(({ className, preset, ...props }, ref) => {
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
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800"
          aria-hidden="true"
        >
          <Cpu className="h-4 w-4 text-neutral-700 dark:text-neutral-100" />
        </span>
        <span className="text-left">
          <span className="block font-medium">{preset.label}</span>
          <span className="block text-xs text-neutral-500 dark:text-neutral-400">
            {preset.cpu} &middot; {preset.memory}
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
  SelectPrimitive.SelectItemProps & { preset: MorphSnapshotPresetWithLatest }
>(({ className, preset, ...props }, ref) => {
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
      <span
        className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-800"
        aria-hidden="true"
      >
        <Cpu className="h-4 w-4 text-neutral-700 dark:text-neutral-100" />
      </span>
      <div className="flex-1">
        <div className="font-medium text-neutral-900 dark:text-neutral-100">
          {preset.label}
        </div>
        <div className="text-xs text-neutral-500 dark:text-neutral-400">
          {preset.cpu} &middot; {preset.memory} &middot; {preset.disk}
        </div>
        {preset.description && (
          <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-0.5">
            {preset.description}
          </div>
        )}
      </div>
      <SelectPrimitive.ItemIndicator className="absolute right-3">
        <Check className="h-4 w-4 text-neutral-900 dark:text-neutral-100" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = "SelectItem";

// Only show 4vCPU (Standard) and 8vCPU (Performance) options
const ALLOWED_PRESET_IDS = ["4vcpu_16gb_48gb", "8vcpu_32gb_48gb"];
const FILTERED_PRESETS = MORPH_SNAPSHOT_PRESETS.filter((p) =>
  ALLOWED_PRESET_IDS.includes(p.presetId)
);

export function MachinePresetSelect({
  value,
  onValueChange,
}: MachinePresetSelectProps) {
  const selectedPreset = FILTERED_PRESETS.find((p) => p.id === value);
  const fallbackPreset = FILTERED_PRESETS[0];

  if (!selectedPreset && !fallbackPreset) {
    return null;
  }

  const currentPreset = selectedPreset ?? fallbackPreset;

  return (
    <div>
      <label
        id="machine-preset-label"
        className="block text-sm font-medium text-neutral-900 dark:text-neutral-100 mb-2"
      >
        Machine Size
      </label>
      <SelectPrimitive.Root
        value={value}
        onValueChange={(val) => onValueChange(val as MachinePresetId)}
      >
        <SelectTrigger
          preset={currentPreset}
          aria-labelledby="machine-preset-label"
        />
        <SelectContent>
          {FILTERED_PRESETS.map((preset) => (
            <SelectItem key={preset.id} value={preset.id} preset={preset}>
              {preset.label}
            </SelectItem>
          ))}
        </SelectContent>
      </SelectPrimitive.Root>
    </div>
  );
}
