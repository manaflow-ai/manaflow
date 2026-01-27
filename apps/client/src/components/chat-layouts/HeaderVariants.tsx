import clsx from "clsx";

type ConversationSandboxStatus =
  | "starting"
  | "running"
  | "paused"
  | "stopped"
  | "offline"
  | "error";

type PermissionMode = "manual" | "auto_allow_once" | "auto_allow_always";

type HeaderVariantProps = {
  providerName: string;
  cwd: string;
  modelLabel: string;
  sandbox: {
    status: ConversationSandboxStatus;
    sandboxUrl: string | null;
    lastActivityAt: number;
  } | null;
  showRawEvents: boolean;
  onToggleRawEvents: () => void;
  showTerminalPanel: boolean;
  onToggleTerminalPanel: () => void;
  permissionMode: PermissionMode;
  onPermissionModeChange: (mode: PermissionMode) => void;
};

export function HeaderVariant({
  providerName,
  cwd,
  modelLabel,
  sandbox,
  showRawEvents,
  onToggleRawEvents,
  showTerminalPanel,
  onToggleTerminalPanel,
  permissionMode,
  onPermissionModeChange,
}: HeaderVariantProps) {
  const status = sandbox?.status ?? "offline";
  const toggleButtonClass = (active: boolean) =>
    clsx(
      "rounded px-2 py-0.5 text-[10px] font-medium transition",
      active
        ? "bg-neutral-200 text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
        : "text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
    );

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-neutral-900 dark:text-neutral-100">
          {providerName}
        </span>
        <span className="text-neutral-300 dark:text-neutral-600">/</span>
        <span className="text-neutral-500 dark:text-neutral-400 truncate max-w-[180px]">
          {cwd}
        </span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          {modelLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <PermissionToggle
          mode={permissionMode}
          onChange={onPermissionModeChange}
        />
        <button
          type="button"
          onClick={onToggleRawEvents}
          className={toggleButtonClass(showRawEvents)}
        >
          Debug
        </button>
        <button
          type="button"
          onClick={onToggleTerminalPanel}
          className={toggleButtonClass(showTerminalPanel)}
        >
          Terminal
        </button>
        <SandboxDot status={status} />
      </div>
    </div>
  );
}

function PermissionToggle({
  mode,
  onChange,
}: {
  mode: PermissionMode;
  onChange: (mode: PermissionMode) => void;
}) {
  return (
    <div className="flex items-center rounded-full border border-neutral-200/70 p-0.5 text-[10px] font-medium dark:border-neutral-700">
      {(
        [
          { value: "auto_allow_always", label: "Auto" },
          { value: "manual", label: "Ask" },
        ] as const
      ).map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            "rounded-full px-2 py-0.5 transition",
            mode === option.value
              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
              : "text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function SandboxDot({ status }: { status: ConversationSandboxStatus }) {
  const color =
    status === "running"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-rose-500"
        : status === "paused"
          ? "bg-amber-500"
          : "bg-neutral-400";

  return <span className={clsx("h-2 w-2 rounded-full", color)} title={status} />;
}
