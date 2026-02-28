import { describe, it, expect } from "vitest";
import { getMemoryMcpServerScript } from "./agent-memory-protocol";
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("agent-memory-protocol", () => {
  it("generates valid JavaScript for MCP server script", () => {
    const script = getMemoryMcpServerScript();
    
    // Write to temp file and validate with node --check
    const tempFile = join(tmpdir(), `mcp-server-test-${Date.now()}.js`);
    try {
      writeFileSync(tempFile, script);
      // node --check validates syntax without executing
      execSync(`node --check "${tempFile}"`, { encoding: "utf-8" });
    } finally {
      try {
        unlinkSync(tempFile);
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("MCP server script contains expected tools", () => {
    const script = getMemoryMcpServerScript();
    
    const expectedTools = [
      "read_memory",
      "list_daily_logs", 
      "read_daily_log",
      "search_memory",
      "send_message",
      "get_my_messages",
      "mark_read",
      "append_daily_log",
      "update_knowledge",
      "add_task",
      "update_task",
    ];
    
    for (const tool of expectedTools) {
      expect(script).toContain(`name: '${tool}'`);
    }
  });
});
