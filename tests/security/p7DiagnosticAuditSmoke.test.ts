// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveP7DiagnosticAuditSmokeIsolation,
  runP7PackagedDiagnosticAuditSmoke,
} from "../../apps/desktop/src/main/security/p7DiagnosticAuditSmoke";
import { openSqliteCorePersistence } from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";

const fixtureRoots: string[] = [];

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "actestra-p7-diagnostic-test-"));
  fixtureRoots.push(root);
  const fixture = {
    root,
    userData: path.join(root, "user-data"),
    home: path.join(root, "home"),
    temp: path.join(root, "temp"),
    report: path.join(root, "diagnostics.json"),
    evidence: path.join(root, "acceptance.json"),
  };
  for (const directory of [fixture.userData, fixture.home, fixture.temp]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return fixture;
}

function environment(fixture: ReturnType<typeof createFixture>) {
  return {
    ACTESTRA_E2E_TEST: "1",
    ACTESTRA_E2E_ISOLATION_ROOT: fixture.root,
    ACTESTRA_USER_DATA_DIR: fixture.userData,
    ACTESTRA_E2E_HOME_DIR: fixture.home,
    ACTESTRA_E2E_TEMP_DIR: fixture.temp,
    ACTESTRA_P7_DIAGNOSTIC_AUDIT_SMOKE: "1",
    ACTESTRA_P7_DIAGNOSTIC_AUDIT_REPORT: fixture.report,
    ACTESTRA_P7_DIAGNOSTIC_AUDIT_EVIDENCE: fixture.evidence,
  };
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("P7.4 packaged diagnostic and audit smoke", () => {
  it("admits only a contained E2E profile, report, and evidence destination", () => {
    const fixture = createFixture();
    expect(resolveP7DiagnosticAuditSmokeIsolation(environment(fixture))).toEqual(fixture);
    expect(
      resolveP7DiagnosticAuditSmokeIsolation({
        ...environment(fixture),
        ACTESTRA_P7_DIAGNOSTIC_AUDIT_REPORT: path.join(os.tmpdir(), "escaped-report.json"),
      }),
    ).toBeNull();
    expect(
      resolveP7DiagnosticAuditSmokeIsolation({
        ...environment(fixture),
        ACTESTRA_E2E_TEST: "0",
      }),
    ).toBeNull();
  });

  it("prunes an old terminal prefix, preserves unresolved evidence, and writes a private redacted report", async () => {
    const fixture = createFixture();
    const isolation = resolveP7DiagnosticAuditSmokeIsolation(environment(fixture));
    expect(isolation).not.toBeNull();
    const persistence = openSqliteCorePersistence(fixture.userData);
    try {
      await expect(
        runP7PackagedDiagnosticAuditSmoke({
          isolation: isolation!,
          persistence,
          app: {
            name: "Actestra",
            version: "0.1.0-alpha.0",
            platform: "darwin",
            arch: "arm64",
            environment: "packaged",
          },
        }),
      ).resolves.toEqual({
        databaseSchemaVersion: 23,
        reportSchemaVersion: 1,
        policyVersion: 1,
        prunedRecordCount: 2,
        retainedRecordCount: 2,
        unresolvedPreserved: true,
        chainVerified: true,
        reportPrivate: true,
        redacted: true,
      });

      const retention = await persistence.readPrivilegedAuditRetentionState();
      expect(retention).toMatchObject({
        prunedRecordCount: 2,
        retainedRecordCount: 2,
        firstRetainedSequence: 3,
        lastSequence: 4,
      });
      await expect(persistence.listRecentPrivilegedAudit(1_000)).resolves.toMatchObject([
        { sequence: 4, event: { type: "tool.completed" } },
        { sequence: 3, event: { type: "tool.started" } },
      ]);
    } finally {
      await persistence.close();
    }

    const reportBytes = fs.readFileSync(fixture.report, "utf8");
    const report = JSON.parse(reportBytes);
    expect(report).toMatchObject({
      schemaVersion: 1,
      redaction: "metadata-only",
      app: { name: "Actestra", environment: "packaged" },
      audit: {
        exportedRecordCount: 2,
        retention: {
          prunedRecordCount: 2,
          retainedRecordCount: 2,
          firstRetainedSequence: 3,
          lastSequence: 4,
        },
      },
      attempts: { exportedRecordCount: 1 },
    });
    expect(report.audit.events.map((event: { sequence: number }) => event.sequence)).toEqual([
      4, 3,
    ]);
    expect(
      report.audit.events.every((event: { requestAlias: string }) =>
        /^request-[0-9]{4}$/u.test(event.requestAlias),
      ),
    ).toBe(true);
    expect(report.attempts.records[0].attemptAlias).toMatch(/^attempt-[0-9]{4}$/u);
    for (const forbidden of [
      fixture.root,
      "request-p7-diagnostic-terminal",
      "request-p7-diagnostic-unresolved",
      "session-p7-diagnostic-attempt",
      "workspace-p7-diagnostic-private",
      "tool-output-p7-diagnostic-private",
    ]) {
      expect(reportBytes).not.toContain(forbidden);
    }
    expect(fs.statSync(fixture.report).mode & 0o077).toBe(0);
    expect(fs.statSync(fixture.evidence).mode & 0o077).toBe(0);
  });
});
