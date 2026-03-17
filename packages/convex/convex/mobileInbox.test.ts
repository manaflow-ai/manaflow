import { describe, expect, test } from "vitest";
import schema from "./schema";

describe("mobile dogfood schema", () => {
  test("includes mobile machine, workspace, and push token tables", () => {
    expect(schema.tables.mobileMachines).toBeDefined();
    expect(schema.tables.mobileWorkspaces).toBeDefined();
    expect(schema.tables.mobileWorkspaceEvents).toBeDefined();
    expect(schema.tables.mobileUserWorkspaceState).toBeDefined();
    expect(schema.tables.devicePushTokens).toBeDefined();
  });
});
