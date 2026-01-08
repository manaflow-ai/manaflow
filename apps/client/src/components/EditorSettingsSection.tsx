import { api } from "@cmux/convex/api";
import { convexQuery } from "@convex-dev/react-query";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useConvex } from "convex/react";
import { Plus, Trash2, HelpCircle, Copy, Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

// Copyable path component with auto-select and copy button
function CopyablePath({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(path);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <span className="inline-flex items-center gap-1">
      <code
        className="bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded cursor-pointer select-all"
        onClick={(e) => {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(e.currentTarget);
          selection?.removeAllRanges();
          selection?.addRange(range);
        }}
      >
        {path}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        className="p-0.5 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
        aria-label="Copy path"
      >
        {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  );
}

interface Snippet {
  name: string;
  content: string;
}

interface EditorSettingsSectionProps {
  teamSlugOrId: string;
  onDataChange?: (hasChanges: boolean) => void;
}

// File location documentation for different editors and platforms
const FILE_LOCATIONS = {
  vscode: {
    name: "VS Code",
    locations: {
      macOS: "~/Library/Application Support/Code/User/",
      Linux: "~/.config/Code/User/",
      Windows: "%APPDATA%\\Code\\User\\",
    },
    extensionCommand: "code --list-extensions",
  },
  cursor: {
    name: "Cursor",
    locations: {
      macOS: "~/Library/Application Support/Cursor/User/",
      Linux: "~/.config/Cursor/User/",
      Windows: "%APPDATA%\\Cursor\\User\\",
    },
    extensionCommand: "cursor --list-extensions",
  },
  windsurf: {
    name: "Windsurf",
    locations: {
      macOS: "~/Library/Application Support/Windsurf/User/",
      Linux: "~/.config/Windsurf/User/",
      Windows: "%APPDATA%\\Windsurf\\User\\",
    },
    extensionCommand: "windsurf --list-extensions",
  },
};

// Detect user's platform for showing relevant file paths
function getUserPlatform(): "macOS" | "Linux" | "Windows" {
  if (typeof navigator === "undefined") return "macOS";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "macOS";
  if (platform.includes("win")) return "Windows";
  return "Linux";
}

function getVSCodeUserPath(): string {
  const platform = getUserPlatform();
  return FILE_LOCATIONS.vscode.locations[platform];
}

export function EditorSettingsSection({
  teamSlugOrId,
  onDataChange,
}: EditorSettingsSectionProps) {
  const convex = useConvex();
  const [settingsJson, setSettingsJson] = useState("");
  const [keybindingsJson, setKeybindingsJson] = useState("");
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [extensions, setExtensions] = useState("");
  const [originalData, setOriginalData] = useState({
    settingsJson: "",
    keybindingsJson: "",
    snippets: [] as Snippet[],
    extensions: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Query existing settings
  const { data: existingSettings, refetch } = useQuery(
    convexQuery(api.userEditorSettings.get, { teamSlugOrId })
  );

  // Initialize form values when data loads
  useEffect(() => {
    if (existingSettings) {
      const settings = existingSettings.settingsJson ?? "";
      const keybindings = existingSettings.keybindingsJson ?? "";
      const snips = existingSettings.snippets ?? [];
      const exts = existingSettings.extensions ?? "";

      setSettingsJson(settings);
      setKeybindingsJson(keybindings);
      setSnippets(snips);
      setExtensions(exts);
      setOriginalData({
        settingsJson: settings,
        keybindingsJson: keybindings,
        snippets: snips,
        extensions: exts,
      });
    }
  }, [existingSettings]);

  // Check for changes
  const hasChanges = useCallback(() => {
    const snippetsChanged =
      JSON.stringify(snippets) !== JSON.stringify(originalData.snippets);
    return (
      settingsJson !== originalData.settingsJson ||
      keybindingsJson !== originalData.keybindingsJson ||
      snippetsChanged ||
      extensions !== originalData.extensions
    );
  }, [
    settingsJson,
    keybindingsJson,
    snippets,
    extensions,
    originalData,
  ]);

  // Notify parent of changes
  useEffect(() => {
    onDataChange?.(hasChanges());
  }, [hasChanges, onDataChange]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.userEditorSettings.upsert, {
        teamSlugOrId,
        settingsJson: settingsJson || undefined,
        keybindingsJson: keybindingsJson || undefined,
        snippets: snippets.length > 0 ? snippets : undefined,
        extensions: extensions || undefined,
      });
    },
    onSuccess: () => {
      setOriginalData({
        settingsJson,
        keybindingsJson,
        snippets,
        extensions,
      });
      toast.success("Editor settings saved");
      refetch();
    },
    onError: (error) => {
      toast.error("Failed to save editor settings");
      console.error("Error saving editor settings:", error);
    },
  });

  // Clear mutation
  const clearMutation = useMutation({
    mutationFn: async () => {
      await convex.mutation(api.userEditorSettings.clear, {
        teamSlugOrId,
      });
    },
    onSuccess: () => {
      setSettingsJson("");
      setKeybindingsJson("");
      setSnippets([]);
      setExtensions("");
      setOriginalData({
        settingsJson: "",
        keybindingsJson: "",
        snippets: [],
        extensions: "",
      });
      toast.success("Editor settings cleared");
      refetch();
    },
    onError: (error) => {
      toast.error("Failed to clear editor settings");
      console.error("Error clearing editor settings:", error);
    },
  });

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await saveMutation.mutateAsync();
    } finally {
      setIsSaving(false);
    }
  };

  const handleClear = async () => {
    if (!confirm("Are you sure you want to clear all editor settings?")) {
      return;
    }
    await clearMutation.mutateAsync();
  };

  const addSnippet = () => {
    setSnippets([...snippets, { name: "", content: "" }]);
  };

  const updateSnippet = (index: number, field: "name" | "content", value: string) => {
    const updated = [...snippets];
    updated[index] = { ...updated[index], [field]: value };
    setSnippets(updated);
  };

  const removeSnippet = (index: number) => {
    setSnippets(snippets.filter((_, i) => i !== index));
  };

  const hasAnySettings =
    originalData.settingsJson ||
    originalData.keybindingsJson ||
    originalData.snippets.length > 0 ||
    originalData.extensions;

  return (
    <div className="bg-white dark:bg-neutral-950 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
          Editor Settings Sync
        </h2>
        <button
          type="button"
          onClick={() => setShowHelp(!showHelp)}
          className="p-1 text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300"
          aria-label="Show help"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Help section */}
        {showHelp && (
          <div className="p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h3 className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-3">
              Where to find your settings files
            </h3>
            <div className="space-y-4 text-xs">
              {Object.entries(FILE_LOCATIONS).map(([key, editor]) => (
                <div key={key}>
                  <p className="font-medium text-blue-800 dark:text-blue-200 mb-1">
                    {editor.name}
                  </p>
                  <ul className="space-y-1 text-blue-700 dark:text-blue-300">
                    {Object.entries(editor.locations).map(([os, path]) => (
                      <li key={os}>
                        <span className="font-medium">{os}:</span>{" "}
                        <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                          {path}
                        </code>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-blue-600 dark:text-blue-400">
                    Extensions:{" "}
                    <code className="bg-blue-100 dark:bg-blue-900/50 px-1 rounded">
                      {editor.extensionCommand}
                    </code>
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-blue-600 dark:text-blue-400">
              Copy the contents of <code>settings.json</code>, <code>keybindings.json</code>,
              and files from the <code>snippets/</code> folder.
            </p>
          </div>
        )}

        {/* Description */}
        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          Upload your VS Code, Cursor, or Windsurf settings to sync them to cloud
          sandboxes. When configured, these settings <strong>override</strong> auto-detected
          local settings. Click the help icon for paths on other platforms.
        </p>

        {/* Settings JSON */}
        <div>
          <label
            htmlFor="settingsJson"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            settings.json
          </label>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
            <CopyablePath path={`${getVSCodeUserPath()}settings.json`} />
          </p>
          <textarea
            id="settingsJson"
            value={settingsJson}
            onChange={(e) => setSettingsJson(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-mono text-xs resize-y"
            placeholder='{ "workbench.colorTheme": "Monokai", ... }'
          />
        </div>

        {/* Keybindings JSON */}
        <div>
          <label
            htmlFor="keybindingsJson"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1"
          >
            keybindings.json
          </label>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
            <CopyablePath path={`${getVSCodeUserPath()}keybindings.json`} />
          </p>
          <textarea
            id="keybindingsJson"
            value={keybindingsJson}
            onChange={(e) => setKeybindingsJson(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-mono text-xs resize-y"
            placeholder='[{ "key": "ctrl+shift+p", "command": "workbench.action.showCommands" }]'
          />
        </div>

        {/* Snippets */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
              Snippets
            </label>
            <button
              type="button"
              onClick={addSnippet}
              className="flex items-center gap-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              <Plus className="w-3 h-3" />
              Add snippet file
            </button>
          </div>
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mb-2">
            <CopyablePath path={`${getVSCodeUserPath()}snippets/`} />
          </p>
          {snippets.length === 0 ? (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              No snippet files added. Click "Add snippet file" to add one.
            </p>
          ) : (
            <div className="space-y-3">
              {snippets.map((snippet, index) => (
                <div
                  key={index}
                  className="border border-neutral-200 dark:border-neutral-800 rounded-lg p-3"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="text"
                      value={snippet.name}
                      onChange={(e) => updateSnippet(index, "name", e.target.value)}
                      placeholder="filename.json (e.g., javascript.json)"
                      className="flex-1 px-2 py-1 text-xs border border-neutral-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100"
                    />
                    <button
                      type="button"
                      onClick={() => removeSnippet(index)}
                      className="p-1 text-neutral-500 hover:text-red-500"
                      aria-label="Remove snippet"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <textarea
                    value={snippet.content}
                    onChange={(e) => updateSnippet(index, "content", e.target.value)}
                    rows={3}
                    placeholder='{ "Print to console": { "prefix": "log", "body": ["console.log($1)"], "description": "Log output" } }'
                    className="w-full px-2 py-1 text-xs border border-neutral-300 dark:border-neutral-700 rounded bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-mono resize-y"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Extensions */}
        <div>
          <label
            htmlFor="extensions"
            className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2"
          >
            Extensions (one per line)
          </label>
          <textarea
            id="extensions"
            value={extensions}
            onChange={(e) => setExtensions(e.target.value)}
            rows={6}
            className="w-full px-3 py-2 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 font-mono text-xs resize-y"
            placeholder={`dbaeumer.vscode-eslint
esbenp.prettier-vscode
bradlc.vscode-tailwindcss`}
          />
          <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            Run <code className="bg-neutral-100 dark:bg-neutral-800 px-1 rounded select-all">code --list-extensions</code> to get your extension list.
          </p>
        </div>
      </div>

      {/* Footer with Save/Clear buttons */}
      <div className="px-4 py-3 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasAnySettings || clearMutation.isPending}
          className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Clear All
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges() || isSaving}
          className="px-3 py-1.5 text-sm rounded-md bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
