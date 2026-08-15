import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { resolve, relative, isAbsolute, sep } from "node:path";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { classifyBoundTestReport, extractBoundVariantIds } from "./p7-abuse-report.mjs";

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
const MAX_DIAGNOSTIC_VARIANTS = 8;
const MAX_CATALOG_VARIANTS = 512;

function failHarness(message) {
  console.error(`test-harness-invalid: ${message}`);
  process.exitCode = 1;
  return false;
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: "pipe",
    env: process.env,
  });
  return result.status ?? 1;
}

function formatKnownVariantIds(ids) {
  const uniqueIds = [...new Set(ids)];
  const shown = uniqueIds.slice(0, MAX_DIAGNOSTIC_VARIANTS);
  const count = Math.min(uniqueIds.length, MAX_CATALOG_VARIANTS);
  return `${shown.join(",")} (count=${count})`;
}

function catalogVariants(catalog) {
  return catalog.flatMap((abuseCase) =>
    abuseCase.variants.map((variant) => ({ caseId: abuseCase.id, ...variant })),
  );
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
  if (expected.size !== files.length) {
    return failHarness("aggregate test file set contains duplicates");
  }
  const variantIds = new Set();
  const exactBindings = new Set();
  for (const abuseCase of catalog) {
    if (
      typeof abuseCase.id !== "string" ||
      !/^P7-A-[A-Z]+-\d{3}$/u.test(abuseCase.id) ||
      !Array.isArray(abuseCase.variants) ||
      abuseCase.variants.length === 0
    ) {
      return failHarness("catalog entry has invalid binding metadata");
    }
    for (const variant of abuseCase.variants) {
      if (
        typeof variant?.id !== "string" ||
        !/^P7-V-[A-Z]+-\d{3}-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(variant.id) ||
        !variant.id.startsWith(`${abuseCase.id.replace("P7-A-", "P7-V-")}-`) ||
        typeof variant.testFile !== "string" ||
        !/^tests\/security\/[^/]+\.test\.(?:ts|mjs)$/u.test(variant.testFile) ||
        typeof variant.testName !== "string" ||
        variant.testName !== `${abuseCase.id} ${variant.id}`
      ) {
        return failHarness("catalog variant has invalid exact binding metadata");
      }
      if (variantIds.has(variant.id)) {
        return failHarness(`catalog variant ID is duplicated: ${variant.id}`);
      }
      variantIds.add(variant.id);
      const binding = `${variant.testFile}\0${variant.testName}`;
      if (exactBindings.has(binding)) {
        return failHarness(`catalog exact binding is duplicated: ${variant.id}`);
      }
      exactBindings.add(binding);
      if (!validateContainedSecurityPath(variant.testFile)) {
        return failHarness(`catalog variant path is not contained: ${variant.id}`);
      }
      if (!expected.has(variant.testFile)) {
        return failHarness(`catalog variant is outside the aggregate file set: ${variant.id}`);
      }
      if (!existsSync(resolve(ROOT, variant.testFile))) {
        return failHarness(`bound attack fixture is missing for ${variant.id}`);
      }
    }
  }
  if (variantIds.size === 0 || variantIds.size > MAX_CATALOG_VARIANTS) {
    return failHarness("catalog variant count is invalid");
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
    let report;
    try {
      report = JSON.parse(readFileSync(resultPath, "utf8"));
    } catch {
      const observedVariantIds = extractBoundVariantIds(catalog, result.stdout, result.stderr);
      failHarness(
        observedVariantIds.length > 0
          ? `bound test process failed for variants: ${formatKnownVariantIds(observedVariantIds)}`
          : "vitest result report is missing or invalid",
      );
      return 1;
    }
    let classification;
    try {
      classification = classifyBoundTestReport(catalog, report, ROOT);
    } catch {
      failHarness("vitest result report has invalid bounded shape");
      return 1;
    }
    if (classification.duplicateVariantIds.length > 0) {
      failHarness(
        `duplicate variant assertions: ${formatKnownVariantIds(classification.duplicateVariantIds)}`,
      );
      return 1;
    }
    if (classification.unknownVariantCount > 0) {
      failHarness(`unknown variant assertions (count=${classification.unknownVariantCount})`);
      return 1;
    }
    if (classification.unboundVariantIds.length > 0) {
      failHarness(
        `variants executed outside their exact binding: ${formatKnownVariantIds(
          classification.unboundVariantIds,
        )}`,
      );
      return 1;
    }
    if (classification.missingVariantIds.length > 0) {
      failHarness(
        `variants have no executed assertion: ${formatKnownVariantIds(
          classification.missingVariantIds,
        )}`,
      );
      return 1;
    }
    if (classification.nonPassingVariantIds.length > 0) {
      failHarness(
        `variants did not pass: ${formatKnownVariantIds(classification.nonPassingVariantIds)}`,
      );
      return 1;
    }
    if (result.status !== 0 || result.error) {
      failHarness("an unbound security assertion failed");
      return 1;
    }
    console.info(
      `P7 local abuse gate passed: ${catalog.length} cases and ${catalogVariants(catalog).length} exact variants denied-safe.`,
    );
    return 0;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

const catalogStatus = run("bunx", ["vitest", "run", CATALOG_TEST]);
if (catalogStatus !== 0) {
  failHarness("catalog contract did not pass");
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
