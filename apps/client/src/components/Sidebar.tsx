import { TaskTree } from "@/components/TaskTree";
import { TaskTreeSkeleton } from "@/components/TaskTreeSkeleton";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { isElectron } from "@/lib/electron";
import { type Doc } from "@cmux/convex/dataModel";
import { api } from "@cmux/convex/api";
import { useQuery, useMutation } from "convex/react";
import type { LinkProps } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { Home, Plus, Server, Settings } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  type ComponentType,
  type CSSProperties,
} from "react";
import CmuxLogo from "./logo/cmux-logo";
import { SidebarNavLink } from "./sidebar/SidebarNavLink";
import { SidebarPullRequestList } from "./sidebar/SidebarPullRequestList";
import { SidebarSectionLink } from "./sidebar/SidebarSectionLink";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SidebarProps {
  tasks: Doc<"tasks">[] | undefined;
  teamSlugOrId: string;
}

interface SidebarNavItem {
  label: string;
  to: LinkProps["to"];
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  search?: LinkProps["search"];
  exact?: boolean;
}

// Sortable wrapper for TaskTree
function SortableTaskTree({
  task,
  defaultExpanded,
  teamSlugOrId,
}: {
  task: Doc<"tasks">;
  defaultExpanded: boolean;
  teamSlugOrId: string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TaskTree
        task={task}
        defaultExpanded={defaultExpanded}
        teamSlugOrId={teamSlugOrId}
      />
    </div>
  );
}

const navItems: SidebarNavItem[] = [
  {
    label: "Home",
    to: "/$teamSlugOrId/dashboard",
    exact: true,
    icon: Home,
  },
  {
    label: "Environments",
    to: "/$teamSlugOrId/environments",
    search: {
      step: undefined,
      selectedRepos: undefined,
      connectionLogin: undefined,
      repoSearch: undefined,
      instanceId: undefined,
    },
    exact: true,
    icon: Server,
  },
  {
    label: "Settings",
    to: "/$teamSlugOrId/settings",
    exact: true,
    icon: Settings,
  },
];

export function Sidebar({ tasks, teamSlugOrId }: SidebarProps) {
  const DEFAULT_WIDTH = 256;
  const MIN_WIDTH = 240;
  const MAX_WIDTH = 600;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const containerLeftRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const [width, setWidth] = useState<number>(() => {
    const stored = localStorage.getItem("sidebarWidth");
    const parsed = stored ? Number.parseInt(stored, 10) : DEFAULT_WIDTH;
    if (Number.isNaN(parsed)) return DEFAULT_WIDTH;
    return Math.min(Math.max(parsed, MIN_WIDTH), MAX_WIDTH);
  });
  const [isResizing, setIsResizing] = useState(false);
  const [isHidden, setIsHidden] = useState(() => {
    const stored = localStorage.getItem("sidebarHidden");
    return stored === "true";
  });

  const { expandTaskIds } = useExpandTasks();

  // Fetch pinned items
  const pinnedData = useQuery(api.tasks.getPinned, { teamSlugOrId });

  // Mutation to update task order
  const updateOrder = useMutation(api.tasks.updateOrder);

  // Sort tasks by order field
  const sortedTasks = useMemo(() => {
    if (!tasks) return [];
    const nonPinned = tasks.filter((task) => !task.pinned);
    return [...nonPinned].sort((a, b) => {
      const orderA = a.order ?? a.createdAt ?? 0;
      const orderB = b.order ?? b.createdAt ?? 0;
      return orderA - orderB;
    });
  }, [tasks]);

  // Setup drag sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required to start drag
      },
    })
  );

  // Handle drag end
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (!over || active.id === over.id) return;

      const oldIndex = sortedTasks.findIndex((t) => t._id === active.id);
      const newIndex = sortedTasks.findIndex((t) => t._id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      // Reorder locally for immediate feedback
      const reordered = [...sortedTasks];
      const [moved] = reordered.splice(oldIndex, 1);
      reordered.splice(newIndex, 0, moved);

      // Update order in database
      const taskOrders = reordered.map((task, index) => ({
        id: task._id,
        order: index,
      }));

      updateOrder({ teamSlugOrId, taskOrders });
    },
    [sortedTasks, teamSlugOrId, updateOrder]
  );

  useEffect(() => {
    localStorage.setItem("sidebarWidth", String(width));
  }, [width]);

  useEffect(() => {
    localStorage.setItem("sidebarHidden", String(isHidden));
  }, [isHidden]);

  // Keyboard shortcut to toggle sidebar (Ctrl+Shift+S)
  useEffect(() => {
    if (isElectron && window.cmux?.on) {
      const off = window.cmux.on("shortcut:sidebar-toggle", () => {
        setIsHidden((prev) => !prev);
      });
      return () => {
        if (typeof off === "function") off();
      };
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.ctrlKey &&
        e.shiftKey &&
        (e.code === "KeyS" || e.key.toLowerCase() === "s")
      ) {
        e.preventDefault();
        setIsHidden((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Listen for storage events from command bar (sidebar visibility sync)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "sidebarHidden" && e.newValue !== null) {
        setIsHidden(e.newValue === "true");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const onMouseMove = useCallback((e: MouseEvent) => {
    // Batch width updates to once per animation frame to reduce layout thrash
    if (rafIdRef.current != null) return;
    rafIdRef.current = window.requestAnimationFrame(() => {
      rafIdRef.current = null;
      const containerLeft = containerLeftRef.current;
      const clientX = e.clientX;
      const newWidth = Math.min(
        Math.max(clientX - containerLeft, MIN_WIDTH),
        MAX_WIDTH
      );
      setWidth(newWidth);
    });
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
    document.body.style.cursor = "";
    document.body.classList.remove("select-none");
    document.body.classList.remove("cmux-sidebar-resizing");
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    // Restore iframe pointer events
    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const el of iframes) {
      if (el instanceof HTMLIFrameElement) {
        const prev = el.dataset.prevPointerEvents;
        if (prev !== undefined) {
          if (prev === "__unset__") {
            el.style.removeProperty("pointer-events");
          } else {
            el.style.pointerEvents = prev;
          }
          delete el.dataset.prevPointerEvents;
        } else {
          // Fallback to clearing
          el.style.removeProperty("pointer-events");
        }
      }
    }
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", stopResizing);
  }, [onMouseMove]);

  const startResizing = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsResizing(true);
      document.body.style.cursor = "col-resize";
      document.body.classList.add("select-none");
      document.body.classList.add("cmux-sidebar-resizing");
      // Snapshot the container's left position so we don't force layout on every move
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        containerLeftRef.current = rect.left;
      }
      // Disable pointer events on all iframes so dragging works over them
      const iframes = Array.from(document.querySelectorAll("iframe"));
      for (const el of iframes) {
        if (el instanceof HTMLIFrameElement) {
          const current = el.style.pointerEvents;
          el.dataset.prevPointerEvents = current ? current : "__unset__";
          el.style.pointerEvents = "none";
        }
      }
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", stopResizing);
    },
    [onMouseMove, stopResizing]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [onMouseMove, stopResizing]);

  const resetWidth = useCallback(() => setWidth(DEFAULT_WIDTH), []);

  return (
    <div
      ref={containerRef}
      className="relative bg-neutral-50 dark:bg-black flex flex-col shrink-0 h-dvh grow pr-1"
      style={{
        display: isHidden ? "none" : "flex",
        width: `${width}px`,
        minWidth: `${width}px`,
        maxWidth: `${width}px`,
        userSelect: isResizing ? ("none" as const) : undefined,
      }}
    >
      <div
        className={`h-[38px] flex items-center pr-1.5 shrink-0 ${isElectron ? "" : "pl-3"}`}
        style={{ WebkitAppRegion: "drag" } as CSSProperties}
      >
        {isElectron && <div className="w-[80px]"></div>}
        <Link
          to="/$teamSlugOrId/dashboard"
          params={{ teamSlugOrId }}
          activeOptions={{ exact: true }}
          className="flex items-center gap-2 select-none cursor-pointer"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          {/* <Terminals */}
          <CmuxLogo height={32} />
        </Link>
        <div className="grow"></div>
        <Link
          to="/$teamSlugOrId/dashboard"
          params={{ teamSlugOrId }}
          activeOptions={{ exact: true }}
          className="w-[25px] h-[25px] border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-lg flex items-center justify-center transition-colors cursor-default"
          title="New task"
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        >
          <Plus
            className="w-4 h-4 text-neutral-700 dark:text-neutral-300"
            aria-hidden="true"
          />
        </Link>
      </div>
      <nav className="grow flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto pb-8">
          <ul className="flex flex-col gap-px">
            {navItems.map((item) => (
              <li key={item.label}>
                <SidebarNavLink
                  to={item.to}
                  params={{ teamSlugOrId }}
                  search={item.search}
                  icon={item.icon}
                  exact={item.exact}
                  label={item.label}
                />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-col">
            <SidebarSectionLink
              to="/$teamSlugOrId/prs"
              params={{ teamSlugOrId }}
              exact
            >
              Pull requests
            </SidebarSectionLink>
            <div className="ml-2 pt-px">
              <SidebarPullRequestList teamSlugOrId={teamSlugOrId} />
            </div>
          </div>

          <div className="mt-2 flex flex-col gap-0.5">
            <SidebarSectionLink
              to="/$teamSlugOrId/workspaces"
              params={{ teamSlugOrId }}
              exact
            >
              Workspaces
            </SidebarSectionLink>
          </div>

          <div className="ml-2 pt-px">
            <div className="space-y-px">
              {tasks === undefined ? (
                <TaskTreeSkeleton count={5} />
              ) : tasks && tasks.length > 0 ? (
                <>
                  {/* Pinned items at the top */}
                  {pinnedData && pinnedData.length > 0 && (
                    <>
                      {pinnedData.map((task) => (
                        <TaskTree
                          key={task._id}
                          task={task}
                          defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                          teamSlugOrId={teamSlugOrId}
                        />
                      ))}
                      {/* Horizontal divider after pinned items */}
                      <hr className="mx-2 border-t border-neutral-200 dark:border-neutral-800" />
                    </>
                  )}
                  {/* Regular (non-pinned) tasks with drag and drop */}
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={sortedTasks.map((t) => t._id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {sortedTasks.map((task) => (
                        <SortableTaskTree
                          key={task._id}
                          task={task}
                          defaultExpanded={expandTaskIds?.includes(task._id) ?? false}
                          teamSlugOrId={teamSlugOrId}
                        />
                      ))}
                    </SortableContext>
                  </DndContext>
                </>
              ) : (
                <p className="pl-2 pr-3 py-1.5 text-xs text-neutral-500 dark:text-neutral-400 select-none">
                  No recent tasks
                </p>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        onMouseDown={startResizing}
        onDoubleClick={resetWidth}
        className="absolute top-0 right-0 h-full cursor-col-resize"
        style={
          {
            // Invisible, but with a comfortable hit area
            width: "14px",
            transform: "translateX(7px)",
            // marginRight: "-5px",
            background: "transparent",
            // background: "red",
            zIndex: "var(--z-sidebar-resize-handle)",
          } as CSSProperties
        }
      />
    </div>
  );
}
