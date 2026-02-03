import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface LineCommentButtonProps {
  onClick: () => void;
  hasComments?: boolean;
  commentCount?: number;
  className?: string;
  size?: "sm" | "md";
}

export function LineCommentButton({
  onClick,
  hasComments = false,
  commentCount = 0,
  className,
  size = "sm",
}: LineCommentButtonProps) {
  const sizeClasses = size === "sm" ? "w-4 h-4" : "w-5 h-5";
  const iconClasses = size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5";

  if (hasComments && commentCount > 0) {
    // Show comment indicator
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            className={cn(
              "flex items-center justify-center rounded-full",
              "bg-blue-500 text-white",
              "hover:bg-blue-600 transition-colors",
              sizeClasses,
              className
            )}
            aria-label={`${commentCount} comment${commentCount !== 1 ? "s" : ""}`}
          >
            <span className="text-[10px] font-medium">{commentCount}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          {commentCount} comment{commentCount !== 1 ? "s" : ""}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Show add comment button
  return (
    <Tooltip delayDuration={0}>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={cn(
            "flex items-center justify-center rounded",
            "text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20",
            "opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity",
            sizeClasses,
            className
          )}
          aria-label="Add comment"
        >
          <Plus className={iconClasses} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="text-xs">
        Add comment
      </TooltipContent>
    </Tooltip>
  );
}

// Variant for gutter integration
export function GutterCommentButton({
  onClick,
  hasComments = false,
  commentCount = 0,
  isHovered = false,
  className,
}: {
  onClick: () => void;
  hasComments?: boolean;
  commentCount?: number;
  isHovered?: boolean;
  className?: string;
}) {
  // Always show if has comments
  if (hasComments && commentCount > 0) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className={cn(
          "inline-flex items-center justify-center w-4 h-4 rounded-full",
          "bg-blue-500 text-white text-[10px] font-medium",
          "hover:bg-blue-600 transition-colors",
          className
        )}
        title={`${commentCount} comment${commentCount !== 1 ? "s" : ""}`}
      >
        {commentCount}
      </button>
    );
  }

  // Show plus on hover
  if (!isHovered) {
    return <span className="inline-block w-4" aria-hidden="true" />;
  }

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "inline-flex items-center justify-center w-4 h-4 rounded",
        "text-blue-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30",
        "transition-colors",
        className
      )}
      title="Add comment"
    >
      <Plus className="w-3 h-3" />
    </button>
  );
}
