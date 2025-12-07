"use client";

import * as Popover from "@radix-ui/react-popover";
import { Command } from "cmdk";
import clsx from "clsx";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface SelectOptionObject {
  label: string;
  value: string;
  icon?: ReactNode;
}

export type SelectOption = string | SelectOptionObject;

export type SearchableSelectHandle = {
  open: () => void;
  close: () => void;
};

export interface SearchableSelectProps {
  options: SelectOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  singleSelect?: boolean;
  className?: string;
  loading?: boolean;
  showSearch?: boolean;
  disabled?: boolean;
  leftIcon?: ReactNode;
  footer?: ReactNode;
  searchPlaceholder?: string;
  /** Section label shown above the options list (e.g. "Repositories") */
  sectionLabel?: string;
}

function normalizeOptions(options: SelectOption[]): SelectOptionObject[] {
  return options.map((o) =>
    typeof o === "string" ? { label: o, value: o } : o
  );
}

// Lucide icons as inline SVGs to avoid import issues
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function LoaderIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

const SearchableSelect = forwardRef<
  SearchableSelectHandle,
  SearchableSelectProps
>(function SearchableSelect(
  {
    options,
    value,
    onChange,
    placeholder = "Select",
    singleSelect = false,
    className,
    loading = false,
    showSearch = true,
    disabled = false,
    leftIcon,
    footer,
    searchPlaceholder = "Search...",
    sectionLabel,
  },
  ref
) {
  const normOptions = useMemo(() => normalizeOptions(options), [options]);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [search, setSearch] = useState("");

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Display content for trigger button
  const displayContent = useMemo(() => {
    if (loading) {
      return (
        <span className="flex items-center gap-2">
          <LoaderIcon className="h-4 w-4 animate-spin" />
          <span>Loading...</span>
        </span>
      );
    }
    if (value.length === 0) {
      return (
        <span className="text-neutral-400 truncate select-none">
          {placeholder}
        </span>
      );
    }
    if (value.length === 1) {
      const selectedVal = value[0];
      const selectedOpt = normOptions.find((o) => o.value === selectedVal);
      const label = selectedOpt?.label ?? selectedVal;
      return (
        <span className="inline-flex items-center gap-2">
          {selectedOpt?.icon ? (
            <span className="shrink-0 inline-flex items-center justify-center">
              {selectedOpt.icon}
            </span>
          ) : null}
          <span className="truncate select-none">{label}</span>
        </span>
      );
    }
    return (
      <span className="truncate select-none">{`${value.length} selected`}</span>
    );
  }, [loading, normOptions, placeholder, value]);

  // Filter options by search
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return normOptions;
    return normOptions.filter((o) =>
      `${o.label} ${o.value}`.toLowerCase().includes(q)
    );
  }, [normOptions, search]);

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setSearch("");
        setOpen(true);
      },
      close: () => {
        setOpen(false);
      },
    }),
    []
  );

  const onSelectValue = useCallback(
    (val: string): void => {
      setSearch("");
      if (singleSelect) {
        onChange([val]);
        setOpen(false);
        return;
      }
      // Toggle selection for multi-select
      if (value.includes(val)) {
        onChange(value.filter((v) => v !== val));
      } else {
        onChange([...value, val]);
      }
    },
    [onChange, singleSelect, value]
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={clsx(
            "relative inline-flex h-7 items-center rounded-md border border-neutral-700 bg-neutral-900 px-2.5 pr-6 text-sm text-neutral-100 transition-colors outline-none",
            "hover:bg-neutral-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "aria-expanded:bg-neutral-800",
            className
          )}
        >
          <span className="flex-1 min-w-0 text-left text-[13.5px] inline-flex items-center gap-1.5 pr-1">
            {leftIcon ? (
              <span className="shrink-0 inline-flex items-center justify-center">
                {leftIcon}
              </span>
            ) : null}
            {displayContent}
          </span>
          <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-neutral-500" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          className={clsx(
            "z-50 rounded-lg border border-neutral-700 bg-neutral-900 p-0 shadow-xl outline-none w-[300px]",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
          )}
        >
          <Command loop shouldFilter={false} className="text-[13.5px]">
            {showSearch ? (
              <div className="border-b border-neutral-800 p-2">
                <Command.Input
                  placeholder={searchPlaceholder}
                  value={search}
                  onValueChange={setSearch}
                  className={clsx(
                    "w-full rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white",
                    "placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  )}
                />
              </div>
            ) : null}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <LoaderIcon className="h-5 w-5 animate-spin text-neutral-400" />
              </div>
            ) : (
              <>
                {sectionLabel ? (
                  <div className="px-3 py-2 text-xs font-medium text-neutral-500 select-none">
                    {sectionLabel}
                  </div>
                ) : null}
                <Command.List className="max-h-[18rem] overflow-y-auto p-1">
                {filteredOptions.length === 0 ? (
                  <Command.Empty className="px-3 py-4 text-center text-neutral-500">
                    No options found
                  </Command.Empty>
                ) : (
                  filteredOptions.map((opt) => {
                    const isSelected = value.includes(opt.value);
                    return (
                      <Command.Item
                        key={opt.value}
                        value={`${opt.label} ${opt.value}`}
                        onSelect={() => onSelectValue(opt.value)}
                        className={clsx(
                          "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer",
                          "text-neutral-100 hover:bg-neutral-800 transition-colors",
                          "data-[selected=true]:bg-neutral-800"
                        )}
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          {opt.icon ? (
                            <span className="shrink-0 inline-flex items-center justify-center">
                              {opt.icon}
                            </span>
                          ) : null}
                          <span className="truncate select-none">
                            {opt.label}
                          </span>
                        </div>
                        {isSelected ? (
                          <CheckIcon className="h-4 w-4 text-neutral-100 shrink-0" />
                        ) : null}
                      </Command.Item>
                    );
                  })
                )}
              </Command.List>
              </>
            )}
          </Command>
          {footer ? (
            <div className="border-t border-neutral-800 bg-neutral-900">
              {footer}
            </div>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
});

export { SearchableSelect };
export default SearchableSelect;
