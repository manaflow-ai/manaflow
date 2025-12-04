import { describe, expect, it } from "vitest";
import { normalizeVSCodeExecutableCandidate } from "./serveWeb";

describe("normalizeVSCodeExecutableCandidate", () => {
  it("extracts executable path from common alias formats", () => {
    expect(
      normalizeVSCodeExecutableCandidate(
        "alias code=/app/openvscode-server/bin/openvscode-server"
      )
    ).toBe("/app/openvscode-server/bin/openvscode-server");

    expect(
      normalizeVSCodeExecutableCandidate(
        "code: aliased to /usr/bin/code --reuse-window"
      )
    ).toBe("/usr/bin/code");
  });

  it("returns the candidate untouched when it is already a path", () => {
    expect(normalizeVSCodeExecutableCandidate("/usr/local/bin/code")).toBe(
      "/usr/local/bin/code"
    );
  });
});
