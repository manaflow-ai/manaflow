import { Button } from "@/components/ui/button";
import { ArrowRight, CheckCircle2, Circle, Eye, EyeOff, ExternalLink } from "lucide-react";
import { AGENT_CONFIGS, type AgentConfig } from "@cmux/shared/agentConfig";
import { useCallback, useEffect, useState } from "react";
import { api } from "@cmux/convex/api";
import { useConvex } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { convexQuery } from "@convex-dev/react-query";
import { toast } from "sonner";

interface AgentConfigStepProps {
  onNext: () => void;
  onSkip: () => void;
  teamSlugOrId: string;
}

const DEFAULT_AGENTS = [
  "claude/sonnet-4.5",
  "claude/opus-4.1",
  "codex/gpt-5-codex-high",
];

export function AgentConfigStep({ onNext, onSkip, teamSlugOrId }: AgentConfigStepProps) {
  const convex = useConvex();
  const [selectedAgents] = useState<string[]>(
    DEFAULT_AGENTS.filter((agent) =>
      AGENT_CONFIGS.some((config) => config.name === agent)
    )
  );
  const [apiKeyValues, setApiKeyValues] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Get all required API keys from agent configs
  const apiKeys = Array.from(
    new Map(
      AGENT_CONFIGS.flatMap((config: AgentConfig) => config.apiKeys || []).map(
        (key) => [key.envVar, key]
      )
    ).values()
  );

  // Query existing API keys
  const { data: existingKeys } = useQuery(
    convexQuery(api.apiKeys.getAll, { teamSlugOrId })
  );

  // Initialize API key values from existing keys
  useEffect(() => {
    if (existingKeys) {
      const values: Record<string, string> = {};
      existingKeys.forEach((key) => {
        values[key.envVar] = key.value;
      });
      setApiKeyValues(values);
    }
  }, [existingKeys]);

  const handleApiKeyChange = (envVar: string, value: string) => {
    setApiKeyValues((prev) => ({ ...prev, [envVar]: value }));
  };

  const toggleShowKey = (envVar: string) => {
    setShowKeys((prev) => ({ ...prev, [envVar]: !prev[envVar] }));
  };

  const toggleExpandKey = (envVar: string) => {
    setExpandedKeys((prev) => ({ ...prev, [envVar]: !prev[envVar] }));
  };

  const handleContinue = useCallback(async () => {
    // Save any changed API keys
    setIsSaving(true);
    try {
      const savePromises = apiKeys.map(async (key) => {
        const value = apiKeyValues[key.envVar] || "";
        const existingValue = existingKeys?.find(k => k.envVar === key.envVar)?.value || "";

        // Only save if the value has changed
        if (value !== existingValue && value.trim()) {
          // Save API key directly
          await convex.mutation(api.apiKeys.upsert, {
            teamSlugOrId,
            envVar: key.envVar,
            value: value.trim(),
            displayName: key.displayName,
            description: key.description,
          });
        }
      });

      await Promise.all(savePromises);

      // Save selected agents to localStorage
      if (selectedAgents.length > 0) {
        localStorage.setItem("selectedAgents", JSON.stringify(selectedAgents));
      }

      toast.success("Configuration saved");
    } catch (error) {
      console.error("Error saving API keys:", error);
      toast.error("Failed to save some API keys");
    } finally {
      setIsSaving(false);
    }

    onNext();
  }, [selectedAgents, onNext, apiKeys, apiKeyValues, existingKeys, teamSlugOrId, convex]);

  const getProviderUrl = (envVar: string) => {
    switch (envVar) {
      case "ANTHROPIC_API_KEY":
        return "https://console.anthropic.com/settings/keys";
      case "OPENAI_API_KEY":
        return "https://platform.openai.com/api-keys";
      case "OPENROUTER_API_KEY":
        return "https://openrouter.ai/keys";
      case "GEMINI_API_KEY":
        return "https://console.cloud.google.com/apis/credentials";
      case "MODEL_STUDIO_API_KEY":
        return "https://modelstudio.console.alibabacloud.com/?tab=playground#/api-key";
      case "AMP_API_KEY":
        return "https://ampcode.com/settings";
      case "CURSOR_API_KEY":
        return "https://cursor.com/dashboard?tab=integrations";
      default:
        return null;
    }
  };

  // Get top 3 most commonly used API keys for onboarding
  const topApiKeys = apiKeys.filter(key =>
    ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"].includes(key.envVar)
  );

  return (
    <div className="flex flex-col items-center text-center">
      {/* Header */}
      <div className="mb-12">
        <h1 className="mb-4 text-4xl font-semibold text-neutral-900 dark:text-white">
          Configure Agents
        </h1>
        <p className="text-lg text-neutral-600 dark:text-neutral-400 max-w-md mx-auto">
          Add API keys to enable AI agents. You can skip this and configure later in settings.
        </p>
      </div>

      {/* API Keys Configuration */}
      {topApiKeys.length > 0 && (
        <div className="mb-12 w-full max-w-md space-y-3">
          {topApiKeys.map((key) => {
            const providerUrl = getProviderUrl(key.envVar);
            const isExpanded = expandedKeys[key.envVar];
            const hasValue = Boolean(apiKeyValues[key.envVar]);

            return (
              <div key={key.envVar} className="space-y-2 text-left">
                <button
                  onClick={() => toggleExpandKey(key.envVar)}
                  className="w-full flex items-center justify-between p-4 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {hasValue ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-neutral-400 dark:text-neutral-500" />
                    )}
                    <span className="text-base font-medium text-neutral-900 dark:text-white">
                      {key.displayName}
                    </span>
                  </div>
                  <ArrowRight
                    className={`h-5 w-5 text-neutral-500 dark:text-neutral-400 transition-transform ${
                      isExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className="pl-4 pr-4 pb-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-neutral-600 dark:text-neutral-400">
                        {key.description || `Enter your ${key.displayName}`}
                      </p>
                      {providerUrl && (
                        <a
                          href={providerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1 whitespace-nowrap"
                        >
                          Get key
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showKeys[key.envVar] ? "text" : "password"}
                        value={apiKeyValues[key.envVar] || ""}
                        onChange={(e) => handleApiKeyChange(key.envVar, e.target.value)}
                        placeholder={
                          key.envVar === "ANTHROPIC_API_KEY"
                            ? "sk-ant-api03-..."
                            : key.envVar === "OPENAI_API_KEY"
                              ? "sk-proj-..."
                              : `Enter your ${key.displayName}`
                        }
                        className="w-full px-4 py-3 pr-12 border border-neutral-300 dark:border-neutral-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-neutral-900 text-neutral-900 dark:text-white font-mono text-sm placeholder:text-neutral-400 dark:placeholder:text-neutral-500"
                      />
                      <button
                        type="button"
                        onClick={() => toggleShowKey(key.envVar)}
                        className="absolute inset-y-0 right-0 pr-4 flex items-center text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300"
                      >
                        {showKeys[key.envVar] ? (
                          <EyeOff className="h-5 w-5" />
                        ) : (
                          <Eye className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          onClick={onSkip}
          disabled={isSaving}
          className="text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-white"
        >
          Skip for now
        </Button>
        <Button
          onClick={handleContinue}
          disabled={isSaving}
          className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
        >
          {isSaving ? "Saving..." : "Continue"}
          {!isSaving && <ArrowRight className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
