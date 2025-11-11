import { GitHubIcon } from "@/components/icons/github";
import { useTheme } from "@/components/theme/use-theme";
import type { SelectOption } from "@/components/ui/searchable-select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExpandTasks } from "@/contexts/expand-tasks/ExpandTasksContext";
import { useSocket } from "@/contexts/socket/use-socket";
import { createFakeConvexId } from "@/lib/fakeConvexId";
import { attachTaskLifecycleListeners } from "@/lib/socket/taskLifecycleListeners";
import { branchesQueryOptions } from "@/queries/branches";
import { api } from "@cmux/convex/api";
import type { Doc, Id } from "@cmux/convex/dataModel";
import type {
  ProviderStatusResponse,
  TaskAcknowledged,
  TaskError,
  TaskStarted,
} from "@cmux/shared";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { convexQuery } from "@convex-dev/react-query";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "@tanstack/react-query";
import { Server as ServerIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { z } from "zod";
import type { EditorApi } from "./DashboardInput";

const DEFAULT_AGENTS = [
  "claude/sonnet-4.5",
  "claude/opus-4.1",
  "codex/gpt-5-codex-high",
];

const KNOWN_AGENT_NAMES = new Set(AGENT_CONFIGS.map((agent) => agent.name));
const DEFAULT_AGENT_SELECTION = DEFAULT_AGENTS.filter((agent) =>
  KNOWN_AGENT_NAMES.has(agent),
);

const AGENT_SELECTION_SCHEMA = z.array(z.string());

const filterKnownAgents = (agents: string[]): string[] =>
  agents.filter((agent) => KNOWN_AGENT_NAMES.has(agent));

const parseStoredAgentSelection = (stored: string | null): string[] => {
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored);
    const result = AGENT_SELECTION_SCHEMA.safeParse(parsed);
    if (!result.success) {
      console.warn("Invalid stored agent selection", result.error);
      return [];
    }

    return filterKnownAgents(result.data);
  } catch (error) {
    console.warn("Failed to parse stored agent selection", error);
    return [];
  }
};

export interface UseTaskCreationFormResult {
  editorApiRef: RefObject<EditorApi | null>;
  handleTaskDescriptionChange: (value: string) => void;
  lexicalRepoUrl?: string;
  lexicalEnvironmentId?: Id<"environments">;
  lexicalBranch?: string;
  projectOptions: SelectOption[];
  selectedProject: string[];
  handleProjectChange: (projects: string[]) => void;
  handleProjectSearchPaste: (value: string) => Promise<boolean>;
  branchOptions: string[];
  selectedBranch: string[];
  handleBranchChange: (branches: string[]) => void;
  selectedAgents: string[];
  handleAgentChange: (agents: string[]) => void;
  isCloudMode: boolean;
  handleCloudModeToggle: () => void;
  isLoadingProjects: boolean;
  isLoadingBranches: boolean;
  providerStatus: ProviderStatusResponse | null;
  canSubmit: boolean;
  handleStartTask: () => Promise<void>;
  isEnvSelected: boolean;
  selectedRepoFullName: string | null;
  branchDisabled: boolean;
  cloudToggleDisabled: boolean;
}

interface UseTaskCreationFormOptions {
  teamSlugOrId: string;
}

export function useTaskCreationForm({
  teamSlugOrId,
}: UseTaskCreationFormOptions): UseTaskCreationFormResult {
  const { socket } = useSocket();
  const { theme } = useTheme();
  const { addTaskToExpand } = useExpandTasks();

  const [selectedProject, setSelectedProject] = useState<string[]>(() => {
    const stored =
      typeof window === "undefined"
        ? null
        : localStorage.getItem(`selectedProject-${teamSlugOrId}`);
    return stored ? JSON.parse(stored) : [];
  });
  const selectedProjectRef = useRef<string | undefined>(selectedProject[0]);
  useEffect(() => {
    selectedProjectRef.current = selectedProject[0];
  }, [selectedProject]);

  const [selectedBranch, setSelectedBranch] = useState<string[]>([]);

  const [selectedAgents, setSelectedAgentsState] = useState<string[]>(() => {
    const storedAgents = parseStoredAgentSelection(
      typeof window === "undefined"
        ? null
        : localStorage.getItem("selectedAgents"),
    );

    if (storedAgents.length > 0) {
      return storedAgents;
    }

    return DEFAULT_AGENT_SELECTION.length > 0
      ? [...DEFAULT_AGENT_SELECTION]
      : [];
  });
  const selectedAgentsRef = useRef<string[]>(selectedAgents);
  const setSelectedAgents = useCallback((agents: string[]) => {
    selectedAgentsRef.current = agents;
    setSelectedAgentsState(agents);
  }, []);

  const [taskDescription, setTaskDescription] = useState<string>("");
  const [isCloudMode, setIsCloudMode] = useState<boolean>(() => {
    const stored =
      typeof window === "undefined" ? null : localStorage.getItem("isCloudMode");
    return stored ? JSON.parse(stored) : true;
  });
  const [, setDockerReady] = useState<boolean | null>(null);
  const [providerStatus, setProviderStatus] =
    useState<ProviderStatusResponse | null>(null);

  const editorApiRef = useRef<EditorApi | null>(null);

  const handleTaskDescriptionChange = useCallback((value: string) => {
    setTaskDescription(value);
  }, []);

  const persistAgentSelection = useCallback((agents: string[]) => {
    try {
      const isDefaultSelection =
        DEFAULT_AGENT_SELECTION.length > 0 &&
        agents.length === DEFAULT_AGENT_SELECTION.length &&
        agents.every(
          (agent, index) => agent === DEFAULT_AGENT_SELECTION[index],
        );

      if (agents.length === 0 || isDefaultSelection) {
        localStorage.removeItem("selectedAgents");
      } else {
        localStorage.setItem("selectedAgents", JSON.stringify(agents));
      }
    } catch (error) {
      console.warn("Failed to persist agent selection", error);
    }
  }, []);

  const handleProjectChange = useCallback(
    (newProjects: string[]) => {
      const next = newProjects ?? [];
      const previous = selectedProjectRef.current ?? "";
      setSelectedProject(next);
      localStorage.setItem(
        `selectedProject-${teamSlugOrId}`,
        JSON.stringify(next),
      );

      if ((next[0] || "") !== previous) {
        setSelectedBranch([]);
      }

      if ((next[0] || "").startsWith("env:")) {
        setIsCloudMode(true);
        localStorage.setItem("isCloudMode", JSON.stringify(true));
      }
    },
    [teamSlugOrId],
  );

  const handleBranchChange = useCallback((newBranches: string[]) => {
    setSelectedBranch(newBranches);
  }, []);

  const handleAgentChange = useCallback(
    (newAgents: string[]) => {
      const normalizedAgents = filterKnownAgents(newAgents);
      setSelectedAgents(normalizedAgents);
      persistAgentSelection(normalizedAgents);
    },
    [persistAgentSelection, setSelectedAgents],
  );

  const reposByOrgQuery = useQuery({
    ...convexQuery(api.github.getReposByOrg, { teamSlugOrId }),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const reposByOrg = useMemo(
    () => reposByOrgQuery.data || {},
    [reposByOrgQuery.data],
  );

  const branchesQuery = useQuery({
    ...branchesQueryOptions({
      teamSlugOrId,
      repoFullName: selectedProject[0] || "",
    }),
    enabled: !!selectedProject[0] && !selectedProject[0].startsWith("env:"),
  });

  const branchSummary = useMemo(() => {
    const data = branchesQuery.data;
    if (!data?.branches) {
      return {
        names: [] as string[],
        defaultName: undefined as string | undefined,
      };
    }
    const names = data.branches.map((branch) => branch.name);
    const fromResponse = data.defaultBranch?.trim();
    const flaggedDefault = data.branches.find((branch) => branch.isDefault)
      ?.name;
    const normalizedFromResponse =
      fromResponse && names.includes(fromResponse) ? fromResponse : undefined;
    const normalizedFlagged =
      flaggedDefault && names.includes(flaggedDefault)
        ? flaggedDefault
        : undefined;

    return {
      names,
      defaultName: normalizedFromResponse ?? normalizedFlagged,
    };
  }, [branchesQuery.data]);

  const branchNames = branchSummary.names;
  const remoteDefaultBranch = branchSummary.defaultName;

  const environmentsQuery = useQuery(
    convexQuery(api.environments.list, { teamSlugOrId }),
  );

  const addManualRepo = useAction(api.github_http.addManualRepo);

  const handleProjectSearchPaste = useCallback(
    async (input: string) => {
      try {
        const result = await addManualRepo({
          teamSlugOrId,
          repoUrl: input,
        });

        if (result.success) {
          await reposByOrgQuery.refetch();
          handleProjectChange([result.fullName]);
          toast.success(`Added ${result.fullName} to repositories`);
          return true;
        }

        return false;
      } catch (error) {
        if (
          error instanceof Error &&
          error.message &&
          !error.message.includes("Invalid GitHub")
        ) {
          toast.error(error.message);
        }
        return false;
      }
    },
    [addManualRepo, handleProjectChange, reposByOrgQuery, teamSlugOrId],
  );

  const checkProviderStatus = useCallback(() => {
    if (!socket) return;

    socket.emit("check-provider-status", (response) => {
      if (!response) return;
      setProviderStatus(response);

      if (response.success) {
        const isRunning = response.dockerStatus?.isRunning;
        if (typeof isRunning === "boolean") {
          setDockerReady(isRunning);
        }
      }

      const currentAgents = selectedAgentsRef.current;
      if (currentAgents.length === 0) {
        return;
      }

      const providers = response.providers;
      if (!providers || providers.length === 0) {
        const normalizedOnly = filterKnownAgents(currentAgents);
        if (normalizedOnly.length !== currentAgents.length) {
          setSelectedAgents(normalizedOnly);
          persistAgentSelection(normalizedOnly);
        }
        return;
      }

      const availableAgents = new Set(
        providers
          .filter((provider) => provider.isAvailable)
          .map((provider) => provider.name),
      );

      const normalizedAgents = filterKnownAgents(currentAgents);
      const removedUnknown = normalizedAgents.length !== currentAgents.length;

      const filteredAgents = normalizedAgents.filter((agent) =>
        availableAgents.has(agent),
      );
      const removedUnavailable = normalizedAgents.filter(
        (agent) => !availableAgents.has(agent),
      );

      if (!removedUnknown && removedUnavailable.length === 0) {
        return;
      }

      setSelectedAgents(filteredAgents);
      persistAgentSelection(filteredAgents);

      if (removedUnavailable.length > 0) {
        const uniqueMissing = Array.from(new Set(removedUnavailable));
        if (uniqueMissing.length > 0) {
          const label = uniqueMissing.length === 1 ? "model" : "models";
          const verb = uniqueMissing.length === 1 ? "is" : "are";
          toast.warning(
            `${uniqueMissing.join(", ")} ${verb} not configured and was removed from the selection. Update credentials in Settings to use this ${label}.`,
          );
        }
      }
    });
  }, [persistAgentSelection, socket, setSelectedAgents]);

  useEffect(() => {
    checkProviderStatus();
    const interval = setInterval(() => {
      checkProviderStatus();
    }, 5000);

    const handleFocus = () => checkProviderStatus();
    window.addEventListener("focus", handleFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [checkProviderStatus]);

  useEffect(() => {
    if (!socket) return;

    const handleVSCodeSpawned = (data: {
      instanceId: string;
      url: string;
      workspaceUrl: string;
      provider: string;
    }) => {
      console.log("VSCode spawned:", data);
    };

    socket.on("vscode-spawned", handleVSCodeSpawned);
    return () => {
      socket.off("vscode-spawned", handleVSCodeSpawned);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket) return;

    const handleDefaultRepo = (data: {
      repoFullName: string;
      branch?: string;
      localPath: string;
    }) => {
      handleProjectChange([data.repoFullName]);
      if (data.branch) {
        setSelectedBranch([data.branch]);
      }
    };

    socket.on("default-repo", handleDefaultRepo);
    return () => {
      socket.off("default-repo", handleDefaultRepo);
    };
  }, [handleProjectChange, socket]);

  const createTask = useMutation(api.tasks.create).withOptimisticUpdate(
    (localStore, args) => {
      const currentTasks = localStore.getQuery(api.tasks.get, {
        teamSlugOrId,
      });

      if (currentTasks !== undefined) {
        const now = Date.now();
        const optimisticTask = {
          _id: createFakeConvexId() as Doc<"tasks">["_id"],
          _creationTime: now,
          text: args.text,
          description: args.description,
          projectFullName: args.projectFullName,
          baseBranch: args.baseBranch,
          worktreePath: args.worktreePath,
          isCompleted: false,
          isArchived: false,
          createdAt: now,
          updatedAt: now,
          images: args.images,
          userId: "optimistic",
          teamId: teamSlugOrId,
          environmentId: args.environmentId,
        };

        const listArgs: {
          teamSlugOrId: string;
          projectFullName?: string;
          archived?: boolean;
        } = {
          teamSlugOrId,
        };
        localStore.setQuery(api.tasks.get, listArgs, [
          optimisticTask,
          ...currentTasks,
        ]);
      }
    },
  );
  const generateUploadUrl = useMutation(api.storage.generateUploadUrl);

  const effectiveSelectedBranch = useMemo(() => {
    if (selectedBranch.length > 0) {
      return selectedBranch;
    }
    if (branchNames.length === 0) {
      return [];
    }
    const fallbackBranch = branchNames.includes("main")
      ? "main"
      : branchNames.includes("master")
        ? "master"
        : branchNames[0];
    const preferredBranch =
      remoteDefaultBranch && branchNames.includes(remoteDefaultBranch)
        ? remoteDefaultBranch
        : fallbackBranch;
    return [preferredBranch];
  }, [branchNames, remoteDefaultBranch, selectedBranch]);

  const isEnvSelected = useMemo(
    () => (selectedProject[0] || "").startsWith("env:"),
    [selectedProject],
  );

  const branchOptions = branchNames;

  const handleCloudModeToggle = useCallback(() => {
    if (isEnvSelected) return;
    const newMode = !isCloudMode;
    setIsCloudMode(newMode);
    localStorage.setItem("isCloudMode", JSON.stringify(newMode));
  }, [isCloudMode, isEnvSelected]);

  const handleStartTask = useCallback(async () => {
    if (!isEnvSelected && !isCloudMode) {
      if (socket) {
        const ready = await new Promise<boolean>((resolve) => {
          socket.emit("check-provider-status", (response) => {
            const isRunning = !!response?.dockerStatus?.isRunning;
            if (typeof isRunning === "boolean") {
              setDockerReady(isRunning);
            }
            resolve(isRunning);
          });
        });

        if (!ready) {
          toast.error("Docker is not running. Start Docker Desktop.");
          return;
        }
      } else {
        console.error("Cannot verify Docker status: socket not connected");
        toast.error(
          "Cannot verify Docker status. Please ensure the server is running.",
        );
        return;
      }
    }

    if (!selectedProject[0] || !taskDescription.trim()) {
      console.error("Please select a project and enter a task description");
      return;
    }
    if (!socket) {
      console.error("Socket not connected");
      return;
    }

    const branch = effectiveSelectedBranch[0];
    const projectFullName = selectedProject[0];
    const envSelected = projectFullName.startsWith("env:");
    const environmentId = envSelected
      ? (projectFullName.replace(/^env:/, "") as Id<"environments">)
      : undefined;

    try {
      const content = editorApiRef.current?.getContent();
      const images = content?.images || [];

      const uploadedImages = await Promise.all(
        images.map(async (image) => {
          const base64Data = image.src.split(",")[1] || image.src;
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: "image/png" });
          const uploadUrl = await generateUploadUrl({
            teamSlugOrId,
          });
          const result = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": blob.type },
            body: blob,
          });
          const { storageId } = await result.json();

          return {
            storageId,
            fileName: image.fileName,
            altText: image.altText,
          };
        }),
      );

      handleTaskDescriptionChange("");
      if (editorApiRef.current?.clear) {
        editorApiRef.current.clear();
      }

      const taskId = await createTask({
        teamSlugOrId,
        text: content?.text || taskDescription,
        projectFullName: envSelected ? undefined : projectFullName,
        baseBranch: envSelected ? undefined : branch,
        images: uploadedImages.length > 0 ? uploadedImages : undefined,
        environmentId,
      });

      addTaskToExpand(taskId);

      const repoUrl = envSelected
        ? undefined
        : `https://github.com/${projectFullName}.git`;

      const handleStartTaskAck = (
        response: TaskAcknowledged | TaskStarted | TaskError,
      ) => {
        if ("error" in response) {
          console.error("Task start error:", response.error);
          toast.error(`Task start error: ${JSON.stringify(response.error)}`);
          return;
        }

        attachTaskLifecycleListeners(socket, response.taskId, {
          onStarted: (payload) => {
            console.log("Task started:", payload);
          },
          onFailed: (payload) => {
            toast.error(`Task failed to start: ${payload.error}`);
          },
        });
      };

      socket.emit(
        "start-task",
        {
          ...(repoUrl ? { repoUrl } : {}),
          ...(envSelected ? {} : { branch }),
          taskDescription: content?.text || taskDescription,
          projectFullName,
          taskId,
          selectedAgents:
            selectedAgents.length > 0 ? selectedAgents : undefined,
          isCloudMode: envSelected ? true : isCloudMode,
          ...(environmentId ? { environmentId } : {}),
          images: images.length > 0 ? images : undefined,
          theme,
        },
        handleStartTaskAck,
      );
    } catch (error) {
      console.error("Error starting task:", error);
    }
  }, [
    addTaskToExpand,
    createTask,
    effectiveSelectedBranch,
    generateUploadUrl,
    handleTaskDescriptionChange,
    isCloudMode,
    isEnvSelected,
    selectedAgents,
    selectedProject,
    socket,
    taskDescription,
    teamSlugOrId,
    theme,
  ]);

  const projectOptions = useMemo(() => {
    const repoDocs = Object.values(reposByOrg || {}).flatMap((repos) => repos);
    const uniqueRepos = repoDocs.reduce((acc, repo) => {
      const existing = acc.get(repo.fullName);
      if (!existing) {
        acc.set(repo.fullName, repo);
        return acc;
      }
      const existingActivity =
        existing.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      const candidateActivity = repo.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      if (candidateActivity > existingActivity) {
        acc.set(repo.fullName, repo);
      }
      return acc;
    }, new Map<string, Doc<"repos">>());

    const sortedRepos = Array.from(uniqueRepos.values()).sort((a, b) => {
      const aPushedAt = a.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      const bPushedAt = b.lastPushedAt ?? Number.NEGATIVE_INFINITY;
      if (aPushedAt !== bPushedAt) {
        return bPushedAt - aPushedAt;
      }
      return a.fullName.localeCompare(b.fullName);
    });

    const repoOptions = sortedRepos.map((repo) => ({
      label: repo.fullName,
      value: repo.fullName,
      icon: (
        <GitHubIcon className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
      ),
      iconKey: "github",
    }));

    const envOptions = (environmentsQuery.data || []).map((env) => ({
      label: `${env.name}`,
      value: `env:${env._id}`,
      icon: (
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <ServerIcon className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
            </span>
          </TooltipTrigger>
          <TooltipContent>Environment: {env.name}</TooltipContent>
        </Tooltip>
      ),
      iconKey: "environment",
    }));

    const options: SelectOption[] = [];
    if (envOptions.length > 0) {
      options.push({
        label: "Environments",
        value: "__heading-env",
        heading: true,
      });
      options.push(...envOptions);
    }
    if (repoOptions.length > 0) {
      options.push({
        label: "Repositories",
        value: "__heading-repo",
        heading: true,
      });
      options.push(...repoOptions);
    }

    return options;
  }, [environmentsQuery.data, reposByOrg]);

  const selectedRepoFullName = useMemo(() => {
    if (!selectedProject[0] || isEnvSelected) return null;
    return selectedProject[0];
  }, [isEnvSelected, selectedProject]);

  const lexicalEnvironmentId = useMemo(() => {
    if (!selectedProject[0] || !isEnvSelected) return undefined;
    return selectedProject[0].replace(/^env:/, "") as Id<"environments">;
  }, [isEnvSelected, selectedProject]);

  const lexicalRepoUrl = useMemo(() => {
    if (!selectedProject[0]) return undefined;
    if (isEnvSelected) return undefined;
    return `https://github.com/${selectedProject[0]}.git`;
  }, [isEnvSelected, selectedProject]);

  const lexicalBranch = useMemo(
    () => effectiveSelectedBranch[0],
    [effectiveSelectedBranch],
  );

  const canSubmit = useMemo(() => {
    if (!selectedProject[0]) return false;
    if (!taskDescription.trim()) return false;
    if (selectedAgents.length === 0) return false;
    if (isEnvSelected) return true;
    return !!effectiveSelectedBranch[0];
  }, [
    effectiveSelectedBranch,
    isEnvSelected,
    selectedAgents.length,
    selectedProject,
    taskDescription,
  ]);

  return {
    editorApiRef,
    handleTaskDescriptionChange,
    lexicalRepoUrl,
    lexicalEnvironmentId,
    lexicalBranch,
    projectOptions,
    selectedProject,
    handleProjectChange,
    handleProjectSearchPaste,
    branchOptions,
    selectedBranch: effectiveSelectedBranch,
    handleBranchChange,
    selectedAgents,
    handleAgentChange,
    isCloudMode,
    handleCloudModeToggle,
    isLoadingProjects: reposByOrgQuery.isLoading,
    isLoadingBranches: branchesQuery.isPending,
    providerStatus,
    canSubmit,
    handleStartTask,
    isEnvSelected,
    selectedRepoFullName,
    branchDisabled: isEnvSelected || !selectedProject[0],
    cloudToggleDisabled: isEnvSelected,
  };
}
