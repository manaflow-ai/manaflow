import type {
  GenerateBranchesBody,
  GenerateBranchesResponse,
} from "@cmux/www-openapi-client";
import { serverLogger } from "./fileLogger";
import { getWwwClient } from "./wwwClient";
import { getWwwOpenApiModule } from "./wwwOpenApiModule";

const { postApiBranchesGenerate } = await getWwwOpenApiModule();

interface BranchGenerationParams {
  teamSlugOrId: string;
  taskDescription?: string;
  prTitle?: string;
  count: number;
  uniqueId?: string;
}

function fallbackPrTitle(taskDescription: string): string {
  const words = taskDescription
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .slice(0, 5);
  return words.length > 0 ? words.join(" ") : "feature update";
}

async function requestBranchGeneration(
  params: BranchGenerationParams
): Promise<GenerateBranchesResponse> {
  if (!params.taskDescription && !params.prTitle) {
    throw new Error(
      "Branch generation requires either a task description or PR title"
    );
  }

  const body: GenerateBranchesBody = {
    teamSlugOrId: params.teamSlugOrId,
    count: params.count,
    ...(params.taskDescription
      ? { taskDescription: params.taskDescription }
      : {}),
    ...(params.prTitle ? { prTitle: params.prTitle } : {}),
    ...(params.uniqueId ? { uniqueId: params.uniqueId } : {}),
  };

  const response = await postApiBranchesGenerate({
    client: getWwwClient(),
    body,
  });

  if (!response.data) {
    throw new Error("No branch data returned from www");
  }

  return response.data;
}

export async function generateNewBranchName(
  taskDescription: string,
  teamSlugOrId: string,
  uniqueId?: string
): Promise<string> {
  const data = await requestBranchGeneration({
    teamSlugOrId,
    taskDescription,
    count: 1,
    uniqueId,
  });

  const branchName = data.branchNames[0];
  if (!branchName) {
    throw new Error("Failed to generate branch name");
  }

  return branchName;
}

export async function generateUniqueBranchNames(
  taskDescription: string,
  count: number,
  teamSlugOrId: string,
  uniqueId?: string
): Promise<string[]> {
  const data = await requestBranchGeneration({
    teamSlugOrId,
    taskDescription,
    count,
    uniqueId,
  });

  if (!data.branchNames || data.branchNames.length === 0) {
    throw new Error("Failed to generate unique branch names");
  }

  if (data.branchNames.length < count) {
    serverLogger.warn(
      `[BranchNameGenerator] Expected ${count} names, received ${data.branchNames.length}`
    );
  }

  return data.branchNames;
}

export async function generateUniqueBranchNamesFromTitle(
  prTitle: string,
  count: number,
  teamSlugOrId: string,
  uniqueId?: string
): Promise<string[]> {
  const data = await requestBranchGeneration({
    teamSlugOrId,
    prTitle,
    count,
    uniqueId,
  });

  if (!data.branchNames || data.branchNames.length === 0) {
    throw new Error("Failed to generate branch names from PR title");
  }

  if (data.branchNames.length < count) {
    serverLogger.warn(
      `[BranchNameGenerator] Expected ${count} names from title, received ${data.branchNames.length}`
    );
  }

  return data.branchNames;
}

// Generate PR title and branch names in a single API call
export async function generatePRInfoAndBranchNames(
  taskDescription: string,
  count: number,
  teamSlugOrId: string
): Promise<{ prTitle: string; branchNames: string[] }> {
  const data = await requestBranchGeneration({
    teamSlugOrId,
    taskDescription,
    count,
  });

  if (!data.branchNames || data.branchNames.length === 0) {
    throw new Error("Failed to generate branch names");
  }

  if (data.branchNames.length < count) {
    serverLogger.warn(
      `[BranchNameGenerator] Expected ${count} names, received ${data.branchNames.length}`
    );
  }

  return {
    prTitle: data.prTitle || fallbackPrTitle(taskDescription),
    branchNames: data.branchNames,
  };
}

export async function getPRTitleFromTaskDescription(
  taskDescription: string,
  teamSlugOrId: string
): Promise<string> {
  const data = await requestBranchGeneration({
    teamSlugOrId,
    taskDescription,
    count: 1,
  });

  if (!data.prTitle) {
    return fallbackPrTitle(taskDescription);
  }

  return data.prTitle;
}
