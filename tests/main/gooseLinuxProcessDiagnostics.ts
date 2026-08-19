import { readFile } from "node:fs/promises";
import path from "node:path";

export type LinuxProcessGroupReadFailure = "missing" | "inaccessible" | "malformed" | "unavailable";

export type LinuxProcessGroupReadResult =
  | Readonly<{ kind: "ok"; processGroupId: number }>
  | Readonly<{ kind: "failure"; reason: LinuxProcessGroupReadFailure }>;

/**
 * Reads the Linux process-group field from one bounded /proc/<pid>/stat record.
 * The command name is enclosed in parentheses and may itself contain a
 * parenthesis, so the final closing parenthesis is the only safe delimiter.
 */
export function linuxProcessGroupIdFromStat(value: string): number | undefined {
  const commandEnd = value.lastIndexOf(")");
  if (commandEnd < 1 || value[commandEnd + 1] !== " ") return undefined;
  const fields = value
    .slice(commandEnd + 2)
    .trim()
    .split(/\s+/u);
  const processGroup = fields[2];
  if (processGroup === undefined || !/^[1-9][0-9]*$/u.test(processGroup)) return undefined;
  const parsed = Number(processGroup);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function readLinuxProcessGroupIdResultFromStat(value: string): LinuxProcessGroupReadResult {
  const processGroupId = linuxProcessGroupIdFromStat(value);
  return processGroupId === undefined
    ? Object.freeze({ kind: "failure" as const, reason: "malformed" as const })
    : Object.freeze({ kind: "ok" as const, processGroupId });
}

export function classifyLinuxProcessGroupReadError(
  error: unknown,
): Exclude<LinuxProcessGroupReadFailure, "malformed"> | "unavailable" {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
  if (code === "ENOENT") return "missing";
  if (code === "EACCES" || code === "EPERM") return "inaccessible";
  return "unavailable";
}

export async function readLinuxProcessGroupIdResult(
  processId: number,
): Promise<LinuxProcessGroupReadResult> {
  try {
    const stat = await readFile(path.join("/proc", String(processId), "stat"), "utf8");
    return readLinuxProcessGroupIdResultFromStat(stat);
  } catch (error) {
    return Object.freeze({
      kind: "failure" as const,
      reason: classifyLinuxProcessGroupReadError(error),
    });
  }
}

export async function readLinuxProcessGroupId(processId: number): Promise<number> {
  const result = await readLinuxProcessGroupIdResult(processId);
  if (result.kind === "ok") return result.processGroupId;
  throw new Error("native integration process group was unavailable");
}
