import sourceContract from "../../shared/gooseRunnerSource.json";

export interface GooseRunnerBuildTarget {
  readonly platform: string;
  readonly architecture: string;
  readonly targetTriple: string;
  readonly buildToolHost: string;
  readonly executableFile: string;
}

export type GooseExecutableAuthority = "attempt-private" | "linux-package" | "windows-supervisor";

const TARGET_KEYS = [
  "architecture",
  "buildToolHost",
  "executableFile",
  "platform",
  "targetTriple",
] as const;

function projectTarget(value: unknown): GooseRunnerBuildTarget {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Goose runner build target is invalid");
  }
  const record = value as Record<string, unknown>;
  const actualKeys = Object.keys(record);
  if (
    actualKeys.length !== TARGET_KEYS.length ||
    actualKeys.some((key) => !TARGET_KEYS.includes(key as (typeof TARGET_KEYS)[number])) ||
    TARGET_KEYS.some(
      (key) => typeof record[key] !== "string" || (record[key] as string).length === 0,
    )
  ) {
    throw new Error("Goose runner build target contract is invalid");
  }
  return Object.freeze({
    platform: record.platform as string,
    architecture: record.architecture as string,
    targetTriple: record.targetTriple as string,
    buildToolHost: record.buildToolHost as string,
    executableFile: record.executableFile as string,
  });
}

export function validateGooseRunnerBuildTargets(value: unknown): readonly GooseRunnerBuildTarget[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Goose runner build targets are invalid");
  }
  const targets = Object.freeze(value.map(projectTarget));
  if (
    new Set(targets.map((target) => target.platform + "-" + target.architecture)).size !==
      targets.length ||
    new Set(targets.map(({ targetTriple }) => targetTriple)).size !== targets.length
  ) {
    throw new Error("Goose runner build target identities are ambiguous");
  }
  return targets;
}

export const GOOSE_RUNNER_BUILD_TARGETS = validateGooseRunnerBuildTargets(
  sourceContract.buildTargets,
);

export function resolveGooseRunnerBuildTarget(
  platform: string,
  architecture: string,
): GooseRunnerBuildTarget | undefined {
  return GOOSE_RUNNER_BUILD_TARGETS.find(
    (target) => target.platform === platform && target.architecture === architecture,
  );
}

export function resolveGooseRunnerBuildTargetByTriple(
  targetTriple: string,
): GooseRunnerBuildTarget | undefined {
  return GOOSE_RUNNER_BUILD_TARGETS.find((target) => target.targetTriple === targetTriple);
}

export function resolveGooseRunnerRuntimeTarget(
  platform: string,
  architecture: string,
): GooseRunnerBuildTarget | undefined {
  const target = resolveGooseRunnerBuildTarget(platform, architecture);
  return target?.platform === "darwin" ||
    target?.platform === "linux" ||
    target?.platform === "win32"
    ? target
    : undefined;
}

export function resolveGooseRunnerExecutableAuthority(
  platform: string,
): GooseExecutableAuthority | undefined {
  if (platform === "darwin") return "attempt-private";
  if (platform === "linux") return "linux-package";
  if (platform === "win32") return "windows-supervisor";
  return undefined;
}

export function isGooseRunnerExecutableAuthorityAdmitted(
  platform: string,
  architecture: string,
  authority: GooseExecutableAuthority | undefined,
): boolean {
  const target = resolveGooseRunnerRuntimeTarget(platform, architecture);
  return (
    target !== undefined && resolveGooseRunnerExecutableAuthority(target.platform) === authority
  );
}
