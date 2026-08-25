// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GIT_EXECUTABLE,
  workspaceGitEnvironment,
} from "../../apps/desktop/src/main/workers/workspaceGitBinding";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const runtimeSource = fs.readFileSync(
  path.join(repositoryRoot, "apps/desktop/src/main/workers/actestraCodingJourneyRuntime.ts"),
  "utf8",
);
const serviceSource = fs.readFileSync(
  path.join(repositoryRoot, "apps/desktop/src/main/compatibility/aionuiCodingJourneyService.ts"),
  "utf8",
);

describe("P8.2 packaged coding Git boundary", () => {
  it("uses the shared platform-owned executable in the trusted runtime", () => {
    expect(runtimeSource).toContain('import { GIT_EXECUTABLE } from "./workspaceGitBinding";');
    expect(runtimeSource).not.toContain('const GIT_EXECUTABLE = "/usr/bin/git"');
    expect(runtimeSource).not.toContain('lstat("/usr/bin/git")');
    expect(path.isAbsolute(GIT_EXECUTABLE)).toBe(true);
  });

  it("uses the shared closed Git binding for canonical workspace admission", () => {
    expect(serviceSource).toContain(
      'import { resolveWorkspaceGitBinding } from "../workers/workspaceGitBinding";',
    );
    expect(serviceSource).not.toContain('execFileAsync(\n      "/usr/bin/git"');
  });

  it("keeps the executable directory in the closed Git environment", () => {
    const environment = workspaceGitEnvironment(path.join(repositoryRoot, ".p8-profile"));
    expect(environment.PATH?.split(path.delimiter)).toContain(path.dirname(GIT_EXECUTABLE));
    expect(environment.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(environment.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(environment.GIT_TERMINAL_PROMPT).toBe("0");
  });
});
