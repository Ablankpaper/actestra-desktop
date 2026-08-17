import { readFile } from "node:fs/promises";
import path from "node:path";

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

export async function readLinuxProcessGroupId(processId: number): Promise<number> {
  try {
    const stat = await readFile(path.join("/proc", String(processId), "stat"), "utf8");
    const processGroup = linuxProcessGroupIdFromStat(stat);
    if (processGroup !== undefined) return processGroup;
  } catch {
    // Deliberately collapse path and OS details at this diagnostic boundary.
  }
  throw new Error("native integration process group was unavailable");
}
