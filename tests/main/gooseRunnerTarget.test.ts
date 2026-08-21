import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import sourceContract from "../../apps/desktop/src/shared/gooseRunnerSource.json";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const targetModulePath = path.join(
  repositoryRoot,
  "apps/desktop/src/main/workers/gooseRunnerTarget.ts",
);
const processModulePath = path.join(
  repositoryRoot,
  "apps/desktop/src/main/workers/gooseRunnerProcess.ts",
);
const runnerLockPath = path.join(repositoryRoot, "workers/goose-runner/Cargo.lock");

const expectedGooseSource = {
  repository: "https://github.com/aaif-goose/goose.git",
  version: "1.45.0",
  baseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  runtimeRepository: "ssh://git@github.com/Ablankpaper/actestra-goose-runtime.git",
  runtimeCommit: "81bb2c1428d11e41e7934f4569eb7dda3fb55b81",
  changedPaths: [
    "crates/goose/src/acp/server.rs",
    "crates/goose/src/acp/server_factory.rs",
    "crates/goose/src/acp/server/new_session.rs",
  ],
  cargoFeatures: [],
  patchSetSha256: "975d31ebbabce450a66455ec55e0ecaddeaa3c558e62a0a559a810ad03194a18",
} as const;

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
  it("pins the exact private Goose runtime source and patch contract", () => {
    expect(sourceContract.goose).toEqual(expectedGooseSource);
  });

  it("locks every Goose workspace package to the admitted private runtime revision", () => {
    const lockfile = readFileSync(runnerLockPath, "utf8");
    const expectedSource =
      `git+ssh://git@github.com/Ablankpaper/actestra-goose-runtime.git?rev=${expectedGooseSource.runtimeCommit}` +
      `#${expectedGooseSource.runtimeCommit}`;
    const gooseSources = [
      ...lockfile.matchAll(
        /name = "(?:goose|goose-acp-macros|goose-download-manager|goose-provider-types|goose-providers|goose-sdk-types)"\nversion = "[^"]+"\nsource = "([^"]+)"/g,
      ),
    ].map((match) => match[1]);

    expect(gooseSources).toHaveLength(6);
    expect(new Set(gooseSources)).toEqual(new Set([expectedSource]));
    expect(lockfile).not.toContain("git+https://github.com/aaif-goose/goose");
  });

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
      'target.resolveGooseRunnerRuntimeTarget("win32", "x64")?.targetTriple,',
      'target.resolveGooseRunnerRuntimeTarget("linux", "x64")?.targetTriple,',
      "],",
      "authorities: [",
      'target.resolveGooseRunnerExecutableAuthority("darwin"),',
      'target.resolveGooseRunnerExecutableAuthority("linux"),',
      'target.resolveGooseRunnerExecutableAuthority("win32"),',
      "],",
      "authorityAdmission: [",
      'target.isGooseRunnerExecutableAuthorityAdmitted("darwin", "arm64", "attempt-private"),',
      'target.isGooseRunnerExecutableAuthorityAdmitted("linux", "x64", "linux-package"),',
      'target.isGooseRunnerExecutableAuthorityAdmitted("win32", "x64", "windows-supervisor"),',
      'target.isGooseRunnerExecutableAuthorityAdmitted("linux", "x64", "attempt-private"),',
      'target.isGooseRunnerExecutableAuthorityAdmitted("linux", "arm64", "linux-package"),',
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
      runtime: [
        "aarch64-apple-darwin",
        "x86_64-apple-darwin",
        "x86_64-pc-windows-msvc",
        "x86_64-unknown-linux-gnu",
      ],
      authorities: ["attempt-private", "linux-package", "windows-supervisor"],
      authorityAdmission: [true, true, true, false, false],
      validationRejections: [
        "Goose runner build targets are invalid",
        "Goose runner build target contract is invalid",
        "Goose runner build target identities are ambiguous",
      ],
    });
  }, 20_000);

  it("uses the shared runtime ceiling before any private-root or transport side effect", () => {
    const source = readFileSync(processModulePath, "utf8");
    const runtimeResolution = source.indexOf(
      "resolveGooseRunnerRuntimeTarget(platform, architecture)",
    );
    const containmentResolution = source.indexOf("hasVerifiedGooseContainment(");
    const privateRootPreparation = source.indexOf("prepared = await preparePrivateRoot(");

    expect(source).toContain('from "./gooseRunnerTarget"');
    expect(source).not.toContain("function currentTargetTriple()");
    expect(runtimeResolution).toBeGreaterThan(-1);
    expect(runtimeResolution).toBeLessThan(privateRootPreparation);
    expect(containmentResolution).toBeGreaterThan(-1);
    expect(containmentResolution).toBeLessThan(privateRootPreparation);
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
