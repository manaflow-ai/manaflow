import { Link } from "@tanstack/react-router";
import { ContextMenu } from "@base-ui-components/react/context-menu";
import { Dropdown } from "@/components/ui/dropdown";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import clsx from "clsx";
import { Cloud, Laptop, Plus } from "lucide-react";
import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { env } from "@/client-env";

interface SidebarWorkspacesSectionProps {
  teamSlugOrId: string;
  onNewLocalWorkspace?: () => void;
  onNewCloudWorkspace?: () => void;
}

export function SidebarWorkspacesSection({
  teamSlugOrId,
  onNewLocalWorkspace,
  onNewCloudWorkspace,
}: SidebarWorkspacesSectionProps) {
  const navigate = useNavigate();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const isWebMode = Boolean(env.NEXT_PUBLIC_WEB_MODE);

  const handleNewLocalWorkspace = useCallback(() => {
    setIsDropdownOpen(false);
    if (onNewLocalWorkspace) {
      onNewLocalWorkspace();
    } else {
      // Navigate to workspaces page with local mode
      void navigate({
        to: "/$teamSlugOrId/workspaces",
        params: { teamSlugOrId },
        search: { mode: "local" },
      });
    }
  }, [navigate, onNewLocalWorkspace, teamSlugOrId]);

  const handleNewCloudWorkspace = useCallback(() => {
    setIsDropdownOpen(false);
    if (onNewCloudWorkspace) {
      onNewCloudWorkspace();
    } else {
      // Navigate to workspaces page with cloud mode
      void navigate({
        to: "/$teamSlugOrId/workspaces",
        params: { teamSlugOrId },
        search: { mode: "cloud" },
      });
    }
  }, [navigate, onNewCloudWorkspace, teamSlugOrId]);

  const contextMenuItemClassName =
    "flex items-center gap-2 cursor-default py-1.5 pr-8 pl-3 text-[13px] leading-5 outline-none select-none data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-white data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-1 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:rounded-sm data-[highlighted]:before:bg-neutral-900 dark:data-[highlighted]:before:bg-neutral-700";

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>
        <div className="group flex items-center justify-between">
          <Link
            to="/$teamSlugOrId/workspaces"
            params={{ teamSlugOrId }}
            search={{ mode: undefined }}
            activeOptions={{ exact: true }}
            className={clsx(
              "pointer-default cursor-default flex flex-1 items-center rounded-sm pl-2 ml-2 pr-1 py-0.5 text-[12px] font-medium text-neutral-600 select-none hover:bg-neutral-200/45 dark:text-neutral-300 dark:hover:bg-neutral-800/45 data-[active=true]:hover:bg-neutral-200/75 dark:data-[active=true]:hover:bg-neutral-800/65"
            )}
            activeProps={{
              className:
                "bg-neutral-200/75 text-neutral-900 dark:bg-neutral-800/65 dark:text-neutral-100",
              "data-active": "true",
            }}
          >
            Workspaces
          </Link>

          {/* New Workspace Button - appears on hover */}
          <div className="flex items-center gap-0.5 mr-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Dropdown.Root open={isDropdownOpen} onOpenChange={setIsDropdownOpen}>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Dropdown.Trigger
                    className={clsx(
                      "flex h-4 w-4 items-center justify-center rounded-sm",
                      "text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200",
                      "hover:bg-neutral-200/60 dark:hover:bg-neutral-700/60",
                      "transition-colors cursor-default",
                      "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-400 dark:focus-visible:outline-neutral-500",
                      isDropdownOpen && "opacity-100 bg-neutral-200/60 dark:bg-neutral-700/60"
                    )}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                  >
                    <Plus className="w-3 h-3" strokeWidth={2} />
                  </Dropdown.Trigger>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={6}>
                  New Workspace
                </TooltipContent>
              </Tooltip>
              <Dropdown.Portal>
                <Dropdown.Positioner sideOffset={4} side="bottom" align="start">
                  <Dropdown.Popup className="min-w-[180px]">
                    {!isWebMode && (
                      <Dropdown.Item
                        className="flex items-center gap-2"
                        onClick={handleNewLocalWorkspace}
                      >
                        <Laptop className="w-3.5 h-3.5 text-neutral-500" />
                        <span>Local Workspace</span>
                      </Dropdown.Item>
                    )}
                    <Dropdown.Item
                      className="flex items-center gap-2"
                      onClick={handleNewCloudWorkspace}
                    >
                      <Cloud className="w-3.5 h-3.5 text-neutral-500" />
                      <span>Cloud Workspace</span>
                    </Dropdown.Item>
                  </Dropdown.Popup>
                </Dropdown.Positioner>
              </Dropdown.Portal>
            </Dropdown.Root>
          </div>
        </div>
      </ContextMenu.Trigger>

      {/* Context Menu */}
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="outline-none z-[var(--z-context-menu)]">
          <ContextMenu.Popup className="origin-[var(--transform-origin)] rounded-md bg-white dark:bg-neutral-800 py-1 text-neutral-900 dark:text-neutral-100 shadow-lg shadow-gray-200 outline-1 outline-neutral-200 transition-[opacity] data-[ending-style]:opacity-0 dark:shadow-none dark:-outline-offset-1 dark:outline-neutral-700">
            {!isWebMode && (
              <ContextMenu.Item
                className={contextMenuItemClassName}
                onClick={handleNewLocalWorkspace}
              >
                <Laptop className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
                <span>New Local Workspace</span>
              </ContextMenu.Item>
            )}
            <ContextMenu.Item
              className={contextMenuItemClassName}
              onClick={handleNewCloudWorkspace}
            >
              <Cloud className="w-3.5 h-3.5 text-neutral-600 dark:text-neutral-300" />
              <span>New Cloud Workspace</span>
            </ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
