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

const expectedP8BuildToolAssets = {
  "win32-x64": [
    {
      name: "cargo-auditable",
      archive: "cargo-auditable-x86_64-pc-windows-msvc.zip",
      size: 485_072,
      sha256: "e2da8d873978982381269c27be8b76cfd4084fbf99c43bd83231ac9c714488bb",
      repository: "rust-secure-code/cargo-auditable",
      assetId: 366_985_543,
      url: "https://github.com/rust-secure-code/cargo-auditable/releases/download/v0.7.4/cargo-auditable-x86_64-pc-windows-msvc.zip",
      executableFile: "cargo-auditable.exe",
      expectedVersion: "cargo-auditable 0.7.4",
    },
    {
      name: "cargo-audit",
      archive: "cargo-audit-x86_64-pc-windows-msvc-v0.22.2.zip",
      size: 6_192_256,
      sha256: "0a7316540862c13d954f648917ceacca593747baed6eec180fafa590be2710ab",
      repository: "rustsec/rustsec",
      assetId: 439_294_720,
      url: "https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/cargo-audit-x86_64-pc-windows-msvc-v0.22.2.zip",
      executableFile: "cargo-audit.exe",
      expectedVersion: "cargo-audit 0.22.2",
    },
  ],
  "linux-x64": [
    {
      name: "cargo-auditable",
      archive: "cargo-auditable-x86_64-unknown-linux-gnu.tar.xz",
      size: 458_196,
      sha256: "fbc6c3779f2f4040578f76e8a77a73ab6d31187e3ef1558ced00dc81d2a0f080",
      repository: "rust-secure-code/cargo-auditable",
      assetId: 366_985_552,
      url: "https://github.com/rust-secure-code/cargo-auditable/releases/download/v0.7.4/cargo-auditable-x86_64-unknown-linux-gnu.tar.xz",
      executableFile: "cargo-auditable",
      expectedVersion: "cargo-auditable 0.7.4",
    },
    {
      name: "cargo-audit",
      archive: "cargo-audit-x86_64-unknown-linux-gnu-v0.22.2.tgz",
      size: 6_554_209,
      sha256: "ab28a1bdb54db4d5d8ad5981cf1f959410370b3d28250dbd35f6a44248620e39",
      repository: "rustsec/rustsec",
      assetId: 439_291_614,
      url: "https://github.com/rustsec/rustsec/releases/download/cargo-audit/v0.22.2/cargo-audit-x86_64-unknown-linux-gnu-v0.22.2.tgz",
      executableFile: "cargo-audit",
      expectedVersion: "cargo-audit 0.22.2",
    },
  ],
} as const;

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

  it("pins complete build-tool asset evidence for every admitted host", () => {
    const contract = sourceContract as typeof sourceContract & {
      readonly buildToolAssets: Readonly<Record<string, readonly Record<string, unknown>[]>>;
    };
    const assetKeys = [
      "archive",
      "assetId",
      "executableFile",
      "expectedVersion",
      "name",
      "repository",
      "sha256",
      "size",
      "url",
    ];

    for (const target of expectedBuildTargets) {
      const assets = contract.buildToolAssets[target.buildToolHost];
      expect(assets).toHaveLength(2);
      expect(assets?.map(({ name }) => name)).toEqual(["cargo-auditable", "cargo-audit"]);
      for (const asset of assets ?? []) {
        expect(Object.keys(asset).sort()).toEqual(assetKeys);
      }
    }
    expect(contract.buildToolAssets["win32-x64"]).toEqual(expectedP8BuildToolAssets["win32-x64"]);
    expect(contract.buildToolAssets["linux-x64"]).toEqual(expectedP8BuildToolAssets["linux-x64"]);
  });
});
