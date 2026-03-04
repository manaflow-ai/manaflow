import { describe, expect, it } from "vitest";
import { CODEX_AGENT_CONFIGS } from "./configs";

describe("CODEX_AGENT_CONFIGS", () => {
  it("uses sandbox mode without forcing headless approval CLI flags", () => {
    for (const config of CODEX_AGENT_CONFIGS) {
      expect(config.command).toBe("codex");
      expect(config.args).toContain("--sandbox");
      expect(config.args).toContain("danger-full-access");
      expect(config.args).not.toContain("--ask-for-approval");
    }
  });
});
