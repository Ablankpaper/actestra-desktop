import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  TeamPlannerSidecarProcess,
  type TeamPlannerSidecarProcessOptions,
} from "./teamPlannerSidecarProcess";
import { ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE } from "./actestraNativeTeamPlanner";
import type { TeamPlannerPort } from "./teamPlanAdmissionService";
import type {
  TeamPlannerAggregatePayload,
  TeamPlannerAggregateResult,
} from "../../shared/teamPlannerSidecarProtocol";
import type { TeamPlanCandidate, TeamPlannerRequest } from "../../core";

interface ActestraNativeTeamPlannerTestOptions {
  readonly executable: string;
  readonly entryPath: string;
  readonly entryArguments?: readonly string[];
  readonly workingDirectory: string;
  readonly startupTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
  readonly terminationGraceMs?: number;
}

export interface TrustedActestraNativeTeamPlannerManifest {
  readonly schemaVersion: 1;
  readonly engine: {
    readonly name: string;
    readonly version: string;
  };
  readonly entry: {
    readonly fileName: string;
    readonly sha256: string;
    readonly size: number;
  };
}

export const ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY_FILE_NAME = "actestra-team-planner.js" as const;
export const ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST_FILE_NAME =
  "actestra-team-planner.manifest.json" as const;

function isAsarPath(value: string): boolean {
  return value
    .split(path.sep)
    .some((segment) => segment === "app.asar" || segment.endsWith(".asar"));
}

export function resolveTrustedPlannerWorkingDirectory(
  entryDirectory: string,
  resourcesPath: string | undefined,
): string {
  if (!path.isAbsolute(entryDirectory)) {
    throw new TypeError("Actestra native Team planner entry directory must be absolute");
  }
  const resolvedEntryDirectory = path.resolve(entryDirectory);
  if (!isAsarPath(resolvedEntryDirectory)) return resolvedEntryDirectory;
  if (
    typeof resourcesPath !== "string" ||
    !path.isAbsolute(resourcesPath) ||
    isAsarPath(resourcesPath)
  ) {
    throw new TypeError("Actestra native Team planner requires a physical resources directory");
  }
  return path.resolve(resourcesPath);
}

export interface ActestraNativeTeamPlannerProcess extends TeamPlannerPort {
  aggregate(
    payload: TeamPlannerAggregatePayload,
    signal?: AbortSignal,
  ): Promise<TeamPlannerAggregateResult>;
  close(): Promise<void>;
}

function optionsFor(
  options: ActestraNativeTeamPlannerTestOptions,
): TeamPlannerSidecarProcessOptions {
  if (
    !path.isAbsolute(options.executable) ||
    !path.isAbsolute(options.entryPath) ||
    !path.isAbsolute(options.workingDirectory)
  ) {
    throw new TypeError("Actestra native Team planner paths must be absolute");
  }
  return {
    executable: options.executable,
    args: [options.entryPath, ...(options.entryArguments ?? [])],
    workingDirectory: options.workingDirectory,
    expectedEngine: ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE,
    startupTimeoutMs: options.startupTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    terminationGraceMs: options.terminationGraceMs,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  const expected = new Set(keys);
  return actual.length === expected.size && actual.every((key) => expected.has(key));
}

function trustedManifest(value: unknown): TrustedActestraNativeTeamPlannerManifest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "engine", "entry"]) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.engine) ||
    !hasExactKeys(value.engine, ["name", "version"]) ||
    value.engine.name !== ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE.name ||
    value.engine.version !== ACTESTRA_NATIVE_TEAM_PLANNER_ENGINE.version ||
    !isRecord(value.entry) ||
    !hasExactKeys(value.entry, ["fileName", "sha256", "size"]) ||
    value.entry.fileName !== ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY_FILE_NAME ||
    typeof value.entry.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.entry.sha256) ||
    typeof value.entry.size !== "number" ||
    !Number.isSafeInteger(value.entry.size) ||
    value.entry.size < 1
  ) {
    throw new TypeError("Actestra native Team planner manifest is not trusted");
  }
  return value as unknown as TrustedActestraNativeTeamPlannerManifest;
}

async function optionsFromTrustedManifest(): Promise<ActestraNativeTeamPlannerTestOptions> {
  const manifestPath = path.join(__dirname, ACTESTRA_NATIVE_TEAM_PLANNER_MANIFEST_FILE_NAME);
  let manifest: TrustedActestraNativeTeamPlannerManifest;
  try {
    manifest = trustedManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  } catch {
    throw new TypeError("Actestra native Team planner manifest is not trusted");
  }
  const entryPath = path.join(__dirname, ACTESTRA_NATIVE_TEAM_PLANNER_ENTRY_FILE_NAME);
  let source: Buffer;
  try {
    source = await readFile(entryPath);
  } catch {
    throw new TypeError("Actestra native Team planner entry is unavailable");
  }
  const actualDigest = createHash("sha256").update(source).digest("hex");
  if (source.byteLength !== manifest.entry.size || actualDigest !== manifest.entry.sha256) {
    throw new TypeError("Actestra native Team planner entry digest is not trusted");
  }
  const workingDirectory = resolveTrustedPlannerWorkingDirectory(__dirname, process.resourcesPath);
  try {
    if (!(await stat(workingDirectory)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new TypeError("Actestra native Team planner working directory is unavailable");
  }
  return {
    executable: process.execPath,
    entryPath,
    workingDirectory,
  };
}

class NativeTeamPlannerProcess implements ActestraNativeTeamPlannerProcess {
  constructor(private readonly process: TeamPlannerSidecarProcess) {}

  propose(request: TeamPlannerRequest, signal: AbortSignal): Promise<TeamPlanCandidate> {
    return this.process.propose(request, signal);
  }

  aggregate(
    payload: TeamPlannerAggregatePayload,
    signal?: AbortSignal,
  ): Promise<TeamPlannerAggregateResult> {
    return this.process.aggregate(payload, signal);
  }

  close(): Promise<void> {
    return this.process.close();
  }
}

async function startWithOptions(
  options: ActestraNativeTeamPlannerTestOptions,
): Promise<ActestraNativeTeamPlannerProcess> {
  const process = await TeamPlannerSidecarProcess.start({
    ...optionsFor(options),
  });
  return new NativeTeamPlannerProcess(process);
}

export async function startTrustedActestraNativeTeamPlanner(): Promise<ActestraNativeTeamPlannerProcess> {
  return startWithOptions(await optionsFromTrustedManifest());
}

/** Test-only process injection. Production composition must use the trusted factory above. */
export async function startActestraNativeTeamPlannerForTest(
  options: ActestraNativeTeamPlannerTestOptions,
): Promise<ActestraNativeTeamPlannerProcess> {
  return startWithOptions(options);
}
