import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_REPORT_SUITES = 128;
const MAX_ASSERTIONS_PER_SUITE = 1_024;
const MAX_UNKNOWN_VARIANTS = 999;
const VARIANT_ID_PATTERN = /\bP7-V-[A-Z]+-\d{3}-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/gu;

function requireBoundedArray(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error("invalid-bound-test-report");
  }
  return value;
}

function catalogVariants(catalog) {
  return requireBoundedArray(catalog, 64).flatMap((abuseCase) =>
    requireBoundedArray(abuseCase?.variants, 64).map((variant) => ({
      caseId: abuseCase.id,
      ...variant,
    })),
  );
}

function normalizeReportTestFile(value, repositoryRoot) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) return null;
  let filePath = value;
  if (value.startsWith("file:")) {
    try {
      filePath = fileURLToPath(value);
    } catch {
      return null;
    }
  }
  const root = resolve(repositoryRoot);
  const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(root, filePath);
  const contained = relative(root, absolute);
  if (
    contained === "" ||
    contained === ".." ||
    contained.startsWith(`..${sep}`) ||
    isAbsolute(contained)
  ) {
    return null;
  }
  return contained.split(sep).join("/");
}

/**
 * Extract only globally declared variant IDs. Raw Vitest output can contain
 * credentials, paths, prompts, and tool arguments, so callers must never
 * forward any other matched text.
 */
export function extractBoundVariantIds(catalog, ...outputs) {
  const knownVariantIds = new Set(
    catalogVariants(Array.isArray(catalog) ? catalog : []).map((v) => v.id),
  );
  const ids = [];
  for (const output of outputs) {
    if (typeof output !== "string") continue;
    for (const match of output.matchAll(VARIANT_ID_PATTERN)) {
      const id = match[0];
      if (knownVariantIds.has(id) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export function classifyBoundTestReport(catalog, report, repositoryRoot = process.cwd()) {
  const variants = catalogVariants(catalog);
  const variantsById = new Map(variants.map((variant) => [variant.id, variant]));
  const observations = new Map(variants.map((variant) => [variant.id, []]));
  let unknownVariantCount = 0;

  const suites = requireBoundedArray(report?.testResults, MAX_REPORT_SUITES);
  for (const suite of suites) {
    const testFile = normalizeReportTestFile(suite?.name, repositoryRoot);
    const assertions = requireBoundedArray(suite?.assertionResults ?? [], MAX_ASSERTIONS_PER_SUITE);
    for (const assertion of assertions) {
      if (typeof assertion?.title !== "string") continue;
      const assertedVariantIds = [...new Set(assertion.title.match(VARIANT_ID_PATTERN) ?? [])];
      for (const variantId of assertedVariantIds) {
        const expected = variantsById.get(variantId);
        if (expected === undefined) {
          unknownVariantCount = Math.min(MAX_UNKNOWN_VARIANTS, unknownVariantCount + 1);
          continue;
        }
        observations.get(variantId).push({
          bound: assertion.title === expected.testName && testFile === expected.testFile,
          status: assertion.status,
        });
      }
    }
  }

  const missingVariantIds = [];
  const nonPassingVariantIds = [];
  const duplicateVariantIds = [];
  const unboundVariantIds = [];
  for (const variant of variants) {
    const variantObservations = observations.get(variant.id);
    const bound = variantObservations.filter((observation) => observation.bound);
    if (variantObservations.some((observation) => !observation.bound)) {
      unboundVariantIds.push(variant.id);
    }
    if (bound.length === 0) {
      if (variantObservations.length === 0) missingVariantIds.push(variant.id);
      continue;
    }
    if (bound.length > 1) duplicateVariantIds.push(variant.id);
    if (bound.some((observation) => observation.status !== "passed")) {
      nonPassingVariantIds.push(variant.id);
    }
  }

  return {
    missingVariantIds,
    nonPassingVariantIds,
    duplicateVariantIds,
    unboundVariantIds,
    unknownVariantCount,
  };
}
