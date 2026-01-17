import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConvex } from "convex/react";
import { ArrowLeft, ChevronDown, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_layout/t/$teamSlugOrId/settings")({
  component: ConversationSettingsPage,
});

type TitleStyle = "sentence" | "lowercase" | "title";

const TITLE_STYLE_OPTIONS: { value: TitleStyle; label: string; example: string }[] = [
  {
    value: "sentence",
    label: "Sentence case",
    example: "Fix large image upload bug",
  },
  {
    value: "lowercase",
    label: "Lowercase",
    example: "fix large image upload bug",
  },
  {
    value: "title",
    label: "Title Case",
    example: "Fix Large Image Upload Bug",
  },
];

function ConversationSettingsPage() {
  const { teamSlugOrId } = Route.useParams();
  const convex = useConvex();

  const { data: workspaceSettings } = useQuery(
    convexQuery(api.workspaceSettings.get, { teamSlugOrId })
  );

  const [titleStyle, setTitleStyle] = useState<TitleStyle>("sentence");
  const [originalTitleStyle, setOriginalTitleStyle] = useState<TitleStyle>("sentence");
  const [customPrompt, setCustomPrompt] = useState("");
  const [originalCustomPrompt, setOriginalCustomPrompt] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (workspaceSettings === undefined) return;

    const style = workspaceSettings?.conversationTitleStyle ?? "sentence";
    setTitleStyle(style);
    setOriginalTitleStyle(style);

    const prompt = workspaceSettings?.conversationTitleCustomPrompt ?? "";
    setCustomPrompt(prompt);
    setOriginalCustomPrompt(prompt);
    if (prompt) {
      setShowAdvanced(true);
    }
  }, [workspaceSettings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: {
      conversationTitleStyle?: TitleStyle;
      conversationTitleCustomPrompt?: string;
    }) => {
      return await convex.mutation(api.workspaceSettings.update, {
        teamSlugOrId,
        ...data,
      });
    },
  });

  const hasChanges =
    titleStyle !== originalTitleStyle || customPrompt !== originalCustomPrompt;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await updateSettingsMutation.mutateAsync({
        conversationTitleStyle: titleStyle,
        conversationTitleCustomPrompt: customPrompt || undefined,
      });
      setOriginalTitleStyle(titleStyle);
      setOriginalCustomPrompt(customPrompt);
      toast.success("Settings saved");
    } catch (error) {
      console.error("Failed to save settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-neutral-50 dark:bg-neutral-950">
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 py-8">
          {/* Back link */}
          <Link
            to="/t/$teamSlugOrId"
            params={{ teamSlugOrId }}
            className="mb-6 inline-flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to conversations
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-100">
              Conversation Settings
            </h1>
            <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
              Configure how conversations are displayed and generated
            </p>
          </div>

          {/* Settings Sections */}
          <div className="space-y-6">
            {/* Title Generation Section */}
            <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
                <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Title Generation
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Customize how conversation titles are generated from your first message
                </p>
              </div>

              <div className="p-5 space-y-5">
                {/* Style Selector */}
                <div>
                  <label
                    htmlFor="titleStyle"
                    className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                  >
                    Title Style
                  </label>
                  <div className="relative">
                    <select
                      id="titleStyle"
                      value={titleStyle}
                      onChange={(e) => setTitleStyle(e.target.value as TitleStyle)}
                      className="w-full appearance-none rounded-lg border border-neutral-300 bg-white px-3 py-2 pr-10 text-sm text-neutral-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    >
                      {TITLE_STYLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
                      aria-hidden
                    />
                  </div>
                  {/* Preview */}
                  <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800/50">
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-1">Preview</p>
                    <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                      {TITLE_STYLE_OPTIONS.find((o) => o.value === titleStyle)?.example}
                    </p>
                  </div>
                </div>

                {/* Advanced Toggle */}
                <div className="border-t border-neutral-200 pt-5 dark:border-neutral-800">
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-200"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${
                        showAdvanced ? "rotate-180" : ""
                      }`}
                    />
                    Advanced options
                  </button>

                  {showAdvanced && (
                    <div className="mt-4 space-y-3">
                      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-950/30">
                        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-500" />
                        <p className="text-xs text-amber-800 dark:text-amber-200">
                          Custom prompts override the style preset above. Leave empty to use the selected style.
                        </p>
                      </div>
                      <div>
                        <label
                          htmlFor="customPrompt"
                          className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
                        >
                          Custom System Prompt
                        </label>
                        <textarea
                          id="customPrompt"
                          value={customPrompt}
                          onChange={(e) => setCustomPrompt(e.target.value)}
                          rows={5}
                          placeholder="You generate ultra-brief titles (3-8 words) for coding conversations...."
                          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 placeholder:text-neutral-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                        />
                        <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                          The AI will use this prompt to generate conversation titles from the first message.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Conversation Defaults Section (placeholder for future settings) */}
            <section className="rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
              <div className="border-b border-neutral-200 px-5 py-4 dark:border-neutral-800">
                <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  Conversation Defaults
                </h2>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Default settings for new conversations
                </p>
              </div>

              <div className="p-5">
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  More settings coming soon.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Sticky Save Footer */}
      <div className="border-t border-neutral-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:border-neutral-800 dark:bg-neutral-900/80 dark:supports-[backdrop-filter]:bg-neutral-900/60">
        <div className="mx-auto max-w-2xl px-6 py-3 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={!hasChanges || isSaving}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-neutral-900 ${
              !hasChanges || isSaving
                ? "cursor-not-allowed bg-neutral-200 text-neutral-400 opacity-50 dark:bg-neutral-800 dark:text-neutral-500"
                : "bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            }`}
          >
            {isSaving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
