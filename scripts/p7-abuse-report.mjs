function requireArray(value) {
  if (!Array.isArray(value)) {
    throw new Error("invalid-bound-test-report");
  }
  return value;
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
