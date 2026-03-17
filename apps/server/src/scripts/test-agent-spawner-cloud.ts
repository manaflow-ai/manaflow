import { api } from "@cmux/convex/api";
import { AGENT_CONFIGS } from "@cmux/shared/agentConfig";
import { spawnAgent } from "../agentSpawner.ts";
import { getConvex } from "../utils/convexClient.ts";

const agentConfig = AGENT_CONFIGS.find(
  (agent) => agent.name === "codex/gpt-5.1-codex-high"
);

if (!agentConfig) {
  throw new Error("Agent config not found");
}

console.log("Running with agent config:", agentConfig);

const { taskId } = await getConvex().mutation(api.tasks.create, {
  teamSlugOrId: "default",
  projectFullName: "manaflow-ai/manaflow",
  text: "whats the time rn?",
});

console.log("Created task:", taskId);
const result = await spawnAgent(
  agentConfig,
  taskId,
  {
    repoUrl: "https://github.com/manaflow-ai/manaflow",
    branch: "main",
    taskDescription: "whats the time rn?",
    isCloudMode: true,
  },
  "default"
);

console.log("Spawned agent:", result);
