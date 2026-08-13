// @vitest-environment node

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPackage } from "@electron/asar";
import { afterEach, describe, expect, it } from "vitest";
import sourceContract from "../../apps/desktop/src/shared/gooseRunnerSource.json";
import { inspectP7PackagedTrust } from "../../scripts/p7-packaged-trust.mjs";

const fixtures = [];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fixtureRoot(prefix) {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  fixtures.push(root);
  return root;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function buildRunnerFixture() {
  const root = fixtureRoot("actestra-p7-packaged-trust-runner-");
  const executable = Buffer.from("realistic-admitted-goose-runner", "utf8");
  const lockfile = `version = 4\nname = "goose"\nversion = "1.45.0"\nsource = "git+https://github.com/aaif-goose/goose?rev=${sourceContract.goose.commit}#${sourceContract.goose.commit}"\nname = "event-listener"\nversion = "5.4.2"\nname = "lru"\nversion = "0.18.2"\n`;
  const license = readFileSync("workers/goose-runner/licenses/GOOSE-APACHE-2.0.txt");
  const sbom = JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: { name: sourceContract.runner.name, version: sourceContract.runner.version },
    },
    components: [
      {
        name: "goose",
        version: sourceContract.goose.version,
        purl: `${sourceContract.goose.repository}@${sourceContract.goose.commit}`,
      },
    ],
    dependencies: [],
  });
  const audit = JSON.stringify({
    contractVersion: 1,
    binary: { unsound: [] },
    lock: { unsound: [] },
  });
  const files = {
    executable: path.join(root, "actestra-goose-runner"),
    lockfile: path.join(root, "Cargo.lock"),
    license: path.join(root, "GOOSE-APACHE-2.0.txt"),
    sbom: path.join(root, "actestra-goose-runner.cdx.json"),
    audit: path.join(root, "actestra-goose-runner.audit.json"),
  };
  writeFileSync(files.executable, executable);
  chmodSync(files.executable, 0o500);
  writeFileSync(files.lockfile, lockfile);
  writeFileSync(files.license, license);
  writeFileSync(files.sbom, sbom);
  writeFileSync(files.audit, audit);
  const manifest = {
    contractVersion: 1,
    runner: {
      name: sourceContract.runner.name,
      version: sourceContract.runner.version,
      targetTriple: "aarch64-apple-darwin",
      executable: {
        file: "actestra-goose-runner",
        sha256: sha256(executable),
        size: executable.length,
      },
    },
    goose: sourceContract.goose,
    acp: sourceContract.acp,
    build: {
      lockfile: { file: "Cargo.lock", sha256: sha256(lockfile) },
      sourceTreeSha256: "a".repeat(64),
    },
    materials: {
      license: { file: "GOOSE-APACHE-2.0.txt", sha256: sha256(license) },
      sbom: { file: "actestra-goose-runner.cdx.json", sha256: sha256(sbom) },
      audit: { file: "actestra-goose-runner.audit.json", sha256: sha256(audit) },
    },
    provenance: { actestraCommit: "b".repeat(40), dirty: false },
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(path.join(root, "actestra-goose-runner.manifest.json"), manifestBytes);
  return { root, manifestSha256: sha256(manifestBytes) };
}

async function buildAppFixture({ includeMarkers = true } = {}) {
  const root = fixtureRoot("actestra-p7-packaged-trust-app-");
  const source = path.join(root, "app-source");
  mkdirSync(path.join(source, "out/main"), { recursive: true });
  const markerText = includeMarkers
    ? "ACTESTRA_P7_SECURITY_SMOKE_RESULT P7-A-RENDERER-002 ACTESTRA_P7_SECURITY_SMOKE"
    : "no p7 marker";
  writeFileSync(path.join(source, "out/main/index.js"), markerText);
  writeFileSync(path.join(source, "out/main/actestra-team-planner.js"), "planner entry");
  const plannerManifest = {
    schemaVersion: 1,
    engine: { name: "actestra-native-team-planner", version: "1.0.0" },
    entry: {
      fileName: "actestra-team-planner.js",
      sha256: sha256("planner entry"),
      size: Buffer.byteLength("planner entry"),
    },
  };
  writeJson(path.join(source, "out/main/actestra-team-planner.manifest.json"), plannerManifest);
  const appAsar = path.join(root, "Actestra.app/Contents/Resources/app.asar");
  mkdirSync(path.dirname(appAsar), { recursive: true });
  await createPackage(source, appAsar);
  const appBundle = path.join(root, "Actestra.app");
  mkdirSync(path.join(appBundle, "Contents/MacOS"), { recursive: true });
  writeFileSync(path.join(appBundle, "Contents/Info.plist"), "fixture plist\n");
  writeFileSync(path.join(appBundle, "Contents/MacOS/Actestra"), "mach-o");
  return { appBundle };
}

function commandRunner({
  identity = "com.bignormal.actestra",
  architecture = "arm64",
  verifyStatus = 0,
} = {}) {
  return (_command, args) => {
    if (_command === "/usr/bin/file")
      return { status: 0, stdout: `Actestra: Mach-O thin (${architecture})\n`, stderr: "" };
    if (args[0] === "--verify") return { status: verifyStatus, stdout: "", stderr: "" };
    if (args[0] === "-dv")
      return { status: 0, stdout: "", stderr: `Identifier=${identity}\nSignature=adhoc\n` };
    if (args[0] === "-c") {
      const key = args[1].replace("Print :", "");
      return {
        status: 0,
        stdout: `${key === "CFBundleIdentifier" ? identity : key === "CFBundleExecutable" ? "Actestra" : "Actestra"}\n`,
        stderr: "",
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

function sourceCopyFixture() {
  const root = fixtureRoot("actestra-p7-packaged-trust-copy-");
  const sourceRoot = path.join(root, "source");
  const outputRoot = path.join(root, "output");
  mkdirSync(sourceRoot, { recursive: true });
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(sourceRoot, "marker.ts"), "stable source\n");
  writeFileSync(path.join(outputRoot, "marker.ts"), "stable source\n");
  return {
    repositoryRoot: root,
    outputRoot,
    sourceCopies: [
      { source: "source/marker.ts", destination: "marker.ts", sha256: sha256("stable source\n") },
    ],
  };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("P7 packaged artifact/package trust aggregation", () => {
  it("aggregates app, planner, external Goose, and source-copy trust without conflating roots", async () => {
    const app = await buildAppFixture();
    const runner = buildRunnerFixture();
    const sourceCopies = sourceCopyFixture();
    const evidence = await inspectP7PackagedTrust({
      appBundle: app.appBundle,
      runnerArtifactDirectory: runner.root,
      trustedRunnerManifestSha256: runner.manifestSha256,
      expectedTargetTriple: "aarch64-apple-darwin",
      sourceCopies,
      runCommand: commandRunner(),
      verifyPackage: () => undefined,
      admitRunnerArtifact: async () => ({ targetTriple: "aarch64-apple-darwin" }),
    });
    expect(evidence).toMatchObject({
      schemaVersion: 1,
      app: {
        identity: "com.bignormal.actestra",
        signature: "adhoc",
        packageVerification: "passed",
      },
      planner: { packaged: true, manifest: "verified" },
      gooseRunner: {
        packaged: false,
        disposition: "external-admitted",
        manifest: "verified",
        sbom: "verified",
        license: "verified",
        audit: "verified",
      },
      sourceCopy: { drift: false, checked: 1 },
    });
  });

  it("fails closed when a packaged P7 hook is absent", async () => {
    const app = await buildAppFixture({ includeMarkers: false });
    const runner = buildRunnerFixture();
    await expect(
      inspectP7PackagedTrust({
        appBundle: app.appBundle,
        runnerArtifactDirectory: runner.root,
        trustedRunnerManifestSha256: runner.manifestSha256,
        expectedTargetTriple: "aarch64-apple-darwin",
        sourceCopies: sourceCopyFixture(),
        runCommand: commandRunner(),
        verifyPackage: () => undefined,
        verifyRunnerArchitecture: () => undefined,
      }),
    ).rejects.toThrow(/packaged P7 hook/u);
  });

  it("fails closed on external runner manifest digest drift", async () => {
    const app = await buildAppFixture();
    const runner = buildRunnerFixture();
    await expect(
      inspectP7PackagedTrust({
        appBundle: app.appBundle,
        runnerArtifactDirectory: runner.root,
        trustedRunnerManifestSha256: "f".repeat(64),
        expectedTargetTriple: "aarch64-apple-darwin",
        sourceCopies: sourceCopyFixture(),
        runCommand: commandRunner(),
        verifyPackage: () => undefined,
      }),
    ).rejects.toThrow(/manifest is outside the caller trust root/u);
  });

  it("fails closed when a source copy drifts", async () => {
    const app = await buildAppFixture();
    const runner = buildRunnerFixture();
    const sourceCopies = sourceCopyFixture();
    writeFileSync(path.join(sourceCopies.outputRoot, "marker.ts"), "drifted\n");
    await expect(
      inspectP7PackagedTrust({
        appBundle: app.appBundle,
        runnerArtifactDirectory: runner.root,
        trustedRunnerManifestSha256: runner.manifestSha256,
        expectedTargetTriple: "aarch64-apple-darwin",
        sourceCopies,
        runCommand: commandRunner(),
        verifyPackage: () => undefined,
        admitRunnerArtifact: async () => ({ targetTriple: "aarch64-apple-darwin" }),
      }),
    ).rejects.toThrow(/source copy drift/u);
  });
});
