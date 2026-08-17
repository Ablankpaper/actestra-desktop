// @vitest-environment node

import { describe, expect, it } from "vitest";
import type { AdmittedGooseRunnerArtifact } from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import {
  admitInstalledGooseRunnerLinuxPackage,
  GOOSE_LINUX_BOOTSTRAP_OK_MARKER,
  inspectInstalledGooseRunnerLinuxPackageAdmission,
  type GooseRunnerLinuxPackageAdmissionDependencies,
  type LinuxPackagePathMetadata,
} from "../../apps/desktop/src/main/workers/gooseRunnerLinuxPackage";
import {
  GOOSE_LINUX_ADMISSION_RECORD_FILE,
  GOOSE_LINUX_ARTIFACT_DIRECTORY,
  GOOSE_LINUX_EXECUTABLE_PATH,
  GOOSE_LINUX_PROFILE_NAME,
  GOOSE_LINUX_RESOURCES_PATH,
  GOOSE_LINUX_TARGET_TRIPLE,
} from "../../apps/desktop/src/shared/gooseRunnerLinuxPackage";

const artifact = Object.freeze({
  directory: GOOSE_LINUX_ARTIFACT_DIRECTORY,
  executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
  executableSha256: "b".repeat(64),
  executableSize: 10,
  targetTriple: GOOSE_LINUX_TARGET_TRIPLE,
  sourceCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  gooseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759",
  gooseVersion: "1.45.0",
  manifestPath: `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner.manifest.json`,
  manifestSha256: "a".repeat(64),
}) satisfies AdmittedGooseRunnerArtifact;

const record = Object.freeze({
  contractVersion: 1 as const,
  targetTriple: GOOSE_LINUX_TARGET_TRIPLE,
  runnerManifestSha256: artifact.manifestSha256,
  executableSha256: artifact.executableSha256,
  profileSha256: "c".repeat(64),
  profileName: GOOSE_LINUX_PROFILE_NAME,
  executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
});

function metadata(kind: LinuxPackagePathMetadata["kind"], size = 1): LinuxPackagePathMetadata {
  return Object.freeze({
    canonicalPath: "",
    kind,
    mode: kind === "directory" ? 0o755 : 0o644,
    size,
    uid: 0,
  });
}

function packagePaths(): readonly string[] {
  return Object.freeze([
    "/opt",
    "/opt/Actestra",
    GOOSE_LINUX_RESOURCES_PATH,
    GOOSE_LINUX_ARTIFACT_DIRECTORY,
    `${GOOSE_LINUX_RESOURCES_PATH}/apparmor-profile`,
    `${GOOSE_LINUX_RESOURCES_PATH}/${GOOSE_LINUX_ADMISSION_RECORD_FILE}`,
    `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner`,
    `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner.manifest.json`,
    `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner.cdx.json`,
    `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner.audit.json`,
    `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/Cargo.lock`,
    `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/GOOSE-APACHE-2.0.txt`,
  ]);
}

function fixture(
  fault:
    | "missing-profile"
    | "profile-digest-drift"
    | "manifest-digest-drift"
    | "executable-digest-drift"
    | "symlink-component"
    | "non-root-owner"
    | "group-writable"
    | "other-writable"
    | "wrong-resources-path"
    | "bootstrap-failure"
    | "artifact-admission-failure"
    | "none" = "none",
): GooseRunnerLinuxPackageAdmissionDependencies & { resourcesPath: string } {
  const resourcesPath = GOOSE_LINUX_RESOURCES_PATH;
  const metadataByPath = new Map<string, LinuxPackagePathMetadata>();
  for (const filePath of packagePaths()) {
    const isDirectory =
      filePath === "/opt" ||
      filePath === "/opt/Actestra" ||
      filePath === resourcesPath ||
      filePath === GOOSE_LINUX_ARTIFACT_DIRECTORY;
    const fileMetadata = metadata(isDirectory ? "directory" : "file", isDirectory ? 0 : 10);
    metadataByPath.set(
      filePath,
      filePath === `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner`
        ? Object.freeze({ ...fileMetadata, mode: 0o744 })
        : fileMetadata,
    );
  }
  const profilePath = `${resourcesPath}/apparmor-profile`;
  const recordPath = `${resourcesPath}/${GOOSE_LINUX_ADMISSION_RECORD_FILE}`;
  if (fault === "missing-profile") metadataByPath.delete(profilePath);
  if (fault === "non-root-owner") {
    metadataByPath.set(
      GOOSE_LINUX_ARTIFACT_DIRECTORY,
      Object.freeze({ ...metadataByPath.get(GOOSE_LINUX_ARTIFACT_DIRECTORY)!, uid: 1000 }),
    );
  }
  if (fault === "group-writable") {
    metadataByPath.set(
      GOOSE_LINUX_ARTIFACT_DIRECTORY,
      Object.freeze({ ...metadataByPath.get(GOOSE_LINUX_ARTIFACT_DIRECTORY)!, mode: 0o775 }),
    );
  }
  if (fault === "other-writable") {
    metadataByPath.set(
      profilePath,
      Object.freeze({ ...metadataByPath.get(profilePath)!, mode: 0o646 }),
    );
  }
  if (fault === "symlink-component") {
    metadataByPath.set(
      "/opt/Actestra",
      Object.freeze({ ...metadataByPath.get("/opt/Actestra")!, canonicalPath: "/tmp/Actestra" }),
    );
  }
  const hashes = new Map<string, string>([
    [profilePath, record.profileSha256],
    [recordPath, "d".repeat(64)],
    [
      `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner.manifest.json`,
      artifact.manifestSha256,
    ],
    [`${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner`, artifact.executableSha256],
  ]);
  if (fault === "profile-digest-drift") hashes.set(profilePath, "e".repeat(64));
  if (fault === "manifest-digest-drift") {
    hashes.set(
      `${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner.manifest.json`,
      "f".repeat(64),
    );
  }
  if (fault === "executable-digest-drift") {
    hashes.set(`${GOOSE_LINUX_ARTIFACT_DIRECTORY}/actestra-goose-runner`, "1".repeat(64));
  }
  return {
    resourcesPath,
    lstat: async (filePath) => {
      const value = metadataByPath.get(filePath);
      if (value === undefined) throw new Error("missing");
      return Object.freeze({ ...value, canonicalPath: value.canonicalPath || filePath });
    },
    readFile: async () => Buffer.from(`${JSON.stringify(record)}\n`),
    sha256File: async (filePath) => hashes.get(filePath) ?? "0".repeat(64),
    admitRunnerArtifact: async () => {
      if (fault === "artifact-admission-failure") throw new Error("injected artifact rejection");
      return artifact;
    },
    runBootstrapCheck: async () => fault !== "bootstrap-failure",
  };
}

describe("Main-owned Ubuntu Goose package admission", () => {
  it("admits only the fixed root-owned package and runs the bounded bootstrap probe", async () => {
    const value = fixture();
    const admitted = await admitInstalledGooseRunnerLinuxPackage(value.resourcesPath, value);

    expect(admitted).not.toBeNull();
    expect(admitted!.artifact).toMatchObject(artifact);
    expect(admitted!.artifact.linuxInstall).toEqual({
      contractVersion: 1,
      resourcesPath: GOOSE_LINUX_RESOURCES_PATH,
      executablePath: GOOSE_LINUX_EXECUTABLE_PATH,
      runnerManifestSha256: artifact.manifestSha256,
      executableSha256: artifact.executableSha256,
      profileSha256: record.profileSha256,
    });
    expect(Object.isFrozen(admitted!.artifact.linuxInstall)).toBe(true);
    expect(admitted!.record).toEqual(record);
    expect(admitted!.executablePath).toBe(GOOSE_LINUX_EXECUTABLE_PATH);
    expect(admitted!.bootstrapMarker).toBe(GOOSE_LINUX_BOOTSTRAP_OK_MARKER);
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it.each([
    "missing-profile",
    "profile-digest-drift",
    "manifest-digest-drift",
    "executable-digest-drift",
    "symlink-component",
    "non-root-owner",
    "group-writable",
    "other-writable",
    "wrong-resources-path",
    "bootstrap-failure",
  ] as const)("rejects %s before any artifact can be used", async (fault) => {
    const value = fixture(fault === "wrong-resources-path" ? "none" : fault);
    const result = await admitInstalledGooseRunnerLinuxPackage(
      fault === "wrong-resources-path" ? "/opt/Actestra/resources-link" : value.resourcesPath,
      value,
    );
    expect(result).toBeNull();
  });

  it.each([
    ["missing-profile", "linux-package-path-metadata-invalid"],
    ["profile-digest-drift", "linux-package-profile-digest-mismatch"],
    ["manifest-digest-drift", "linux-package-artifact-binding-mismatch"],
    ["executable-digest-drift", "linux-package-artifact-binding-mismatch"],
    ["symlink-component", "linux-package-path-metadata-invalid"],
    ["non-root-owner", "linux-package-path-metadata-invalid"],
    ["group-writable", "linux-package-path-metadata-invalid"],
    ["other-writable", "linux-package-path-metadata-invalid"],
    ["wrong-resources-path", "linux-package-resources-path-invalid"],
    ["bootstrap-failure", "linux-package-bootstrap-failed"],
    ["artifact-admission-failure", "linux-package-artifact-admission-failed"],
  ] as const)("reports only the closed %s rejection reason", async (fault, code) => {
    const value = fixture(fault === "wrong-resources-path" ? "none" : fault);
    const result = await inspectInstalledGooseRunnerLinuxPackageAdmission(
      fault === "wrong-resources-path" ? "/opt/Actestra/resources-link" : value.resourcesPath,
      value,
    );

    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain("injected artifact rejection");
  });
});
