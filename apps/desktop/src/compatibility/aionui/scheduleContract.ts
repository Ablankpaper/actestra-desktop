/**
 * Node-free schedule identity and bounded-list constants shared by the
 * renderer bridge and the Actestra-owned scheduler.
 *
 * The bridge is imported by Electron's sandboxed preload. Keep this module
 * limited to data and pure predicates so the preload never inherits the
 * scheduler's Node-only hashing or Cron implementation.
 */

export const AIONUI_SCHEDULE_MAX_JOBS = 100 as const;
export const ACTESTRA_GENERAL_WORKER_AGENT_TYPE = "actestra-general-worker" as const;

const AIONUI_SCHEDULE_JOB_ID_RE = /^schedule-aionui-[a-f0-9]{64}$/u;

export function isAionUiScheduleJobId(value: unknown): value is string {
  return typeof value === "string" && AIONUI_SCHEDULE_JOB_ID_RE.test(value);
}
