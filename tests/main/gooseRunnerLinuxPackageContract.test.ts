// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const contractPath = path.join(
  repositoryRoot,
  "apps/desktop/src/shared/gooseRunnerLinuxPackage.ts",
);
const profilePath = path.join(
  repositoryRoot,
  "apps/desktop/resources/linux/actestra-apparmor-profile",
);

const expectedProfile = `abi <abi/4.0>,
include <tunables/global>

profile "Actestra" "/opt/Actestra/Actestra" flags=(unconfined) {
  userns,
}

profile "Actestra-Goose-Runner" "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner" flags=(unconfined) {
  userns,
}
`;

describe("Ubuntu Goose package contract", () => {
  it("publishes only the fixed install identity and seven-key admission record", () => {
    expect(existsSync(contractPath)).toBe(true);
    if (!existsSync(contractPath)) return;

    const moduleUrl = pathToFileURL(contractPath).href;
    const script = [
      `const contract = await import(${JSON.stringify(moduleUrl)});`,
      "const valid = {",
      "contractVersion: 1,",
      'targetTriple: "x86_64-unknown-linux-gnu",',
      'runnerManifestSha256: "a".repeat(64),',
      'executableSha256: "b".repeat(64),',
      'profileSha256: "c".repeat(64),',
      'profileName: "Actestra-Goose-Runner",',
      'executablePath: "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",',
      "};",
      "const accepted = contract.parseGooseRunnerLinuxPackageAdmission(valid);",
      "const mutations = [",
      "null, [], {},",
      "{ ...valid, unexpected: true },",
      "{ ...valid, contractVersion: 2 },",
      '{ ...valid, targetTriple: "x86_64-unknown-linux-musl" },',
      '{ ...valid, runnerManifestSha256: "A".repeat(64) },',
      '{ ...valid, executableSha256: "b".repeat(63) },',
      '{ ...valid, profileSha256: "not-a-digest" },',
      '{ ...valid, profileName: "Actestra" },',
      '{ ...valid, executablePath: "/tmp/runner" },',
      "];",
      "console.log(JSON.stringify({",
      "constants: {",
      "installRoot: contract.GOOSE_LINUX_INSTALL_ROOT,",
      "resourcesPath: contract.GOOSE_LINUX_RESOURCES_PATH,",
      "artifactDirectory: contract.GOOSE_LINUX_ARTIFACT_DIRECTORY,",
      "executablePath: contract.GOOSE_LINUX_EXECUTABLE_PATH,",
      "recordFile: contract.GOOSE_LINUX_ADMISSION_RECORD_FILE,",
      "profileName: contract.GOOSE_LINUX_PROFILE_NAME,",
      "targetTriple: contract.GOOSE_LINUX_TARGET_TRIPLE,",
      "},",
      "accepted,",
      "acceptedFrozen: Object.isFrozen(accepted),",
      "rejected: mutations.map((value) => contract.parseGooseRunnerLinuxPackageAdmission(value) === null),",
      "}));",
    ].join("\n");
    const result = spawnSync("bun", ["--eval", script], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      constants: {
        installRoot: "/opt/Actestra",
        resourcesPath: "/opt/Actestra/resources",
        artifactDirectory: "/opt/Actestra/resources/actestra-goose-runner",
        executablePath: "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",
        recordFile: "actestra-goose-runner-admission.json",
        profileName: "Actestra-Goose-Runner",
        targetTriple: "x86_64-unknown-linux-gnu",
      },
      accepted: {
        contractVersion: 1,
        targetTriple: "x86_64-unknown-linux-gnu",
        runnerManifestSha256: "a".repeat(64),
        executableSha256: "b".repeat(64),
        profileSha256: "c".repeat(64),
        profileName: "Actestra-Goose-Runner",
        executablePath: "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner",
      },
      acceptedFrozen: true,
      rejected: Array.from({ length: 11 }, () => true),
    });
  });

  it("ships one exact two-entry AppArmor profile without widened authority", () => {
    expect(existsSync(profilePath)).toBe(true);
    if (!existsSync(profilePath)) return;

    const profile = readFileSync(profilePath, "utf8");
    expect(profile).toBe(expectedProfile);
    expect(profile.match(/^profile /gmu)).toHaveLength(2);
    expect(profile.match(/^  userns,$/gmu)).toHaveLength(2);
    for (const forbidden of [
      "*",
      "goose-attempt-",
      "capability ",
      "network ",
      "mount ",
      "/bin/",
      "/home/",
      "include if exists",
      "local/",
    ]) {
      expect(profile).not.toContain(forbidden);
    }
  });
});
