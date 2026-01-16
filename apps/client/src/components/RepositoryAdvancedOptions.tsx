import {
  DEFAULT_MORPH_SNAPSHOT_ID,
  MORPH_SNAPSHOT_PRESETS,
  type MorphSnapshotId,
} from "@cmux/shared";
import { Accordion, AccordionItem } from "@heroui/react";
import { Check } from "lucide-react";
import { Label, Radio, RadioGroup } from "react-aria-components";

// Only show 4vCPU (Standard) and 8vCPU (Performance) options
const ALLOWED_PRESET_IDS = ["4vcpu_16gb_48gb", "8vcpu_32gb_48gb"];
const FILTERED_PRESETS = MORPH_SNAPSHOT_PRESETS.filter((p) =>
  ALLOWED_PRESET_IDS.includes(p.presetId)
);

export interface RepositoryAdvancedOptionsProps {
  selectedSnapshotId?: MorphSnapshotId;
  onSnapshotChange: (snapshotId: MorphSnapshotId) => void;
}

export function RepositoryAdvancedOptions({
  selectedSnapshotId = DEFAULT_MORPH_SNAPSHOT_ID,
  onSnapshotChange,
}: RepositoryAdvancedOptionsProps) {
  return (
    <div className="rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
      <Accordion
        selectionMode="multiple"
        className="px-0"
        defaultExpandedKeys={[]}
        itemClasses={{
          trigger:
            "text-sm cursor-pointer py-2 px-3 transition-colors data-[hovered=true]:bg-neutral-50 dark:data-[hovered=true]:bg-neutral-900 rounded-none",
          content:
            "pt-0 px-3 pb-3 border-t border-neutral-200 dark:border-neutral-800",
          title: "text-sm font-medium",
        }}
      >
        <AccordionItem
          key="advanced-options"
          aria-label="Advanced options"
          title="Advanced options"
        >
          <div className="space-y-4 pt-1.5">
            <RadioGroup
              value={selectedSnapshotId}
              onChange={(value) => onSnapshotChange(value as MorphSnapshotId)}
              className="space-y-4"
            >
              <Label className="text-sm font-medium text-neutral-800 dark:text-neutral-200">
                Machine size
              </Label>
              <div className="grid gap-3 sm:grid-cols-2 pt-1.5">
                {FILTERED_PRESETS.map((preset) => (
                  <Radio
                    key={preset.id}
                    value={preset.id}
                    className={({ isSelected, isFocusVisible, isDisabled }) => {
                      const baseClasses =
                        "relative flex h-full cursor-pointer flex-col justify-between rounded-lg border px-4 py-3 text-left transition-colors focus:outline-none";
                      const stateClasses = [
                        isSelected
                          ? "border-neutral-900 dark:border-neutral-100 bg-neutral-50 dark:bg-neutral-900"
                          : "border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:border-neutral-300 dark:hover:border-neutral-700",
                        isFocusVisible
                          ? "outline-2 outline-offset-2 outline-neutral-500"
                          : "",
                        isDisabled ? "cursor-not-allowed opacity-60" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return `${baseClasses} ${stateClasses}`.trim();
                    }}
                  >
                    {({ isSelected }) => (
                      <div className="flex h-full flex-col gap-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                              {preset.label}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
                              <span>{preset.cpu}</span>
                              <span>{preset.memory}</span>
                              <span>{preset.disk}</span>
                            </div>
                          </div>
                          <span
                            className={`mt-1 inline-flex h-5 w-5 items-center justify-center rounded-full border ${
                              isSelected
                                ? "border-neutral-900 dark:border-neutral-100 bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                                : "border-neutral-300 dark:border-neutral-700 bg-white text-transparent dark:bg-neutral-950"
                            }`}
                          >
                            <Check className="h-3 w-3" aria-hidden="true" />
                          </span>
                        </div>
                        {preset.description ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {preset.description}
                          </p>
                        ) : null}
                      </div>
                    )}
                  </Radio>
                ))}
              </div>
            </RadioGroup>
          </div>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
