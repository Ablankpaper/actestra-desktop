import path from "node:path";
import {
  GOOSE_WORKER_RESOURCE_PROFILE,
  freezeWorkerResourceBudget,
  type WorkerResourceBudget,
} from "../../core";
import { resolveGooseRunnerBuildTarget } from "./gooseRunnerTarget";

const LAUNCH_REQUIRED_KEYS = Object.freeze([
  "architecture",
  "executablePath",
  "networkPolicy",
  "parentLiveness",
  "platform",
  "privateRoot",
  "resourceBudget",
  "targetTriple",
] as const);
const LAUNCH_OPTIONAL_KEYS = Object.freeze(["workspaceDirectory"] as const);
const NETWORK_KEYS = Object.freeze([
  "capabilityProxyPort",
  "host",
  "kind",
  "modelProxyPort",
] as const);
const PARENT_LIVENESS_KEYS = Object.freeze(["kind", "token"] as const);
const EVIDENCE_KEYS = Object.freeze([
  "cleanup",
  "contractVersion",
  "executableSha256",
  "filesystem",
  "network",
  "parentDeath",
  "probeSha256",
  "processTree",
  "resources",
  "sourceCommit",
  "targetTriple",
] as const);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;

export type GooseContainmentNetwork =
  | "deny-all"
  | Readonly<{
      readonly kind: "loopback-session";
      readonly host: "127.0.0.1";
      readonly capabilityProxyPort: number;
      readonly modelProxyPort: number;
    }>;

export interface GooseContainmentLaunch {
  readonly platform: "darwin" | "win32" | "linux";
  readonly architecture: "arm64" | "x64";
  readonly targetTriple: string;
  readonly executablePath: string;
  readonly privateRoot: string;
  readonly workspaceDirectory?: string;
  readonly networkPolicy: GooseContainmentNetwork;
  readonly resourceBudget: WorkerResourceBudget;
  readonly parentLiveness: Readonly<{
    readonly kind: "inherited-ipc";
    readonly token: string;
  }>;
}

export interface GooseContainmentEvidence {
  readonly contractVersion: 1;
  readonly targetTriple: string;
  readonly sourceCommit: string;
  readonly probeSha256: string;
  readonly executableSha256: string;
  readonly filesystem: true;
  readonly network: true;
  readonly processTree: true;
  readonly resources: true;
  readonly parentDeath: true;
  readonly cleanup: true;
}

export class GooseContainmentError extends Error {
  constructor(
    readonly code: "invalid-options" | "network-policy-unavailable",
    message: string,
  ) {
    super(message);
    this.name = "GooseContainmentError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (
    keys.some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(value, key)) ||
    keys.length < required.length ||
    keys.length > allowed.size
  ) {
    throw new GooseContainmentError("invalid-options", `${label} contains unsupported fields`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\u0000")) {
    throw new GooseContainmentError("invalid-options", `${label} is invalid`);
  }
}

function assertCanonicalAbsolutePath(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.parse(value).root === value
  ) {
    throw new GooseContainmentError("invalid-options", `${label} must be a non-root absolute path`);
  }
}

function assertFixedBudget(value: unknown): asserts value is WorkerResourceBudget {
  if (!isRecord(value) || !Object.isFrozen(value)) {
    throw new GooseContainmentError("invalid-options", "Goose resource budget must be immutable");
  }
  try {
    const frozen = freezeWorkerResourceBudget(value as unknown as WorkerResourceBudget);
    for (const key of Object.keys(GOOSE_WORKER_RESOURCE_PROFILE) as Array<
      keyof WorkerResourceBudget
    >) {
      if (frozen[key] !== GOOSE_WORKER_RESOURCE_PROFILE[key]) {
        throw new GooseContainmentError(
          "invalid-options",
          "Goose resource budget differs from the admitted profile",
        );
      }
    }
  } catch (error) {
    if (error instanceof GooseContainmentError) {
      throw error;
    }
    throw new GooseContainmentError("invalid-options", "Goose resource budget is invalid");
  }
}

function assertNetworkPolicy(value: unknown): asserts value is GooseContainmentNetwork {
  if (value === "deny-all") {
    return;
  }
  if (!isRecord(value) || !Object.isFrozen(value)) {
    throw new GooseContainmentError("invalid-options", "Goose network policy is invalid");
  }
  assertExactKeys(value, NETWORK_KEYS, [], "Goose network policy");
  if (
    value.kind !== "loopback-session" ||
    value.host !== "127.0.0.1" ||
    !Number.isSafeInteger(value.capabilityProxyPort) ||
    (value.capabilityProxyPort as number) < 1 ||
    (value.capabilityProxyPort as number) > 65_535 ||
    !Number.isSafeInteger(value.modelProxyPort) ||
    (value.modelProxyPort as number) < 1 ||
    (value.modelProxyPort as number) > 65_535 ||
    value.capabilityProxyPort === value.modelProxyPort
  ) {
    throw new GooseContainmentError("invalid-options", "Goose loopback network policy is invalid");
  }
}

function assertParentLiveness(
  value: unknown,
): asserts value is GooseContainmentLaunch["parentLiveness"] {
  if (!isRecord(value) || !Object.isFrozen(value)) {
    throw new GooseContainmentError("invalid-options", "Goose parent liveness is invalid");
  }
  assertExactKeys(value, PARENT_LIVENESS_KEYS, [], "Goose parent liveness");
  if (
    value.kind !== "inherited-ipc" ||
    typeof value.token !== "string" ||
    !/^[A-Za-z0-9._~-]{32,256}$/.test(value.token)
  ) {
    throw new GooseContainmentError("invalid-options", "Goose parent liveness is invalid");
  }
}

export function assertGooseContainmentLaunch(
  value: unknown,
): asserts value is GooseContainmentLaunch {
  if (!isRecord(value) || !Object.isFrozen(value)) {
    throw new GooseContainmentError("invalid-options", "Goose containment launch is not immutable");
  }
  assertExactKeys(value, LAUNCH_REQUIRED_KEYS, LAUNCH_OPTIONAL_KEYS, "Goose containment launch");
  if (value.platform !== "darwin" && value.platform !== "win32" && value.platform !== "linux") {
    throw new GooseContainmentError("invalid-options", "Goose platform is unsupported");
  }
  if (value.architecture !== "arm64" && value.architecture !== "x64") {
    throw new GooseContainmentError("invalid-options", "Goose architecture is unsupported");
  }
  assertNonEmptyString(value.targetTriple, "Goose target triple");
  const target = resolveGooseRunnerBuildTarget(value.platform, value.architecture);
  if (target === undefined || target.targetTriple !== value.targetTriple) {
    throw new GooseContainmentError(
      "invalid-options",
      "Goose target does not match the host contract",
    );
  }
  assertCanonicalAbsolutePath(value.executablePath, "Goose executable path");
  assertCanonicalAbsolutePath(value.privateRoot, "Goose private root");
  if (Object.hasOwn(value, "workspaceDirectory")) {
    assertCanonicalAbsolutePath(value.workspaceDirectory, "Goose workspace directory");
  }
  assertFixedBudget(value.resourceBudget);
  assertNetworkPolicy(value.networkPolicy);
  assertParentLiveness(value.parentLiveness);
}

export function hasVerifiedGooseContainment(
  evidence: GooseContainmentEvidence | undefined,
  artifact: Readonly<{ targetTriple: string; executableSha256: string; sourceCommit: string }>,
): boolean {
  if (
    evidence === undefined ||
    !Object.isFrozen(evidence) ||
    !isRecord(evidence) ||
    Object.keys(evidence).length !== EVIDENCE_KEYS.length ||
    Object.keys(evidence).some(
      (key) => !EVIDENCE_KEYS.includes(key as (typeof EVIDENCE_KEYS)[number]),
    )
  ) {
    return false;
  }
  return (
    evidence.contractVersion === 1 &&
    evidence.targetTriple === artifact.targetTriple &&
    evidence.sourceCommit === artifact.sourceCommit &&
    evidence.executableSha256 === artifact.executableSha256 &&
    COMMIT_PATTERN.test(evidence.sourceCommit) &&
    SHA256_PATTERN.test(evidence.probeSha256) &&
    SHA256_PATTERN.test(evidence.executableSha256) &&
    evidence.filesystem === true &&
    evidence.network === true &&
    evidence.processTree === true &&
    evidence.resources === true &&
    evidence.parentDeath === true &&
    evidence.cleanup === true
  );
}
