import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLOSED_GIT_CONFIG_ARGUMENTS,
  GIT_EXECUTABLE,
  GIT_NULL_DEVICE,
  workspaceGitEnvironment,
} from "../../apps/desktop/src/main/workers/workspaceGitBinding";

describe("secure coding Git runtime", () => {
  it("canonicalizes Git-reported worktree roots before comparing platform spellings", () => {
    const source = fs.readFileSync(
      path.resolve(
        import.meta.dirname,
        "../../apps/desktop/src/main/workers/isolatedCodingWorktree.ts",
      ),
      "utf8",
    );
    expect(source).toContain(
      'runGit(repositoryRoot, environment, "rev-parse", "--show-toplevel").then(',
    );
    expect(source).toContain("realpath(directory)");
    expect(source).toContain("realpath(values[0]!)");
    expect(source).not.toContain("values[0] !== canonicalWorktreeRoot");
  });

  it("uses an absolute admitted executable and platform null device", () => {
    expect(path.isAbsolute(GIT_EXECUTABLE)).toBe(true);
    expect(GIT_NULL_DEVICE).toBe(process.platform === "win32" ? "NUL" : "/dev/null");
    expect(CLOSED_GIT_CONFIG_ARGUMENTS).toEqual([
      "-c",
      `core.hooksPath=${GIT_NULL_DEVICE}`,
      "-c",
      "core.fsmonitor=false",
    ]);
  });

  it("constructs a closed Git environment without inheriting PATH", () => {
    const environment = workspaceGitEnvironment(path.join(process.cwd(), ".actestra-test-home"));
    expect(environment.GIT_CONFIG_GLOBAL).toBe(GIT_NULL_DEVICE);
    expect(environment.GIT_CONFIG_NOSYSTEM).toBe("1");
    expect(environment.GIT_TERMINAL_PROMPT).toBe("0");
    expect(environment.PATH).not.toBe(process.env.PATH);
    expect(environment.PATH).toContain(path.dirname(GIT_EXECUTABLE));
    if (process.platform === "win32") {
      expect(environment.SystemRoot).toBeTypeOf("string");
      expect(environment.WINDIR).toBeTypeOf("string");
    }
  });
});
