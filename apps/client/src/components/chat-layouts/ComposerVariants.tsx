import { ImagePlus, Loader2, ArrowUp } from "lucide-react";
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
import { forwardRef, useEffect, useRef } from "react";

type PendingImage = {
  id: string;
  file: File;
  previewUrl: string;
};

type ComposerProps = {
  text: string;
  setText: (value: string) => void;
  attachments: PendingImage[];
  setAttachments: Dispatch<SetStateAction<PendingImage[]>>;
  onAttachFiles: (files: FileList | null) => void;
  onSend: () => void;
  isSending: boolean;
  isLocked: boolean;
  autoFocusKey: string;
  statusMessage: string | null;
};

export function ComposerVariant({
  text,
  setText,
  attachments,
  setAttachments,
  onAttachFiles,
  onSend,
  isSending,
  isLocked,
  autoFocusKey,
  statusMessage,
}: ComposerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const isComposingRef = useRef(false);

  const canSend = !isLocked && !isSending && (text.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    if (!textAreaRef.current) return;
    const handle = requestAnimationFrame(() => {
      textAreaRef.current?.focus();
    });
    return () => cancelAnimationFrame(handle);
  }, [autoFocusKey]);

  useEffect(() => {
    const textArea = textAreaRef.current;
    if (!textArea) return;
    textArea.style.height = "0px";
    textArea.style.height = `${textArea.scrollHeight}px`;
  }, [text]);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !isComposingRef.current) {
      event.preventDefault();
      if (canSend) onSend();
    }
  };

  return (
    <div>
      {statusMessage && (
        <div className="mb-2 text-[11px] text-neutral-400 dark:text-neutral-500">{statusMessage}</div>
      )}
      <AttachmentPreview attachments={attachments} setAttachments={setAttachments} />
      <div className="rounded-lg border border-neutral-200 bg-neutral-50 pl-3 pt-3 pr-2 pb-2 dark:border-neutral-700 dark:bg-neutral-800">
        <textarea
          ref={textAreaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          rows={2}
          placeholder="Type '/' for commands, or just start typing..."
          className="w-full resize-none bg-transparent text-sm text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500 max-h-32 overflow-y-auto"
        />
        <div className="flex items-center justify-between mt-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="text-neutral-400 hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300 transition"
            disabled={isLocked}
          >
            <ImagePlus className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            className="flex h-7 w-7 items-center justify-center rounded-md bg-blue-500 text-white transition hover:bg-blue-600 disabled:opacity-40"
          >
            {isSending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            )}
          </button>
        </div>
      </div>
      <HiddenFileInput ref={fileInputRef} onAttachFiles={onAttachFiles} />
    </div>
  );
}

function AttachmentPreview({
  attachments,
  setAttachments,
}: {
  attachments: PendingImage[];
  setAttachments: Dispatch<SetStateAction<PendingImage[]>>;
}) {
  if (attachments.length === 0) return null;

  const handleRemove = (id: string) => {
    setAttachments((current) =>
      current.filter((a) => {
        if (a.id === id) {
          URL.revokeObjectURL(a.previewUrl);
          return false;
        }
        return true;
      })
    );
  };

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className="relative h-16 w-16 overflow-hidden rounded-lg border border-neutral-200 dark:border-neutral-700"
        >
          <img
            src={attachment.previewUrl}
            alt={attachment.file.name}
            className="h-full w-full object-cover"
          />
          <button
            type="button"
            onClick={() => handleRemove(attachment.id)}
            className="absolute right-0.5 top-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-medium text-white hover:bg-black/90"
          >
            x
          </button>
        </div>
      ))}
    </div>
  );
}

const HiddenFileInput = forwardRef<
  HTMLInputElement,
  { onAttachFiles: (files: FileList | null) => void }
>(function HiddenFileInput({ onAttachFiles }, ref) {
  return (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={(e) => {
        onAttachFiles(e.target.files);
        if (e.currentTarget) {
          e.currentTarget.value = "";
        }
      }}
    />
  );
});
