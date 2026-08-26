// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  GIT_EXECUTABLE,
  resolveGitExecutable,
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

  it("resolves Windows Git only from canonical standard installation roots", () => {
    const files = new Map([
      [
        "C:\\Program Files\\Git\\cmd\\git.exe",
        { canonical: "C:\\Program Files\\Git\\cmd\\git.exe" },
      ],
      [
        "C:\\Program Files (x86)\\Git\\cmd\\git.exe",
        { canonical: "C:\\Program Files (x86)\\Git\\cmd\\git.exe" },
      ],
    ]);
    const dependencies = {
      existsSync: (candidate: string) => files.has(candidate),
      statSync: (candidate: string) => ({ isFile: () => files.has(candidate) }),
      realpathSync: (candidate: string) => files.get(candidate)?.canonical ?? candidate,
    };

    expect(
      resolveGitExecutable(
        "win32",
        { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" },
        dependencies,
      ),
    ).toBe("C:\\Program Files\\Git\\cmd\\git.exe");
    expect(() =>
      resolveGitExecutable(
        "win32",
        { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)" },
        {
          ...dependencies,
          realpathSync: () => "C:\\attacker\\git.exe",
        },
      ),
    ).toThrow("Windows Git executable is unavailable");
  });
});
