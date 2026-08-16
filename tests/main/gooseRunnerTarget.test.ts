import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import sourceContract from "../../apps/desktop/src/shared/gooseRunnerSource.json";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const targetModulePath = path.join(
  repositoryRoot,
  "apps/desktop/src/main/workers/gooseRunnerTarget.ts",
);

const expectedBuildTargets = [
  {
    platform: "darwin",
    architecture: "arm64",
    targetTriple: "aarch64-apple-darwin",
    buildToolHost: "darwin-arm64",
    executableFile: "actestra-goose-runner",
  },
  {
    platform: "darwin",
    architecture: "x64",
    targetTriple: "x86_64-apple-darwin",
    buildToolHost: "darwin-x64",
    executableFile: "actestra-goose-runner",
  },
  {
    platform: "win32",
    architecture: "x64",
    targetTriple: "x86_64-pc-windows-msvc",
    buildToolHost: "win32-x64",
    executableFile: "actestra-goose-runner.exe",
  },
  {
    platform: "linux",
    architecture: "x64",
    targetTriple: "x86_64-unknown-linux-gnu",
    buildToolHost: "linux-x64",
    executableFile: "actestra-goose-runner",
  },
] as const;

describe("Goose runner native build targets", () => {
  it("publishes only the exact native host and target records", () => {
    const contract = sourceContract as typeof sourceContract & {
      readonly buildTargets?: unknown;
    };

    expect(contract.buildTargets).toEqual(expectedBuildTargets);
  });

  it("resolves exact build targets while retaining the narrower runtime ceiling", () => {
    expect(existsSync(targetModulePath)).toBe(true);
    if (!existsSync(targetModulePath)) return;

    const moduleUrl = pathToFileURL(targetModulePath).href;
    const script = [
      "const target = await import(" + JSON.stringify(moduleUrl) + ");",
      "const buildTargets = target.GOOSE_RUNNER_BUILD_TARGETS;",
      "console.log(JSON.stringify({",
      "buildTargets,",
      "collectionFrozen: Object.isFrozen(buildTargets),",
      "recordsFrozen: buildTargets.every(Object.isFrozen),",
      "byHost: buildTargets.map((item) => target.resolveGooseRunnerBuildTarget(item.platform, item.architecture)),",
      "byTriple: buildTargets.map((item) => target.resolveGooseRunnerBuildTargetByTriple(item.targetTriple)),",
      "unsupported: [",
      'target.resolveGooseRunnerBuildTarget("win32", "arm64"),',
      'target.resolveGooseRunnerBuildTarget("linux", "arm64"),',
      'target.resolveGooseRunnerBuildTarget("freebsd", "x64"),',
      'target.resolveGooseRunnerBuildTargetByTriple("x86_64-unknown-linux-musl"),',
      "].map((value) => value === undefined),",
      "runtime: [",
      'target.resolveGooseRunnerRuntimeTarget("darwin", "arm64")?.targetTriple,',
      'target.resolveGooseRunnerRuntimeTarget("darwin", "x64")?.targetTriple,',
      'target.resolveGooseRunnerRuntimeTarget("win32", "x64"),',
      'target.resolveGooseRunnerRuntimeTarget("linux", "x64"),',
      "],",
      "validationRejections: [",
      "null,",
      "{ ...buildTargets[0], unexpected: true },",
      "[buildTargets[0], { ...buildTargets[0] }],",
      "].map((mutation, index) => {",
      "const candidate = index === 0 ? null : index === 1 ? [mutation] : mutation;",
      "try { target.validateGooseRunnerBuildTargets(candidate); return null; }",
      "catch (error) { return error instanceof Error ? error.message : String(error); }",
      "}),",
      "}));",
    ].join("\n");
    const result = spawnSync("bun", ["--eval", script], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      buildTargets: expectedBuildTargets,
      collectionFrozen: true,
      recordsFrozen: true,
      byHost: expectedBuildTargets,
      byTriple: expectedBuildTargets,
      unsupported: [true, true, true, true],
      runtime: ["aarch64-apple-darwin", "x86_64-apple-darwin", null, null],
      validationRejections: [
        "Goose runner build targets are invalid",
        "Goose runner build target contract is invalid",
        "Goose runner build target identities are ambiguous",
      ],
    });
  });
});
