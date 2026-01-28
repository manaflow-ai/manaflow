import { describe, expect, it } from "vitest";
import { parseMcpServers } from "./workspaceSettings";

describe("workspaceSettings MCP servers", () => {
  it("accepts stdio servers with env and args", () => {
    const result = parseMcpServers([
      {
        id: "cmux",
        name: "cmux",
        enabled: true,
        transport: "stdio",
        command: "/usr/local/bin/mcp-upload",
        args: ["--flag"],
        env: [{ name: "KEY", value: "value" }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.transport).toBe("stdio");
  });

  it("accepts http servers with headers", () => {
    const result = parseMcpServers([
      {
        id: "remote-http",
        name: "Remote HTTP",
        enabled: true,
        transport: "http",
        url: "https://mcp.example.com",
        headers: [{ name: "Authorization", value: "Bearer token" }],
      },
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.transport).toBe("http");
  });

  it("rejects stdio servers without command", () => {
    expect(() =>
      parseMcpServers([
        {
          id: "bad-stdio",
          name: "Bad",
          enabled: true,
          transport: "stdio",
          command: "",
        },
      ])
    ).toThrow();
  });

  it("rejects http servers with invalid url", () => {
    expect(() =>
      parseMcpServers([
        {
          id: "bad-http",
          name: "Bad",
          enabled: true,
          transport: "http",
          url: "not-a-url",
        },
      ])
    ).toThrow();
  });
});
