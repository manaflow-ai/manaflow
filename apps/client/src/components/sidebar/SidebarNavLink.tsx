import { Link, type LinkProps } from "@tanstack/react-router";
import clsx from "clsx";
import { type ComponentType } from "react";

export type SidebarLinkRecord = Record<
  string,
  string | number | boolean | null | undefined
>;

interface SidebarNavLinkProps {
  to: LinkProps["to"];
  label: string;
  params?: LinkProps["params"];
  search?: LinkProps["search"];
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  exact?: boolean;
  className?: string;
  badgeCount?: number;
}

export function SidebarNavLink({
  to,
  label,
  params,
  search,
  icon: Icon,
  exact = true,
  className,
  badgeCount,
}: SidebarNavLinkProps) {
  return (
    <Link
      to={to}
      params={params}
      search={search}
      activeOptions={{ exact }}
      className={clsx(
        "pointer-default cursor-default group flex items-center gap-2 rounded-sm pl-2 ml-2 py-1 text-[13px] text-neutral-900 select-none hover:bg-neutral-200/45 dark:text-neutral-100 dark:hover:bg-neutral-800/45 data-[active=true]:hover:bg-neutral-200/75 dark:data-[active=true]:hover:bg-neutral-800/65 pr-2",
        className
      )}
      activeProps={{
        className:
          "bg-neutral-200/75 text-black dark:bg-neutral-800/65 dark:text-white",
        "data-active": "true",
      }}
    >
      {Icon ? (
        <Icon
          className={
            "size-[15px] text-neutral-500 group-hover:text-neutral-800 dark:group-hover:text-neutral-100 group-data-[active=true]:text-neutral-900 dark:group-data-[active=true]:text-neutral-100"
          }
          aria-hidden
        />
      ) : null}
      <span>{label}</span>
      {badgeCount !== undefined && badgeCount > 0 && (
        <span className="flex items-center justify-center min-w-[14px] h-[14px] px-1 text-[9px] font-medium text-white bg-blue-500 rounded-full ml-auto tabular-nums tracking-tighter">
          {/* 12 */}
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      )}
    </Link>
  );
}
