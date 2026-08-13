import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const CATALOG_MODULE = "./tests/security/abuseCaseCatalog.ts";
const CATALOG_TEST = "tests/security/abuseCaseCatalog.test.ts";
const SECURITY_ROOT = resolve(ROOT, "tests/security");
const DEFAULT_FILES = [
  "tests/security/rendererIpcCredentialAbuse.test.ts",
  "tests/security/workspaceToolApprovalAbuse.test.ts",
  "tests/security/mcpWorkerProcessAbuse.test.ts",
  "tests/security/persistenceArtifactRedactionAbuse.test.ts",
];

function failHarness(message) {
  console.error(`test-harness-invalid: ${message}`);
  process.exitCode = 1;
  return false;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
  }
  return result.status ?? 1;
}

function loadCatalog() {
  const script = `import { P7_ABUSE_CASES } from ${JSON.stringify(CATALOG_MODULE)}; process.stdout.write(JSON.stringify(P7_ABUSE_CASES));`;
  const result = spawnSync("bun", ["-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0 || result.error) {
    failHarness("catalog could not be loaded");
    return null;
  }
  try {
    const value = JSON.parse(result.stdout);
    if (!Array.isArray(value) || value.length !== 28) {
      failHarness("catalog does not contain exactly 28 cases");
      return null;
    }
    return value;
  } catch {
    failHarness("catalog output is not valid metadata JSON");
    return null;
  }
}

function validateContainedSecurityPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    return false;
  }
  if (isAbsolute(value)) {
    return false;
  }
  const candidate = resolve(ROOT, value);
  const rel = relative(SECURITY_ROOT, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function validateBindings(catalog, files) {
  const expected = new Set(files);
  for (const abuseCase of catalog) {
    if (
      typeof abuseCase.id !== "string" ||
      typeof abuseCase.testFile !== "string" ||
      typeof abuseCase.testName !== "string"
    ) {
      return failHarness("catalog entry has invalid binding metadata");
    }
    if (!validateContainedSecurityPath(abuseCase.testFile)) {
      return failHarness("catalog binding escapes tests/security");
    }
    if (!expected.has(abuseCase.testFile)) {
      return failHarness("catalog binding is not in the aggregate file set");
    }
    if (!existsSync(resolve(ROOT, abuseCase.testFile))) {
      return failHarness(`bound attack fixture is missing for ${abuseCase.id}`);
    }
    const source = readFileSync(resolve(ROOT, abuseCase.testFile), "utf8");
    if (!source.includes(abuseCase.testName)) {
      return failHarness(`bound test name is missing for ${abuseCase.id}`);
    }
  }
  return true;
}

function runBoundTests(catalog, files) {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "actestra-p7-results-"));
  const resultPath = path.join(temporaryRoot, "vitest.json");
  try {
    const result = spawnSync(
      "bunx",
      ["vitest", "run", ...files, "--reporter=json", `--outputFile=${resultPath}`],
      { cwd: ROOT, encoding: "utf8", env: process.env, stdio: "pipe" },
    );
    if (result.status !== 0 || result.error) {
      process.stdout.write(result.stdout ?? "");
      process.stderr.write(result.stderr ?? "");
      return result.status ?? 1;
    }
    const report = JSON.parse(readFileSync(resultPath, "utf8"));
    const assertions = report.testResults.flatMap((suite) => suite.assertionResults ?? []);
    const byTitle = new Map(assertions.map((assertion) => [assertion.title, assertion]));
    const missing = catalog.filter((abuseCase) => !byTitle.has(abuseCase.testName));
    const failed = catalog.filter(
      (abuseCase) => byTitle.get(abuseCase.testName)?.status !== "passed",
    );
    if (missing.length > 0) {
      failHarness(
        `catalog cases have no executed assertion: ${missing.map((entry) => entry.id).join(",")}`,
      );
      return 1;
    }
    if (failed.length > 0) {
      failHarness(`catalog cases did not pass: ${failed.map((entry) => entry.id).join(",")}`);
      return 1;
    }
    console.info(`P7 local abuse gate passed: ${catalog.length} denied-safe bound cases.`);
    return 0;
  } catch {
    failHarness("vitest result report is missing or invalid");
    return 1;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const catalogStatus = run("bunx", ["vitest", "run", CATALOG_TEST]);
if (catalogStatus !== 0) {
  process.exitCode = catalogStatus;
} else {
  const catalog = loadCatalog();
  if (catalog !== null) {
    const override = process.env.P7_SECURITY_TEST_FILES;
    const files =
      override === undefined
        ? DEFAULT_FILES
        : override
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean);
    if (override !== undefined && files.length === 0) {
      failHarness("P7_SECURITY_TEST_FILES is empty");
    } else if (files.some((file) => !validateContainedSecurityPath(file))) {
      failHarness("P7_SECURITY_TEST_FILES contains an absolute, traversing, NUL, or external path");
    } else if (!validateBindings(catalog, files)) {
      // validateBindings reports a bounded harness classification.
    } else {
      process.exitCode = runBoundTests(catalog, files);
    }
  }
}
