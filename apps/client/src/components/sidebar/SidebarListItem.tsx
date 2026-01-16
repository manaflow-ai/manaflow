import clsx from "clsx";
import type { MouseEvent, ReactNode } from "react";
import { SidebarToggleButton } from "../SidebarToggleButton";

interface SidebarListItemProps {
  title: ReactNode;
  titleClassName?: string;
  titleSuffix?: ReactNode;
  secondary?: ReactNode;
  secondaryClassName?: string;
  meta?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  paddingLeft?: number;
  className?: string;
  containerClassName?: string;
  toggle?: {
    expanded: boolean;
    onToggle: (
      event?: MouseEvent<HTMLButtonElement | HTMLAnchorElement>
    ) => void;
    visible?: boolean;
    className?: string;
    iconClassName?: string;
    /** Show a notification dot over the toggle arrow */
    hasNotification?: boolean;
  };
}

export function SidebarListItem({
  title,
  titleClassName,
  titleSuffix,
  secondary,
  secondaryClassName,
  meta,
  leading,
  trailing,
  paddingLeft = 8,
  className,
  containerClassName,
  toggle,
}: SidebarListItemProps) {
  const toggleVisible = toggle?.visible ?? Boolean(toggle);
  const effectivePaddingLeft = Math.max(
    0,
    toggleVisible ? paddingLeft - 4 : paddingLeft
  );

  return (
    <div className={clsx("relative group select-none", containerClassName)}>
      <div
        className={clsx(
          "flex items-center rounded-sm pr-2 py-[3px] text-xs",
          "hover:bg-neutral-200/45 dark:hover:bg-neutral-800/45 cursor-default",
          "group-[.active]:bg-neutral-200/75 dark:group-[.active]:bg-neutral-800/65",
          "group-[.active]:hover:bg-neutral-200/75 dark:group-[.active]:hover:bg-neutral-800/65",
          className
        )}
        style={{ paddingLeft: `${effectivePaddingLeft}px` }}
      >
        {toggle ? (
          <div className="pr-1 -ml-0.5 relative">
            <SidebarToggleButton
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggle.onToggle(event);
              }}
              isExpanded={toggle.expanded}
              isVisible={toggleVisible}
              className={clsx("size-4", toggle.className)}
              iconClassName={toggle.iconClassName}
            />
            {toggle.hasNotification && (
              <div className="absolute inset-0 grid place-items-center pointer-events-none -translate-x-0.5">
                <span className="size-2 rounded-full bg-blue-500" />
              </div>
            )}
          </div>
        ) : null}

        {leading ? <div className="mr-2 flex-shrink-0">{leading}</div> : null}

        <div className="flex-1 min-w-0 gap-px">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={clsx(
                "truncate text-neutral-900 dark:text-neutral-100 font-medium",
                titleClassName
              )}
            >
              {title}
            </span>
            {titleSuffix ? (
              <span className="flex-shrink-0">{titleSuffix}</span>
            ) : null}
            {meta ? (
              <span className="ml-auto flex-shrink-0">{meta}</span>
            ) : null}
          </div>
          {secondary ? (
            <div
              className={clsx(
                "truncate text-[10px] text-neutral-600 dark:text-neutral-400",
                secondaryClassName
              )}
            >
              {secondary}
            </div>
          ) : null}
        </div>
      </div>

      {trailing ? (
        <div className="absolute right-2 top-1/2 -translate-y-1/2">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

export default SidebarListItem;
