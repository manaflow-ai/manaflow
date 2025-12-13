import * as Popover from "@radix-ui/react-popover";
import clsx from "clsx";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";
import * as React from "react";

const Command = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive>
>(({ className, ...props }, ref) => (
  <CommandPrimitive
    ref={ref}
    className={clsx(
      "flex h-full w-full flex-col overflow-hidden rounded-md bg-white dark:bg-neutral-950 text-neutral-950 dark:text-neutral-50",
      className
    )}
    {...props}
  />
));
Command.displayName = CommandPrimitive.displayName;

type CommandInputProps = React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Input
> & {
  showIcon?: boolean;
  rightElement?: React.ReactNode;
};

const CommandInput = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Input>,
  CommandInputProps
>(({ className, showIcon = true, rightElement, ...props }, ref) => (
  <div
    className="flex items-center border-b border-neutral-200 dark:border-neutral-800 px-3"
    cmdk-input-wrapper=""
  >
    {showIcon ? <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" /> : null}
    <CommandPrimitive.Input
      ref={ref}
      className={clsx(
        "flex h-9 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-neutral-500 dark:placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
    {rightElement}
  </div>
));
CommandInput.displayName = CommandPrimitive.Input.displayName;

const CommandList = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.List>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.List
    ref={ref}
    className={clsx(
      "max-h-[300px] overflow-y-auto overflow-x-hidden",
      className
    )}
    {...props}
  />
));
CommandList.displayName = CommandPrimitive.List.displayName;

const CommandEmpty = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Empty>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Empty>
>((props, ref) => (
  <CommandPrimitive.Empty
    ref={ref}
    className="py-6 text-center text-sm text-neutral-500 dark:text-neutral-400"
    {...props}
  />
));
CommandEmpty.displayName = CommandPrimitive.Empty.displayName;

const CommandGroup = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Group>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Group>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Group
    ref={ref}
    className={clsx(
      "overflow-hidden p-1 text-neutral-950 dark:text-neutral-50",
      className
    )}
    {...props}
  />
));
CommandGroup.displayName = CommandPrimitive.Group.displayName;

const CommandSeparator = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof CommandPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <CommandPrimitive.Separator
    ref={ref}
    className={clsx("-mx-1 h-px bg-neutral-200 dark:bg-neutral-800", className)}
    {...props}
  />
));
CommandSeparator.displayName = CommandPrimitive.Separator.displayName;

type CommandItemVariant = "default" | "agent";

type CommandItemProps = React.ComponentPropsWithoutRef<
  typeof CommandPrimitive.Item
> & {
  variant?: CommandItemVariant;
};

const CommandItem = React.forwardRef<
  React.ElementRef<typeof CommandPrimitive.Item>,
  CommandItemProps
>(({ className, variant = "default", ...props }, ref) => (
  <CommandPrimitive.Item
    ref={ref}
    className={clsx(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 text-sm outline-none",
      variant === "agent" ? "pl-2 pr-1" : "px-2",
      "aria-selected:bg-neutral-100 dark:aria-selected:bg-neutral-800",
      "aria-disabled:pointer-events-none aria-disabled:opacity-50",
      className
    )}
    {...props}
  />
));
CommandItem.displayName = CommandPrimitive.Item.displayName;

const CommandDialog = ({
  children,
  open,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof Command> & {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) => {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Portal>
        <Popover.Content
          className="fixed left-1/2 top-1/2 z-[var(--z-modal)] w-full max-w-[450px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-0 shadow-md outline-none"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command {...props}>{children}</Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
};

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
