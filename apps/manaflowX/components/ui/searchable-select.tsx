"use client"

import * as Popover from "@radix-ui/react-popover"
import { Command } from "cmdk"
import clsx from "clsx"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"

export interface SelectOptionObject {
  label: string
  value: string
  icon?: ReactNode
}

export type SelectOption = string | SelectOptionObject

export type SearchableSelectHandle = {
  open: () => void
  close: () => void
}

export interface SearchableSelectProps {
  options: SelectOption[]
  value: string[]
  onChange: (value: string[]) => void
  placeholder?: string
  singleSelect?: boolean
  className?: string
  loading?: boolean
  showSearch?: boolean
  disabled?: boolean
  leftIcon?: ReactNode
  header?: ReactNode
  footer?: ReactNode
  searchPlaceholder?: string
  /** Section label shown above the options list (e.g. "Repositories") */
  sectionLabel?: string
  /** Whether to close the dropdown after selecting an option in singleSelect mode (default: true) */
  closeOnSelect?: boolean
  /** Render a flyout panel when hovering over an option */
  renderOptionFlyout?: (value: string) => ReactNode
}

function normalizeOptions(options: SelectOption[]): SelectOptionObject[] {
  return options.map((o) =>
    typeof o === "string" ? { label: o, value: o } : o,
  )
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
  )
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
  )
}

function ChevronRightIcon({ className }: { className?: string }) {
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
      <path d="m9 18 6-6-6-6" />
    </svg>
  )
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
  )
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
    header,
    footer,
    searchPlaceholder = "Search...",
    sectionLabel,
    closeOnSelect = true,
    renderOptionFlyout,
  },
  ref,
) {
  const normOptions = useMemo(() => normalizeOptions(options), [options])

  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [search, setSearch] = useState("")
  const [hoveredOption, setHoveredOption] = useState<string | null>(null)
  const [flyoutOffset, setFlyoutOffset] = useState(0)
  const dropdownRef = useRef<HTMLDivElement | null>(null)

  // Flyout height constant (must match ConfigureFlyout max-h)
  const FLYOUT_HEIGHT = 500
  const VIEWPORT_PADDING = 16

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // Calculate safe flyout offset that keeps it within viewport
  const calculateSafeOffset = useCallback(
    (desiredOffset: number) => {
      const dropdownContainer = dropdownRef.current
      if (!dropdownContainer) return desiredOffset

      const dropdownRect = dropdownContainer.getBoundingClientRect()
      // Max offset that keeps flyout within viewport
      const maxSafeOffset = Math.max(
        0,
        window.innerHeight -
          dropdownRect.top -
          FLYOUT_HEIGHT -
          VIEWPORT_PADDING,
      )
      // Also don't let it go below the dropdown itself
      const maxDropdownOffset = dropdownRect.height - 40

      return Math.max(
        0,
        Math.min(desiredOffset, maxSafeOffset, maxDropdownOffset),
      )
    },
    [FLYOUT_HEIGHT, VIEWPORT_PADDING],
  )

  // Calculate offset for selected item - update whenever selection changes or dropdown opens
  useEffect(() => {
    if (!open || value.length === 0) return

    let scrollListener: (() => void) | null = null
    let listEl: Element | null = null

    const updateOffset = () => {
      const dropdownContainer = dropdownRef.current
      if (!dropdownContainer) return

      const selectedItem = dropdownContainer.querySelector(
        `[data-selected-value="${value[0]}"]`,
      )
      if (selectedItem) {
        const dropdownRect = dropdownContainer.getBoundingClientRect()
        const itemRect = selectedItem.getBoundingClientRect()
        const desiredOffset = itemRect.top - dropdownRect.top
        setFlyoutOffset(calculateSafeOffset(desiredOffset))
      }

      // Set up scroll listener if not already done
      if (!scrollListener) {
        listEl = dropdownContainer.querySelector("[cmdk-list]")
        if (listEl) {
          scrollListener = updateOffset
          listEl.addEventListener("scroll", scrollListener)
        }
      }
    }

    // Run multiple times to ensure DOM is ready
    const timer1 = setTimeout(updateOffset, 0)
    const timer2 = setTimeout(updateOffset, 50)
    const timer3 = setTimeout(updateOffset, 100)

    return () => {
      clearTimeout(timer1)
      clearTimeout(timer2)
      clearTimeout(timer3)
      if (listEl && scrollListener) {
        listEl.removeEventListener("scroll", scrollListener)
      }
    }
  }, [open, value, calculateSafeOffset])

  // Handle open state changes
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      setHoveredOption(null)
    }
  }, [])

  // Handle hover on option - only track hover and update offset if nothing selected
  const handleOptionHover = useCallback(
    (optValue: string, event: React.MouseEvent) => {
      setHoveredOption(optValue)
      // Only update offset on hover if nothing is selected yet
      if (value.length === 0) {
        const target = event.currentTarget as HTMLElement
        const dropdownContainer = dropdownRef.current
        if (dropdownContainer && target) {
          const dropdownRect = dropdownContainer.getBoundingClientRect()
          const itemRect = target.getBoundingClientRect()
          const desiredOffset = itemRect.top - dropdownRect.top
          setFlyoutOffset(calculateSafeOffset(desiredOffset))
        }
      }
    },
    [value.length, calculateSafeOffset],
  )

  // Display content for trigger button
  const displayContent = useMemo(() => {
    if (loading) {
      return (
        <span className="flex items-center gap-2">
          <LoaderIcon className="h-4 w-4 animate-spin" />
          <span>Loading...</span>
        </span>
      )
    }
    if (value.length === 0) {
      return (
        <span className="text-muted-foreground truncate select-none">
          {placeholder}
        </span>
      )
    }
    if (value.length === 1) {
      const selectedVal = value[0]
      const selectedOpt = normOptions.find((o) => o.value === selectedVal)
      const label = selectedOpt?.label ?? selectedVal
      return (
        <span className="inline-flex items-center gap-2">
          {selectedOpt?.icon ? (
            <span className="shrink-0 inline-flex items-center justify-center">
              {selectedOpt.icon}
            </span>
          ) : null}
          <span className="truncate select-none">{label}</span>
        </span>
      )
    }
    return (
      <span className="truncate select-none">{`${value.length} selected`}</span>
    )
  }, [loading, normOptions, placeholder, value])

  // Filter options by search
  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return normOptions
    return normOptions.filter((o) =>
      `${o.label} ${o.value}`.toLowerCase().includes(q),
    )
  }, [normOptions, search])

  useImperativeHandle(
    ref,
    () => ({
      open: () => {
        setSearch("")
        setOpen(true)
      },
      close: () => {
        setOpen(false)
      },
    }),
    [],
  )

  const onSelectValue = useCallback(
    (val: string): void => {
      setSearch("")
      if (singleSelect) {
        // Toggle selection - if already selected, unselect it
        if (value.includes(val)) {
          onChange([])
        } else {
          onChange([val])
        }
        if (closeOnSelect) {
          setOpen(false)
        }
        return
      }
      // Toggle selection for multi-select
      if (value.includes(val)) {
        onChange(value.filter((v) => v !== val))
      } else {
        onChange([...value, val])
      }
    },
    [onChange, singleSelect, value, closeOnSelect],
  )

  // Get flyout content: if something is selected, always show that; otherwise show hovered
  const flyoutTarget = value.length > 0 ? value[0] : hoveredOption
  const flyoutContent = flyoutTarget ? renderOptionFlyout?.(flyoutTarget) : null

  return (
    <Popover.Root open={open} onOpenChange={handleOpenChange}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className={clsx(
            "relative inline-flex h-7 items-center rounded-md border border-border bg-card px-2.5 pr-6 text-sm text-foreground transition-colors outline-none",
            "hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
            "disabled:cursor-not-allowed disabled:opacity-60",
            "aria-expanded:bg-accent/50",
            className,
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
          <ChevronDownIcon className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={4}
          collisionPadding={16}
          className="z-50 outline-none flex items-start gap-1"
        >
          <div
            ref={dropdownRef}
            className={clsx(
              "rounded-lg overflow-hidden border border-border bg-card p-0 shadow-xl w-[300px]",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            )}
          >
            <Command loop shouldFilter={false} className="text-[13.5px]">
              {showSearch ? (
                <div className="border-b border-border px-2 py-1">
                  <Command.Input
                    placeholder={searchPlaceholder}
                    value={search}
                    onValueChange={setSearch}
                    className={clsx(
                      "w-full bg-transparent px-1 py-1 text-sm text-foreground",
                      "placeholder-muted-foreground focus:outline-none",
                    )}
                  />
                </div>
              ) : null}
              {header ? (
                <div className="border-b border-border">{header}</div>
              ) : null}
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <LoaderIcon className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  {sectionLabel ? (
                    <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground select-none">
                      {sectionLabel}
                    </div>
                  ) : null}
                  <Command.List className="max-h-72 overflow-y-auto p-1">
                    {filteredOptions.length === 0 ? (
                      <Command.Empty className="px-3 py-4 text-center text-muted-foreground">
                        No results found
                      </Command.Empty>
                    ) : (
                      filteredOptions.map((opt) => {
                        const isSelected = value.includes(opt.value)
                        // Show chevron only when this item's flyout is actually visible
                        // Flyout shows for: selected item, or hovered item when nothing selected
                        const showChevron =
                          renderOptionFlyout &&
                          (isSelected ||
                            (hoveredOption === opt.value && value.length === 0))
                        return (
                          <Command.Item
                            key={opt.value}
                            value={`${opt.label} ${opt.value}`}
                            onSelect={() => onSelectValue(opt.value)}
                            onMouseEnter={(e) =>
                              handleOptionHover(opt.value, e)
                            }
                            data-selected-value={
                              isSelected ? opt.value : undefined
                            }
                            className={clsx(
                              "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer",
                              "text-foreground hover:bg-accent/50 transition-colors",
                              "data-[selected=true]:bg-accent/50",
                              isSelected && "bg-accent/50",
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
                            <div className="flex items-center gap-1">
                              {isSelected ? (
                                <CheckIcon className="h-4 w-4 text-foreground shrink-0" />
                              ) : null}
                              {showChevron ? (
                                <ChevronRightIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                              ) : null}
                            </div>
                          </Command.Item>
                        )
                      })
                    )}
                  </Command.List>
                </>
              )}
            </Command>
            {footer ? (
              <div className="border-t border-border bg-card">{footer}</div>
            ) : null}
          </div>

          {/* Flyout panel - rendered next to the dropdown, aligned with hovered item */}
          {flyoutContent && (
            <div className="shrink-0" style={{ marginTop: flyoutOffset }}>
              {flyoutContent}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
})

export { SearchableSelect }
export default SearchableSelect
