import { spawn } from "node:child_process";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2_000;
const RETRYABLE_FETCH_FAILURE =
  /couldn't fetch advisory database:[\s\S]*(?:An IO error occurred when talking to the server|error sending request for url)/iu;

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Whether cargo-audit failed while transporting the RustSec advisory database. */
export function isRetryableCargoAuditFetchFailure(result) {
  return (
    result?.code === 2 &&
    result?.signal === null &&
    typeof result?.stdout === "string" &&
    result.stdout.trim() === "" &&
    typeof result?.stderr === "string" &&
    RETRYABLE_FETCH_FAILURE.test(result.stderr)
  );
}

/**
 * Run the lockfile scan with a bounded retry only for an advisory-database
 * transport failure. Vulnerability findings and all other failures return
 * immediately so the caller remains fail-closed.
 */
export async function runCargoAuditLockScan(command, args, options = {}) {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const retryDelayMs = Math.max(0, Math.floor(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  const env = options.env ?? process.env;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await runProcess(command, args, { cwd: options.cwd, env });
    if (attempt >= maxAttempts || !isRetryableCargoAuditFetchFailure(result)) {
      return result;
    }
    options.onRetry?.(attempt, result);
    if (retryDelayMs > 0) await wait(retryDelayMs);
  }
  throw new Error("cargo-audit lock scan retry loop exhausted");
}
