import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  inspectInstalledGooseRunnerLinuxPackageAdmission,
  type GooseRunnerLinuxPackageAdmissionFailureCode,
  type GooseRunnerLinuxPackagePathFailureReason,
  type GooseRunnerLinuxPackagePathId,
} from "../apps/desktop/src/main/workers/gooseRunnerLinuxPackage";
import { GOOSE_LINUX_RESOURCES_PATH } from "../apps/desktop/src/shared/gooseRunnerLinuxPackage";

type InstalledPackageInspection = () => Promise<
  | Readonly<{
      readonly ok: true;
      readonly value: Readonly<{
        readonly artifact: Readonly<{
          readonly targetTriple: string;
          readonly manifestSha256: string;
          readonly executableSha256: string;
        }>;
        readonly record: Readonly<{ readonly profileSha256: string }>;
      }>;
    }>
  | Readonly<
      | {
          readonly ok: false;
          readonly code: "linux-package-path-metadata-invalid";
          readonly pathId: GooseRunnerLinuxPackagePathId;
          readonly reason: GooseRunnerLinuxPackagePathFailureReason;
        }
      | {
          readonly ok: false;
          readonly code: Exclude<
            GooseRunnerLinuxPackageAdmissionFailureCode,
            "linux-package-path-metadata-invalid"
          >;
        }
    >
>;

export type AionuiLinuxGooseInstallVerification =
  | Readonly<{
      readonly status: "verified";
      readonly targetTriple: string;
      readonly runnerManifestSha256: string;
      readonly executableSha256: string;
      readonly profileSha256: string;
    }>
  | Readonly<
      | {
          readonly status: "failed";
          readonly code: "linux-package-path-metadata-invalid";
          readonly pathId: GooseRunnerLinuxPackagePathId;
          readonly reason: GooseRunnerLinuxPackagePathFailureReason;
        }
      | {
          readonly status: "failed";
          readonly code: Exclude<
            GooseRunnerLinuxPackageAdmissionFailureCode,
            "linux-package-path-metadata-invalid"
          >;
        }
    >;

export async function verifyAionuiLinuxGooseInstall(
  inspect: InstalledPackageInspection = () =>
    inspectInstalledGooseRunnerLinuxPackageAdmission(GOOSE_LINUX_RESOURCES_PATH),
): Promise<AionuiLinuxGooseInstallVerification> {
  const result = await inspect();
  if (!result.ok) {
    if (result.code === "linux-package-path-metadata-invalid") {
      return Object.freeze({
        status: "failed",
        code: result.code,
        pathId: result.pathId,
        reason: result.reason,
      });
    }
    return Object.freeze({ status: "failed", code: result.code });
  }
  return Object.freeze({
    status: "verified",
    targetTriple: result.value.artifact.targetTriple,
    runnerManifestSha256: result.value.artifact.manifestSha256,
    executableSha256: result.value.artifact.executableSha256,
    profileSha256: result.value.record.profileSha256,
  });
}

async function main(): Promise<void> {
  const result = await verifyAionuiLinuxGooseInstall();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "verified") process.exitCode = 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
