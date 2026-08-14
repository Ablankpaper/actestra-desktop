function requireArray(value) {
  if (!Array.isArray(value)) {
    throw new Error("invalid-bound-test-report");
  }
  return value;
}

const ABUSE_CASE_ID_PATTERN = /\bP7-A-[A-Z0-9]+-\d{3}\b/gu;

/**
 * Extract only IDs already declared by the closed catalog. Never forward raw
 * Vitest output because it can contain credentials, paths, prompts, or tool
 * arguments. This is also useful when Vitest exits before its JSON reporter
 * writes a result file.
 */
export function extractBoundCaseIds(catalog, ...outputs) {
  const knownIds = new Set(
    (Array.isArray(catalog) ? catalog : [])
      .map((entry) => entry?.id)
      .filter((id) => typeof id === "string"),
  );
  const ids = [];
  for (const output of outputs) {
    if (typeof output !== "string") continue;
    for (const match of output.matchAll(ABUSE_CASE_ID_PATTERN)) {
      const id = match[0];
      if (knownIds.has(id) && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

export function classifyBoundTestReport(catalog, report) {
  const assertions = requireArray(report?.testResults).flatMap((suite) =>
    requireArray(suite?.assertionResults ?? []),
  );
  const byTitle = new Map(
    assertions
      .filter((assertion) => typeof assertion?.title === "string")
      .map((assertion) => [assertion.title, assertion.status]),
  );
  const missingCaseIds = [];
  const failedCaseIds = [];
  for (const abuseCase of catalog) {
    if (!byTitle.has(abuseCase.testName)) {
      missingCaseIds.push(abuseCase.id);
    } else if (byTitle.get(abuseCase.testName) !== "passed") {
      failedCaseIds.push(abuseCase.id);
    }
  }
  return { missingCaseIds, failedCaseIds };
}
