import { api } from "@cmux/convex/api";
import type { Id } from "@cmux/convex/dataModel";
import { useMutation } from "convex/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

interface UseConversationRenameOptions {
  conversationId: Id<"conversations"> | null;
  teamSlugOrId: string;
  currentText: string;
  canRename: boolean;
}

export function useConversationRename({
  conversationId,
  teamSlugOrId,
  currentText,
  canRename,
}: UseConversationRenameOptions) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(currentText);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [isRenamePending, setIsRenamePending] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRenameFocusFrame = useRef<number | null>(null);
  const renameInputHasFocusedRef = useRef(false);

  const renameMutation = useMutation(api.conversations.rename).withOptimisticUpdate(
    (localStore, args) => {
      const queries = localStore.getAllQueries(
        api.conversations.listPagedWithLatest
      );
      for (const { args: queryArgs, value } of queries) {
        if (!value) {
          continue;
        }
        const nextPage = value.page.map((entry) => {
          if (entry.conversation._id !== args.conversationId) {
            return entry;
          }
          return {
            ...entry,
            title: args.title,
            conversation: {
              ...entry.conversation,
              title: args.title,
            },
          };
        });
        localStore.setQuery(api.conversations.listPagedWithLatest, queryArgs, {
          ...value,
          page: nextPage,
        });
      }

      const detailQueries = localStore.getAllQueries(api.conversations.getDetail);
      for (const { args: queryArgs, value } of detailQueries) {
        if (!value || !value.conversation) {
          continue;
        }
        if (value.conversation._id !== args.conversationId) {
          continue;
        }
        localStore.setQuery(api.conversations.getDetail, queryArgs, {
          ...value,
          conversation: {
            ...value.conversation,
            title: args.title,
          },
        });
      }

      const byIdQueries = localStore.getAllQueries(api.conversations.getById);
      for (const { args: queryArgs, value } of byIdQueries) {
        if (!value || value._id !== args.conversationId) {
          continue;
        }
        localStore.setQuery(api.conversations.getById, queryArgs, {
          ...value,
          title: args.title,
        });
      }
    }
  );

  const focusRenameInput = useCallback(() => {
    if (typeof window === "undefined") {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
      return;
    }
    if (pendingRenameFocusFrame.current !== null) {
      window.cancelAnimationFrame(pendingRenameFocusFrame.current);
    }
    pendingRenameFocusFrame.current = window.requestAnimationFrame(() => {
      pendingRenameFocusFrame.current = null;
      const input = renameInputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      input.select();
    });
  }, []);

  useEffect(
    () => () => {
      if (pendingRenameFocusFrame.current !== null) {
        window.cancelAnimationFrame(pendingRenameFocusFrame.current);
        pendingRenameFocusFrame.current = null;
      }
    },
    []
  );

  useEffect(() => {
    if (!isRenaming) {
      setRenameValue(currentText);
    }
  }, [isRenaming, currentText]);

  const handleRenameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setRenameValue(event.target.value);
      if (renameError) {
        setRenameError(null);
      }
    },
    [renameError]
  );

  const handleRenameCancel = useCallback(() => {
    setRenameValue(currentText);
    setRenameError(null);
    setIsRenaming(false);
  }, [currentText]);

  const handleRenameSubmit = useCallback(async () => {
    if (!canRename || !conversationId) {
      setIsRenaming(false);
      return;
    }
    if (isRenamePending) {
      return;
    }
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError("Conversation title is required.");
      renameInputRef.current?.focus();
      return;
    }
    const current = currentText.trim();
    if (trimmed === current) {
      setIsRenaming(false);
      setRenameError(null);
      return;
    }
    setIsRenamePending(true);
    try {
      await renameMutation({
        teamSlugOrId,
        conversationId,
        title: trimmed,
      });
      setIsRenaming(false);
      setRenameError(null);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to rename conversation.";
      setRenameError(message);
      toast.error(message);
      renameInputRef.current?.focus();
    } finally {
      setIsRenamePending(false);
    }
  }, [
    canRename,
    conversationId,
    currentText,
    isRenamePending,
    renameMutation,
    renameValue,
    teamSlugOrId,
  ]);

  const handleRenameKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void handleRenameSubmit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        handleRenameCancel();
      }
    },
    [handleRenameCancel, handleRenameSubmit]
  );

  const handleRenameBlur = useCallback(() => {
    if (!renameInputHasFocusedRef.current) {
      focusRenameInput();
      return;
    }
    void handleRenameSubmit();
  }, [focusRenameInput, handleRenameSubmit]);

  const handleRenameFocus = useCallback(
    (event: FocusEvent<HTMLInputElement>) => {
      renameInputHasFocusedRef.current = true;
      event.currentTarget.select();
    },
    []
  );

  const handleStartRenaming = useCallback(() => {
    if (!canRename) {
      return;
    }
    flushSync(() => {
      setRenameValue(currentText);
      setRenameError(null);
      setIsRenaming(true);
    });
    renameInputHasFocusedRef.current = false;
    focusRenameInput();
  }, [canRename, focusRenameInput, currentText]);

  return {
    isRenaming,
    renameValue,
    renameError,
    isRenamePending,
    renameInputRef,
    handleRenameChange,
    handleRenameCancel,
    handleRenameSubmit,
    handleRenameKeyDown,
    handleRenameBlur,
    handleRenameFocus,
    handleStartRenaming,
  };
}
