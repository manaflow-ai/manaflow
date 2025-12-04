import clsx from "clsx";
import { X } from "lucide-react";
import { memo, useCallback, useState } from "react";

export interface ImageData {
  src: string;
  fileName?: string;
  altText: string;
  nodeKey: string;
}

interface ImagePillboxProps {
  images: ImageData[];
  onRemove: (nodeKey: string) => void;
}

interface ImagePreviewModalProps {
  image: ImageData;
  onClose: () => void;
}

function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Image preview"
    >
      <div
        className="relative max-w-[90vw] max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className={clsx(
            "absolute -top-3 -right-3 z-10",
            "inline-flex h-7 w-7 items-center justify-center rounded-full",
            "bg-neutral-800 text-white",
            "hover:bg-neutral-700",
            "transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          )}
          aria-label="Close preview"
        >
          <X className="h-4 w-4" />
        </button>
        <img
          src={image.src}
          alt={image.altText}
          className="max-w-full max-h-[85vh] rounded-lg shadow-2xl"
        />
        {image.fileName && (
          <div className="mt-2 text-center text-sm text-white/80">
            {image.fileName}
          </div>
        )}
      </div>
    </div>
  );
}

function ImagePillboxItem({
  image,
  onRemove,
  onClick,
}: {
  image: ImageData;
  onRemove: (nodeKey: string) => void;
  onClick: () => void;
}) {
  const displayName = image.fileName || image.altText || "Image";
  const truncatedName =
    displayName.length > 20
      ? displayName.slice(0, 17) + "..."
      : displayName;

  return (
    <div
      className={clsx(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-lg",
        "bg-neutral-200/70 dark:bg-neutral-800/80",
        "pl-1 pr-1.5 py-1",
        "text-[11px] text-neutral-700 dark:text-neutral-200",
        "transition-colors",
        "hover:bg-neutral-200 dark:hover:bg-neutral-700/80",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60"
      )}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label={`Preview ${displayName}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onRemove(image.nodeKey);
        }}
        className={clsx(
          "inline-flex h-4 w-4 items-center justify-center rounded-full",
          "transition-colors",
          "hover:bg-neutral-400/30 dark:hover:bg-neutral-500/80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/60"
        )}
        aria-label={`Remove ${displayName}`}
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
      <div className="h-6 w-6 overflow-hidden rounded flex-shrink-0">
        <img
          src={image.src}
          alt={image.altText}
          className="h-full w-full object-cover"
        />
      </div>
      <span className="max-w-[100px] truncate text-left select-none">
        {truncatedName}
      </span>
    </div>
  );
}

export const ImagePillbox = memo(function ImagePillbox({
  images,
  onRemove,
}: ImagePillboxProps) {
  const [previewImage, setPreviewImage] = useState<ImageData | null>(null);

  const handlePreviewClose = useCallback(() => {
    setPreviewImage(null);
  }, []);

  if (images.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex flex-wrap gap-1">
        {images.map((image) => (
          <ImagePillboxItem
            key={image.nodeKey}
            image={image}
            onRemove={onRemove}
            onClick={() => setPreviewImage(image)}
          />
        ))}
      </div>
      {previewImage && (
        <ImagePreviewModal image={previewImage} onClose={handlePreviewClose} />
      )}
    </>
  );
});
