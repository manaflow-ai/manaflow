import { describe, expect, it } from "vitest";

import { buildContainerSettingsUpdatePayload } from "./containerSettings";

describe("buildContainerSettingsUpdatePayload", () => {
  it("excludes the routing-only team slug from persisted settings", () => {
    expect(
      buildContainerSettingsUpdatePayload({
        teamSlugOrId: "team-slug",
        maxRunningContainers: 7,
        autoCleanupEnabled: false,
      })
    ).toEqual({
      maxRunningContainers: 7,
      autoCleanupEnabled: false,
    });
  });
});
