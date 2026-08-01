import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import sourceContract from "../../apps/desktop/src/shared/gooseRunnerSource.json";
import {
  GOOSE_RUNNER_MANIFEST_FILE,
  admitGooseRunnerArtifact,
} from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";

const fixtureDirectories: string[] = [];

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildToolEvidence(
  name: "cargo-auditable" | "cargo-audit",
  pin: Readonly<{ version: string; commit: string }>,
  executableDigestCharacter: string,
) {
  const asset = sourceContract.buildToolAssets["darwin-arm64"].find(
    (candidate) => candidate.name === name,
  );
  if (asset === undefined) {
    throw new Error(`Missing ${name} fixture asset`);
  }
  return {
    ...pin,
    archiveSha256: asset.sha256,
    executableSha256: executableDigestCharacter.repeat(64),
  };
}

function admissionOptions(trustedManifestSha256: string) {
  return {
    expectedTargetTriple: "aarch64-apple-darwin",
    trustedManifestSha256,
  } as const;
}

async function createArtifactFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "actestra-goose-artifact-"));
  fixtureDirectories.push(directory);

  const executable = Buffer.from("fixture-goose-runner", "utf8");
  const lockfile = [
    "version = 4",
    'name = "goose"',
    'version = "1.45.0"',
    `source = "git+https://github.com/aaif-goose/goose?rev=${sourceContract.goose.commit}#${sourceContract.goose.commit}"`,
    'name = "event-listener"',
    'version = "5.4.2"',
    "",
  ].join("\n");
  const license = await readFile(
    path.resolve("workers/goose-runner/licenses/GOOSE-APACHE-2.0.txt"),
  );
  const sbom = JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000001",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": `pkg:cargo/${sourceContract.runner.name}@${sourceContract.runner.version}`,
        name: sourceContract.runner.name,
        version: sourceContract.runner.version,
      },
    },
    components: [
      {
        type: "library",
        "bom-ref": `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
        name: "goose",
        version: sourceContract.goose.version,
        purl: `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
      },
    ],
    dependencies: [
      {
        ref: `pkg:cargo/${sourceContract.runner.name}@${sourceContract.runner.version}`,
        dependsOn: [
          `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
        ],
      },
      {
        ref: `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
        dependsOn: [],
      },
    ],
  });
  const audit = JSON.stringify({
    contractVersion: 1,
    cargoAudit: buildToolEvidence("cargo-audit", sourceContract.buildTools.cargoAudit, "a"),
    advisoryDatabase: {
      commit: "1111111111111111111111111111111111111111",
      fetchedAt: "2026-08-01T07:59:00.000Z",
      checkedAt: "2026-08-01T08:00:00.000Z",
    },
    reachability: {
      targetTriple: "aarch64-apple-darwin",
      activeDependencyCount: 1,
      cargoTreeDependencyCount: 1,
      compilerArtifactPackageCount: 2,
      cargoTreeAllTargets: {
        rsa: "no-path",
        sqlxMysql: "no-path",
      },
      compilerArtifactsAbsent: ["rsa", "sqlx-mysql"],
    },
    binary: {
      auditableDependencyCount: 12,
      vulnerabilities: [
        {
          id: "RUSTSEC-2023-0071",
          package: { name: "rsa", version: "0.9.10" },
          disposition: "metadata-only-not-compiled",
          proof: "cargo-tree-all-targets-no-path",
          source: "cargo-audit-bin",
        },
      ],
      unsound: [],
    },
    lock: {
      dependencyCount: 20,
      vulnerabilities: [
        {
          id: "RUSTSEC-2023-0071",
          package: { name: "rsa", version: "0.9.10" },
          disposition: "metadata-only-not-compiled",
          proof: "cargo-tree-all-targets-no-path",
          source: "cargo-audit-lock",
        },
      ],
      unsound: [],
      unmaintained: [],
      yanked: { complete: true, packages: [] },
    },
  });

  await Promise.all([
    writeFile(path.join(directory, "actestra-goose-runner"), executable),
    writeFile(path.join(directory, "Cargo.lock"), lockfile),
    writeFile(path.join(directory, "GOOSE-APACHE-2.0.txt"), license),
    writeFile(path.join(directory, "actestra-goose-runner.cdx.json"), sbom),
    writeFile(path.join(directory, "actestra-goose-runner.audit.json"), audit),
  ]);
  await chmod(path.join(directory, "actestra-goose-runner"), 0o755);

  const manifest = {
    contractVersion: 1,
    runner: {
      name: sourceContract.runner.name,
      version: sourceContract.runner.version,
      targetTriple: "aarch64-apple-darwin",
      executable: {
        file: "actestra-goose-runner",
        sha256: sha256(executable),
        size: executable.byteLength,
      },
    },
    goose: sourceContract.goose,
    acp: sourceContract.acp,
    build: {
      rustToolchain: sourceContract.rust,
      profile: "release",
      cargoAuditable: buildToolEvidence(
        "cargo-auditable",
        sourceContract.buildTools.cargoAuditable,
        "b",
      ),
      lockfile: {
        file: "Cargo.lock",
        sha256: sha256(lockfile),
      },
      sourceTreeSha256: "2222222222222222222222222222222222222222222222222222222222222222",
    },
    materials: {
      license: {
        file: "GOOSE-APACHE-2.0.txt",
        spdx: sourceContract.license.spdx,
        sha256: sha256(license),
      },
      sbom: {
        file: "actestra-goose-runner.cdx.json",
        format: "CycloneDX",
        specVersion: "1.6",
        sha256: sha256(sbom),
      },
      audit: {
        file: "actestra-goose-runner.audit.json",
        sha256: sha256(audit),
      },
    },
    provenance: {
      actestraCommit: "3333333333333333333333333333333333333333",
      dirty: false,
      builder: "local",
      builtAt: "2026-08-01T08:00:00.000Z",
      command: "cargo auditable build --locked --release --message-format=json-render-diagnostics",
    },
  };
  const manifestBytes = `${JSON.stringify(manifest, null, 2)}\n`;
  await writeFile(path.join(directory, GOOSE_RUNNER_MANIFEST_FILE), manifestBytes);
  return { directory, manifest, manifestSha256: sha256(manifestBytes) };
}

afterEach(async () => {
  await Promise.all(
    fixtureDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Goose runner artifact admission", () => {
  it("admits an exact immutable runner bundle", async () => {
    const { directory, manifestSha256 } = await createArtifactFixture();
    const artifact = await admitGooseRunnerArtifact(directory, admissionOptions(manifestSha256));
    const canonicalDirectory = await realpath(directory);

    expect(artifact).toMatchObject({
      directory: canonicalDirectory,
      targetTriple: "aarch64-apple-darwin",
      executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      gooseCommit: sourceContract.goose.commit,
      gooseVersion: sourceContract.goose.version,
    });
    expect(artifact.executablePath).toBe(path.join(canonicalDirectory, "actestra-goose-runner"));
  });

  it("rejects a self-consistent artifact outside the caller trust root", async () => {
    const { directory } = await createArtifactFixture();

    await expect(
      admitGooseRunnerArtifact(directory, admissionOptions("f".repeat(64))),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "digest-mismatch",
    });
  });

  it("rejects an artifact directory symbolic link", async () => {
    const { directory, manifestSha256 } = await createArtifactFixture();
    const linkedDirectory = path.join(directory, "bundle-link");
    await symlink(directory, linkedDirectory, "dir");

    await expect(
      admitGooseRunnerArtifact(linkedDirectory, admissionOptions(manifestSha256)),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "invalid-manifest",
    });
  });

  it("rejects an unexpected artifact-directory entry", async () => {
    const { directory, manifestSha256 } = await createArtifactFixture();
    await writeFile(path.join(directory, "untrusted-sidecar"), "unexpected");

    await expect(
      admitGooseRunnerArtifact(directory, admissionOptions(manifestSha256)),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "invalid-manifest",
    });
  });

  it("rejects a trusted manifest built for another target", async () => {
    const { directory, manifestSha256 } = await createArtifactFixture();

    await expect(
      admitGooseRunnerArtifact(directory, {
        expectedTargetTriple: "x86_64-apple-darwin",
        trustedManifestSha256: manifestSha256,
      }),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "incompatible-artifact",
    });
  });

  it("rejects executable tampering after the manifest was created", async () => {
    const { directory, manifestSha256 } = await createArtifactFixture();
    await writeFile(path.join(directory, "actestra-goose-runner"), "tampered");

    await expect(
      admitGooseRunnerArtifact(directory, admissionOptions(manifestSha256)),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "digest-mismatch",
    });
  });

  it("rejects a widened Goose feature set", async () => {
    const { directory, manifest } = await createArtifactFixture();
    const widenedManifest = JSON.stringify({
      ...manifest,
      goose: {
        ...manifest.goose,
        cargoFeatures: ["telemetry"],
      },
    });
    await writeFile(path.join(directory, GOOSE_RUNNER_MANIFEST_FILE), widenedManifest);

    await expect(
      admitGooseRunnerArtifact(directory, admissionOptions(sha256(widenedManifest))),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "incompatible-artifact",
    });
  });

  it("rejects stale RustSec database fetch evidence", async () => {
    const { directory, manifest } = await createArtifactFixture();
    const auditPath = path.join(directory, "actestra-goose-runner.audit.json");
    const audit = JSON.parse(await readFile(auditPath, "utf8")) as {
      readonly advisoryDatabase: Readonly<Record<string, unknown>>;
    };
    const staleAudit = JSON.stringify({
      ...audit,
      advisoryDatabase: {
        ...audit.advisoryDatabase,
        fetchedAt: "2026-07-01T08:00:00.000Z",
      },
    });
    const staleManifest = JSON.stringify({
      ...manifest,
      materials: {
        ...manifest.materials,
        audit: {
          ...manifest.materials.audit,
          sha256: sha256(staleAudit),
        },
      },
    });
    await Promise.all([
      writeFile(auditPath, staleAudit),
      writeFile(path.join(directory, GOOSE_RUNNER_MANIFEST_FILE), staleManifest),
    ]);

    await expect(
      admitGooseRunnerArtifact(directory, admissionOptions(sha256(staleManifest))),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "unsafe-audit",
    });
  });

  it("rejects a vulnerability present in the compiled binary", async () => {
    const { directory, manifest } = await createArtifactFixture();
    const unsafeAudit = JSON.stringify({
      contractVersion: 1,
      cargoAudit: buildToolEvidence("cargo-audit", sourceContract.buildTools.cargoAudit, "a"),
      advisoryDatabase: {
        commit: "1111111111111111111111111111111111111111",
        fetchedAt: "2026-08-01T07:59:00.000Z",
        checkedAt: "2026-08-01T08:00:00.000Z",
      },
      reachability: {
        targetTriple: "aarch64-apple-darwin",
        activeDependencyCount: 1,
        cargoTreeDependencyCount: 1,
        compilerArtifactPackageCount: 2,
        cargoTreeAllTargets: {
          rsa: "no-path",
          sqlxMysql: "no-path",
        },
        compilerArtifactsAbsent: ["rsa", "sqlx-mysql"],
      },
      binary: {
        auditableDependencyCount: 12,
        vulnerabilities: [
          {
            id: "RUSTSEC-2099-0001",
            package: { name: "unknown", version: "1.0.0" },
            disposition: "metadata-only-not-compiled",
            proof: "cargo-tree-all-targets-no-path",
            source: "cargo-audit-bin",
          },
        ],
        unsound: [],
      },
      lock: {
        dependencyCount: 20,
        vulnerabilities: [],
        unsound: [],
        unmaintained: [],
        yanked: { complete: true, packages: [] },
      },
    });
    await writeFile(path.join(directory, "actestra-goose-runner.audit.json"), unsafeAudit);
    const unsafeManifest = JSON.stringify({
      ...manifest,
      materials: {
        ...manifest.materials,
        audit: {
          ...manifest.materials.audit,
          sha256: sha256(unsafeAudit),
        },
      },
    });
    await writeFile(path.join(directory, GOOSE_RUNNER_MANIFEST_FILE), unsafeManifest);

    await expect(
      admitGooseRunnerArtifact(directory, admissionOptions(sha256(unsafeManifest))),
    ).rejects.toMatchObject({
      name: "GooseRunnerArtifactError",
      code: "unsafe-audit",
    });
  });
});
