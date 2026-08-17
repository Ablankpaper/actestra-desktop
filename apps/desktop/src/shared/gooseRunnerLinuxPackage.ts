export const GOOSE_LINUX_INSTALL_ROOT = "/opt/Actestra" as const;
export const GOOSE_LINUX_RESOURCES_PATH = "/opt/Actestra/resources" as const;
export const GOOSE_LINUX_ARTIFACT_DIRECTORY =
  "/opt/Actestra/resources/actestra-goose-runner" as const;
export const GOOSE_LINUX_EXECUTABLE_PATH =
  "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner" as const;
export const GOOSE_LINUX_ADMISSION_RECORD_FILE = "actestra-goose-runner-admission.json" as const;
export const GOOSE_LINUX_PROFILE_NAME = "Actestra-Goose-Runner" as const;
export const GOOSE_LINUX_TARGET_TRIPLE = "x86_64-unknown-linux-gnu" as const;

const ADMISSION_KEYS = Object.freeze([
  "contractVersion",
  "executablePath",
  "executableSha256",
  "profileName",
  "profileSha256",
  "runnerManifestSha256",
  "targetTriple",
] as const);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface GooseRunnerLinuxPackageAdmission {
  readonly contractVersion: 1;
  readonly targetTriple: typeof GOOSE_LINUX_TARGET_TRIPLE;
  readonly runnerManifestSha256: string;
  readonly executableSha256: string;
  readonly profileSha256: string;
  readonly profileName: typeof GOOSE_LINUX_PROFILE_NAME;
  readonly executablePath: typeof GOOSE_LINUX_EXECUTABLE_PATH;
}

function ownDataProperty(value: object, key: string): unknown | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, "value")
    ? descriptor.value
    : undefined;
}

export function parseGooseRunnerLinuxPackageAdmission(
  value: unknown,
): Readonly<GooseRunnerLinuxPackageAdmission> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== ADMISSION_KEYS.length ||
    keys.some(
      (key) =>
        typeof key !== "string" || !ADMISSION_KEYS.includes(key as (typeof ADMISSION_KEYS)[number]),
    ) ||
    ADMISSION_KEYS.some((key) => ownDataProperty(value, key) === undefined)
  ) {
    return null;
  }
  const contractVersion = ownDataProperty(value, "contractVersion");
  const targetTriple = ownDataProperty(value, "targetTriple");
  const runnerManifestSha256 = ownDataProperty(value, "runnerManifestSha256");
  const executableSha256 = ownDataProperty(value, "executableSha256");
  const profileSha256 = ownDataProperty(value, "profileSha256");
  const profileName = ownDataProperty(value, "profileName");
  const executablePath = ownDataProperty(value, "executablePath");
  if (
    contractVersion !== 1 ||
    targetTriple !== GOOSE_LINUX_TARGET_TRIPLE ||
    typeof runnerManifestSha256 !== "string" ||
    !SHA256_PATTERN.test(runnerManifestSha256) ||
    typeof executableSha256 !== "string" ||
    !SHA256_PATTERN.test(executableSha256) ||
    typeof profileSha256 !== "string" ||
    !SHA256_PATTERN.test(profileSha256) ||
    profileName !== GOOSE_LINUX_PROFILE_NAME ||
    executablePath !== GOOSE_LINUX_EXECUTABLE_PATH
  ) {
    return null;
  }
  return Object.freeze({
    contractVersion,
    targetTriple,
    runnerManifestSha256,
    executableSha256,
    profileSha256,
    profileName,
    executablePath,
  });
}
