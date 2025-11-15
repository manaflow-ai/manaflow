import { Button } from "@/components/ui/button";
import { isElectron } from "@/lib/electron";
import { cn } from "@/lib/utils";
import * as Dialog from "@radix-ui/react-dialog";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

type QuitPromptPayload = {
  confirmOnQuit?: boolean;
};

const overlayClass =
  "fixed inset-0 bg-neutral-950/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:fade-in";
const contentClass = cn(
  "fixed left-1/2 top-1/2 w-[min(90vw,440px)] -translate-x-1/2 -translate-y-1/2",
  "rounded-xl border border-neutral-200 bg-white p-6 shadow-xl focus-visible:outline-none dark:border-neutral-800 dark:bg-neutral-900",
  "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:zoom-in data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out"
);

export function QuitConfirmationDialog() {
  const [open, setOpen] = useState(false);
  const [alwaysQuit, setAlwaysQuit] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const dismissingBecauseConfirm = useRef(false);
  const checkboxId = useId();

  useEffect(() => {
    if (!isElectron) return;
    const cmux = window.cmux;
    if (!cmux?.on) return;

    const unsubscribe = cmux.on("quit:prompt", (raw: unknown) => {
      const payload = (raw ?? {}) as QuitPromptPayload;
      const confirmOnQuit =
        typeof payload.confirmOnQuit === "boolean"
          ? payload.confirmOnQuit
          : true;

      dismissingBecauseConfirm.current = false;
      setIsSubmitting(false);
      setAlwaysQuit(!confirmOnQuit);
      setOpen(true);
    });

    return () => {
      try {
        unsubscribe?.();
      } catch {
        // ignore unsubscribe failures
      }
    };
  }, []);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      if (dismissingBecauseConfirm.current) {
        dismissingBecauseConfirm.current = false;
        return;
      }
      setIsSubmitting(false);
      void window.cmux?.quit?.cancelQuit();
    }
  }, []);

  const handleCheckboxChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const nextAlwaysQuit = event.target.checked;
      setAlwaysQuit(nextAlwaysQuit);
      void window.cmux?.quit?.setPreferences({
        confirmOnQuit: !nextAlwaysQuit,
      });
    },
    []
  );

  const handleCancel = useCallback(() => {
    dismissingBecauseConfirm.current = false;
    setOpen(false);
  }, []);

  const handleQuit = useCallback(async () => {
    if (isSubmitting) return;
    dismissingBecauseConfirm.current = true;
    setIsSubmitting(true);
    setOpen(false);
    try {
      await window.cmux?.quit?.confirmQuit();
    } catch (error) {
      console.error("Failed to confirm quit", error);
      dismissingBecauseConfirm.current = false;
      setIsSubmitting(false);
      setOpen(true);
    }
  }, [isSubmitting]);

  if (!isElectron) return null;

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClass} />
        <Dialog.Content className={contentClass} aria-describedby={`${checkboxId}-description`}>
          <Dialog.Title className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">
            Quit cmux?
          </Dialog.Title>
          <Dialog.Description
            id={`${checkboxId}-description`}
            className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400"
          >
            You’re about to close the app. Any background tasks keep running in
            the cloud. Do you want to quit?
          </Dialog.Description>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label
              htmlFor={checkboxId}
              className="flex items-center gap-3 text-sm text-neutral-700 dark:text-neutral-300"
            >
              <input
                id={checkboxId}
                name="quit-preference"
                type="checkbox"
                checked={alwaysQuit}
                onChange={handleCheckboxChange}
                className="size-4 rounded border border-neutral-300 text-primary shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-neutral-700 dark:bg-neutral-800"
              />
              <span>Always quit without asking</span>
            </label>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleQuit}
                disabled={isSubmitting}
              >
                Quit
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
