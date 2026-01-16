import { Menu } from "@base-ui-components/react/menu";
import clsx from "clsx";
import * as React from "react";
import { ArrowSvg } from "./shared/arrow-svg";

export type DropdownRootProps = React.ComponentPropsWithoutRef<
  typeof Menu.Root
>;

const DropdownRoot: React.FC<DropdownRootProps> = ({ children, ...props }) => {
  return <Menu.Root {...props}>{children}</Menu.Root>;
};

export type DropdownTriggerProps = React.ComponentPropsWithoutRef<
  typeof Menu.Trigger
>;

const DropdownTrigger: React.FC<DropdownTriggerProps> = ({
  className,
  ...props
}) => {
  return (
    <Menu.Trigger {...props} className={clsx("outline-none", className)} />
  );
};

export type DropdownPositionerProps = React.ComponentPropsWithoutRef<
  typeof Menu.Positioner
>;

const DropdownPositioner: React.FC<DropdownPositionerProps> = ({
  className,
  ...props
}) => {
  return (
    <Menu.Positioner
      {...props}
      className={clsx("outline-none z-[var(--z-popover)]", className)}
    />
  );
};

export type DropdownPopupProps = React.ComponentPropsWithoutRef<
  typeof Menu.Popup
>;

const DropdownPopup: React.FC<DropdownPopupProps> = ({
  className,
  onClick,
  ...props
}) => {
  return (
    <Menu.Popup
      {...props}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className={clsx(
        "origin-[var(--transform-origin)] rounded-md bg-white dark:bg-black py-1",
        "text-neutral-900 dark:text-neutral-100",
        "shadow-lg shadow-neutral-200 dark:shadow-neutral-950",
        "outline outline-neutral-200 dark:outline-neutral-800",
        "transition-[transform,scale,opacity]",
        "data-[ending-style]:scale-90 data-[ending-style]:opacity-0",
        "data-[starting-style]:scale-90 data-[starting-style]:opacity-0",
        className
      )}
    />
  );
};

export type DropdownItemProps = React.ComponentPropsWithoutRef<
  typeof Menu.Item
>;

export const DropdownItem: React.FC<DropdownItemProps> = ({
  className,
  ...props
}) => {
  return (
    <Menu.Item
      {...props}
      className={clsx(
        "flex cursor-default py-2 pr-8 pl-4 text-sm leading-4 outline-none select-none",
        "data-[highlighted]:relative data-[highlighted]:z-0",
        "data-[highlighted]:text-neutral-900 dark:data-[highlighted]:text-neutral-100",
        "data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0",
        "data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm",
        "data-[highlighted]:before:bg-neutral-100 dark:data-[highlighted]:before:bg-neutral-800",
        "data-[disabled]:text-neutral-400 dark:data-[disabled]:text-neutral-600 data-[disabled]:cursor-not-allowed",
        className
      )}
    />
  );
};

export type DropdownArrowProps = React.ComponentPropsWithoutRef<
  typeof Menu.Arrow
>;

const DropdownArrow: React.FC<DropdownArrowProps> = ({
  className,
  ...props
}) => {
  return (
    <Menu.Arrow
      {...props}
      className={clsx(
        "data-[side=bottom]:top-[-8px] data-[side=left]:right-[-13px] data-[side=left]:rotate-90",
        "data-[side=right]:left-[-13px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-8px] data-[side=top]:rotate-180",
        className
      )}
    >
      <ArrowSvg />
    </Menu.Arrow>
  );
};

export const DropdownPortal = Menu.Portal;

export interface DropdownExports {
  Root: typeof DropdownRoot;
  Trigger: typeof DropdownTrigger;
  Positioner: typeof DropdownPositioner;
  Popup: typeof DropdownPopup;
  Item: typeof DropdownItem;
  Arrow: typeof DropdownArrow;
  Portal: typeof DropdownPortal;
  CheckboxItem: typeof DropdownCheckboxItem;
  CheckboxItemIndicator: typeof DropdownCheckboxItemIndicator;
}

// Checkbox variants
export type DropdownCheckboxItemProps = React.ComponentPropsWithoutRef<
  typeof Menu.CheckboxItem
>;

const DropdownCheckboxItem: React.FC<DropdownCheckboxItemProps> = ({
  className,
  ...props
}) => {
  return (
    <Menu.CheckboxItem
      {...props}
      className={clsx(
        "grid cursor-default grid-cols-[0.75rem_1fr] items-center gap-2 py-2 pr-8 pl-2.5 text-sm leading-4 outline-none select-none",
        "data-[highlighted]:relative data-[highlighted]:z-0",
        "data-[highlighted]:text-neutral-50 dark:data-[highlighted]:text-neutral-900",
        "data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0",
        "data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm",
        "data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-100",
        "data-[disabled]:text-neutral-400 dark:data-[disabled]:text-neutral-600 data-[disabled]:cursor-not-allowed",
        className
      )}
    />
  );
};

export type DropdownCheckboxItemIndicatorProps =
  React.ComponentPropsWithoutRef<typeof Menu.CheckboxItemIndicator>;

const DropdownCheckboxItemIndicator: React.FC<
  DropdownCheckboxItemIndicatorProps
> = ({ className, ...props }) => {
  return (
    <Menu.CheckboxItemIndicator
      {...props}
      className={clsx(
        "col-start-1 flex items-center justify-center",
        className
      )}
    />
  );
};

// Named exports above include checkbox variants

// Components exported for composition in a separate module to
// satisfy react-refresh only-export-components rule.
export const DropdownParts = {
  Root: DropdownRoot,
  Trigger: DropdownTrigger,
  Positioner: DropdownPositioner,
  Popup: DropdownPopup,
  Item: DropdownItem,
  Arrow: DropdownArrow,
  Portal: DropdownPortal,
  CheckboxItem: DropdownCheckboxItem,
  CheckboxItemIndicator: DropdownCheckboxItemIndicator,
} as const satisfies DropdownExports;
