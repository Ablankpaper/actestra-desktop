// @vitest-environment node

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLATFORM_EVIDENCE_CONTRACT_VERSION,
  correlationId,
  eventId,
  eventStreamId,
  instant,
  sessionId,
  taskId,
  toDiagnosticEvent,
  toolOutputReference,
  workerId,
  type AgentAttemptEvidence,
} from "../../apps/desktop/src/core";
import { ActestraGeneralWorkModelError } from "../../apps/desktop/src/main/workers/actestraGeneralWorkRuntime";
import {
  GOOSE_RUNNER_MANIFEST_FILE,
  admitGooseRunnerArtifact,
} from "../../apps/desktop/src/main/workers/gooseRunnerArtifact";
import sourceContract from "../../apps/desktop/src/shared/gooseRunnerSource.json";
import {
  openSqliteCorePersistence,
  resolveCoreDatabasePath,
} from "../../apps/desktop/src/utility/persistence/sqliteCorePersistence";
import {
  PersistenceUtilityProtocolError,
  assertPersistenceUtilityMessage,
} from "../../apps/desktop/src/shared/persistenceUtilityProtocol";
import {
  FIXTURE_ARTIFACT_ID,
  FIXTURE_SESSION_ID,
  FIXTURE_STREAM_ID,
  FIXTURE_TASK_ID,
  FIXTURE_WORKER_ID,
  FIXTURE_WORKSPACE_ID,
  createArtifactDeliveryRecord,
  createDomainGraph,
  createEvent,
  createStartedEvent,
} from "../fixtures/core";
import { createGeneralWorkCheckpoint } from "../fixtures/generalWorkRecovery";

const fixtureDirectories: string[] = [];

function createTestDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fixtureDirectories.push(directory);
  return directory;
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function protectedCanary(category: string): string {
  return `${category}-${randomBytes(24).toString("base64url")}`;
}

function assertCanariesAbsent(
  serialized: string,
  canaries: Readonly<Record<string, string>>,
): void {
  for (const [category, canary] of Object.entries(canaries)) {
    if (serialized.includes(canary)) {
      // Deliberately omit both the serialized value and the canary from failure output.
      throw new Error(`Protected ${category} canary entered metadata-only evidence`);
    }
  }
}

function createAttemptEvidence(
  incidentCode: string,
  overrides: Partial<AgentAttemptEvidence> = {},
): AgentAttemptEvidence {
  return {
    contractVersion: PLATFORM_EVIDENCE_CONTRACT_VERSION,
    redaction: "metadata",
    workspaceId: FIXTURE_WORKSPACE_ID,
    taskId: FIXTURE_TASK_ID,
    correlationId: correlationId("correlation-p7-refusal"),
    sessionId: FIXTURE_SESSION_ID,
    workerId: FIXTURE_WORKER_ID,
    streamId: FIXTURE_STREAM_ID,
    state: "protocol-failed",
    taskState: "failed",
    startedAt: instant("2026-08-13T01:00:00.000Z"),
    lastSignalAt: instant("2026-08-13T01:00:01.000Z"),
    lastControlSequence: 3,
    lastCoreEventSequence: 3,
    restartCount: 0,
    disposed: true,
    forcedCancellation: false,
    incident: {
      code: incidentCode,
      occurredAt: instant("2026-08-13T01:00:02.000Z"),
    },
    ...overrides,
  };
}

function createContentInput() {
  return {
    contractVersion: 1,
    reference: toolOutputReference("output-p7-integrity"),
    kind: "tool-output",
    owner: {
      workspaceId: FIXTURE_WORKSPACE_ID,
      taskId: FIXTURE_TASK_ID,
      sessionId: FIXTURE_SESSION_ID,
      workerId: FIXTURE_WORKER_ID,
    },
    classification: "task-content",
    mediaType: "text/markdown; charset=utf-8",
    content: "# Integrity-bound task output",
    createdAt: instant("2026-08-13T01:10:00.000Z"),
  } as const;
}

const REDACTION_CANARY_CASES = [
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-CREDENTIAL", "credential"],
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-PATH", "path"],
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-PROMPT", "prompt"],
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-COMPLETION", "completion"],
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-TOOL-ARGUMENT", "tool-argument"],
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-CONTENT-REFERENCE", "content-reference"],
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-PATCH", "patch"],
  ["P7-A-REDACTION-001 P7-V-REDACTION-001-ENVIRONMENT-TEXT", "environment-text"],
] as const;

const REDACTION_TERMINAL_CASES = [
  [
    "P7-A-REDACTION-002 P7-V-REDACTION-002-REJECTED-MODEL-FALSE-COMPLETED",
    "model-completion-refused",
    "completed",
  ],
  [
    "P7-A-REDACTION-002 P7-V-REDACTION-002-REJECTED-MODEL-FALSE-UNCHANGED",
    "model-completion-refused",
    "unchanged",
  ],
  [
    "P7-A-REDACTION-002 P7-V-REDACTION-002-REJECTED-TOOL-FALSE-COMPLETED",
    "unsupported-tool",
    "completed",
  ],
  [
    "P7-A-REDACTION-002 P7-V-REDACTION-002-REJECTED-TOOL-FALSE-UNCHANGED",
    "unsupported-tool",
    "unchanged",
  ],
  [
    "P7-A-REDACTION-002 P7-V-REDACTION-002-REJECTED-WORKER-FALSE-COMPLETED",
    "worker-execution-failed",
    "completed",
  ],
  [
    "P7-A-REDACTION-002 P7-V-REDACTION-002-REJECTED-WORKER-FALSE-UNCHANGED",
    "worker-execution-failed",
    "unchanged",
  ],
] as const;

function buildToolEvidence(
  name: "cargo-auditable" | "cargo-audit",
  pin: Readonly<{ version: string; commit: string }>,
  executableDigestCharacter: string,
) {
  const asset = sourceContract.buildToolAssets["darwin-arm64"].find(
    (candidate) => candidate.name === name,
  );
  if (asset === undefined) {
    throw new Error(`Missing ${name} security fixture asset`);
  }
  return {
    ...pin,
    archiveSha256: asset.sha256,
    executableSha256: executableDigestCharacter.repeat(64),
  };
}

type RunnerManifest = Readonly<{
  contractVersion: number;
  runner: Readonly<{
    name: string;
    version: string;
    targetTriple: string;
    executable: Readonly<{ file: string; sha256: string; size: number }>;
  }>;
  goose: typeof sourceContract.goose;
  acp: typeof sourceContract.acp;
  build: Readonly<Record<string, unknown>>;
  materials: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  provenance: Readonly<Record<string, unknown>>;
}>;

function writeRunnerManifest(directory: string, manifest: RunnerManifest): string {
  const encoded = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(directory, GOOSE_RUNNER_MANIFEST_FILE), encoded);
  return sha256(encoded);
}

function createRunnerArtifactFixture(): {
  readonly directory: string;
  readonly manifest: RunnerManifest;
  readonly manifestSha256: string;
} {
  const directory = createTestDirectory("actestra-p7-runner-artifact-");
  const executable = Buffer.from("fixture-goose-runner", "utf8");
  const lockfile = [
    "version = 4",
    'name = "goose"',
    'version = "1.45.0"',
    `source = "git+https://github.com/aaif-goose/goose?rev=${sourceContract.goose.commit}#${sourceContract.goose.commit}"`,
    'name = "event-listener"',
    'version = "5.4.2"',
    'name = "lru"',
    'version = "0.18.2"',
    "",
  ].join("\n");
  const license = fs.readFileSync(
    path.resolve("workers/goose-runner/licenses/GOOSE-APACHE-2.0.txt"),
  );
  const sbom = JSON.stringify({
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000001",
    version: 1,
    metadata: {
      component: {
        type: "application",
        "bom-ref": `pkg:cargo/${sourceContract.runner.name}@${sourceContract.runner.version}`,
        name: sourceContract.runner.name,
        version: sourceContract.runner.version,
      },
    },
    components: [
      {
        type: "library",
        "bom-ref": `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
        name: "goose",
        version: sourceContract.goose.version,
        purl: `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
      },
    ],
    dependencies: [
      {
        ref: `pkg:cargo/${sourceContract.runner.name}@${sourceContract.runner.version}`,
        dependsOn: [
          `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
        ],
      },
      {
        ref: `pkg:cargo/goose@${sourceContract.goose.version}?vcs_url=git%2Bhttps%3A%2F%2Fgithub.com%2Faaif-goose%2Fgoose%40${sourceContract.goose.commit}`,
        dependsOn: [],
      },
    ],
  });
  const audit = JSON.stringify({
    contractVersion: 1,
    cargoAudit: buildToolEvidence("cargo-audit", sourceContract.buildTools.cargoAudit, "a"),
    advisoryDatabase: {
      commit: "1".repeat(40),
      fetchedAt: "2026-08-13T00:59:00.000Z",
      checkedAt: "2026-08-13T01:00:00.000Z",
    },
    reachability: {
      targetTriple: "aarch64-apple-darwin",
      activeDependencyCount: 1,
      cargoTreeDependencyCount: 1,
      compilerArtifactPackageCount: 2,
      cargoTreeAllTargets: { rsa: "no-path", sqlxMysql: "no-path" },
      compilerArtifactsAbsent: ["rsa", "sqlx-mysql"],
    },
    binary: {
      auditableDependencyCount: 12,
      vulnerabilities: [
        {
          id: "RUSTSEC-2023-0071",
          package: { name: "rsa", version: "0.9.10" },
          disposition: "metadata-only-not-compiled",
          proof: "cargo-tree-all-targets-no-path",
          source: "cargo-audit-bin",
        },
      ],
      unsound: [],
    },
    lock: {
      dependencyCount: 20,
      vulnerabilities: [
        {
          id: "RUSTSEC-2023-0071",
          package: { name: "rsa", version: "0.9.10" },
          disposition: "metadata-only-not-compiled",
          proof: "cargo-tree-all-targets-no-path",
          source: "cargo-audit-lock",
        },
      ],
      unsound: [],
      unmaintained: [],
      yanked: { complete: true, packages: [] },
    },
  });

  fs.writeFileSync(path.join(directory, "actestra-goose-runner"), executable);
  fs.chmodSync(path.join(directory, "actestra-goose-runner"), 0o755);
  fs.writeFileSync(path.join(directory, "Cargo.lock"), lockfile);
  fs.writeFileSync(path.join(directory, "GOOSE-APACHE-2.0.txt"), license);
  fs.writeFileSync(path.join(directory, "actestra-goose-runner.cdx.json"), sbom);
  fs.writeFileSync(path.join(directory, "actestra-goose-runner.audit.json"), audit);

  const manifest: RunnerManifest = {
    contractVersion: 1,
    runner: {
      name: sourceContract.runner.name,
      version: sourceContract.runner.version,
      targetTriple: "aarch64-apple-darwin",
      executable: {
        file: "actestra-goose-runner",
        sha256: sha256(executable),
        size: executable.byteLength,
      },
    },
    goose: sourceContract.goose,
    acp: sourceContract.acp,
    build: {
      rustToolchain: sourceContract.rust,
      profile: "release",
      cargoAuditable: buildToolEvidence(
        "cargo-auditable",
        sourceContract.buildTools.cargoAuditable,
        "b",
      ),
      lockfile: { file: "Cargo.lock", sha256: sha256(lockfile) },
      sourceTreeSha256: "2".repeat(64),
    },
    materials: {
      license: {
        file: "GOOSE-APACHE-2.0.txt",
        spdx: sourceContract.license.spdx,
        sha256: sha256(license),
      },
      sbom: {
        file: "actestra-goose-runner.cdx.json",
        format: "CycloneDX",
        specVersion: "1.6",
        sha256: sha256(sbom),
      },
      audit: {
        file: "actestra-goose-runner.audit.json",
        sha256: sha256(audit),
      },
    },
    provenance: {
      actestraCommit: "3".repeat(40),
      dirty: false,
      builder: "local",
      builtAt: "2026-08-13T01:00:00.000Z",
      command: "cargo auditable build --locked --release --message-format=json-render-diagnostics",
    },
  };
  return {
    directory,
    manifest,
    manifestSha256: writeRunnerManifest(directory, manifest),
  };
}

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    if (!directory.startsWith(os.tmpdir())) {
      throw new Error("Refusing to remove a P7 fixture outside the system temporary directory");
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("P7 persistence, redaction, artifact, and package abuse baseline", () => {
  it("P7-A-PERSISTENCE-001 P7-V-PERSISTENCE-001-STALE-CAS", async () => {
    const directory = createTestDirectory("actestra-p7-stale-cas-");
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph(createDomainGraph());

    const checkpoint = createGeneralWorkCheckpoint();
    await expect(persistence.persistGeneralWorkCheckpoint(checkpoint)).resolves.toMatchObject({
      status: "stored",
    });
    await expect(
      persistence.persistGeneralWorkCheckpoint({
        ...checkpoint,
        revision: 3,
        updatedAt: instant("2026-08-13T01:01:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "general-work-conflict" });
    await expect(persistence.getGeneralWorkCheckpoint(FIXTURE_SESSION_ID)).resolves.toEqual(
      checkpoint,
    );
    await persistence.close();
  });

  it("P7-A-PERSISTENCE-001 P7-V-PERSISTENCE-001-CONFLICTING-DUPLICATE", async () => {
    const directory = createTestDirectory("actestra-p7-conflicting-duplicate-");
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph(createDomainGraph());
    const pending = createArtifactDeliveryRecord();
    await expect(persistence.persistArtifactDelivery(pending)).resolves.toMatchObject({
      status: "stored",
    });
    await expect(persistence.persistArtifactDelivery(pending)).resolves.toMatchObject({
      status: "duplicate",
    });
    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({
          patchSha256: "d".repeat(64),
          updatedAt: instant("2026-08-13T01:02:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });
    await expect(persistence.getArtifactDelivery(FIXTURE_ARTIFACT_ID)).resolves.toEqual(pending);
    await persistence.close();
  });

  it("P7-A-PERSISTENCE-001 P7-V-PERSISTENCE-001-CROSS-OWNER-RECORD", async () => {
    const directory = createTestDirectory("actestra-p7-cross-owner-");
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph(createDomainGraph());
    const pending = createArtifactDeliveryRecord();
    await expect(persistence.persistArtifactDelivery(pending)).resolves.toMatchObject({
      status: "stored",
    });
    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({
          taskId: taskId("task-cross-owner"),
          updatedAt: instant("2026-08-13T01:02:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });
    await expect(persistence.getArtifactDelivery(FIXTURE_ARTIFACT_ID)).resolves.toEqual(pending);
    await persistence.close();
  });

  it("P7-A-PERSISTENCE-001 P7-V-PERSISTENCE-001-CROSS-ATTEMPT-RECORD", async () => {
    const directory = createTestDirectory("actestra-p7-cross-attempt-");
    const persistence = openSqliteCorePersistence(directory);
    const terminalEvidence = createAttemptEvidence("worker-execution-failed");
    await expect(persistence.appendAgentAttemptEvidence(terminalEvidence)).resolves.toEqual({
      status: "appended",
    });
    await expect(
      persistence.appendAgentAttemptEvidence({
        ...terminalEvidence,
        workerId: workerId("worker-cross-attempt"),
      }),
    ).rejects.toMatchObject({ code: "evidence-conflict" });
    await expect(persistence.listRecentAgentAttemptEvidence(50)).resolves.toEqual([
      terminalEvidence,
    ]);
    await persistence.close();
  });

  it("P7-A-PERSISTENCE-001 P7-V-PERSISTENCE-001-SEQUENCE-REGRESSION", async () => {
    const directory = createTestDirectory("actestra-p7-sequence-regression-");
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph(createDomainGraph());
    const started = createStartedEvent();
    await persistence.appendEvent(started);
    await expect(
      persistence.appendEvent(
        createEvent(
          1,
          "agent.message",
          { role: "assistant", content: "A reused sequence must not commit." },
          { eventId: eventId("event-sequence-regression") },
        ),
      ),
    ).rejects.toMatchObject({ code: "event-sequence-conflict" });
    await expect(persistence.replayEvents(FIXTURE_STREAM_ID)).resolves.toEqual([started]);
    await persistence.close();
  });

  it("P7-A-PERSISTENCE-001 P7-V-PERSISTENCE-001-REPLAY", async () => {
    const directory = createTestDirectory("actestra-p7-replay-");
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph(createDomainGraph());
    const started = createStartedEvent();
    await expect(persistence.appendEvent(started)).resolves.toEqual({ status: "appended" });
    await expect(persistence.appendEvent(started)).resolves.toEqual({ status: "duplicate" });
    const second = createEvent(2, "agent.message", {
      role: "assistant",
      content: "Only the valid second event commits.",
    });
    await expect(persistence.appendEvent(second)).resolves.toEqual({ status: "appended" });
    await expect(persistence.replayEvents(FIXTURE_STREAM_ID)).resolves.toEqual([started, second]);
    await persistence.close();
  });

  it("P7-A-PERSISTENCE-002 P7-V-PERSISTENCE-002-UNKNOWN-KEYS", async () => {
    const directory = createTestDirectory("actestra-p7-unknown-keys-");
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph(createDomainGraph());
    const contentInput = createContentInput();
    await persistence.storeContentReference(contentInput);
    await expect(
      persistence.storeContentReference({
        ...contentInput,
        unsupportedField: "must-fail-closed",
      } as never),
    ).rejects.toMatchObject({ code: "invalid-record" });
    await expect(
      persistence.resolveContentReference({
        contractVersion: 1,
        reference: contentInput.reference,
        kind: contentInput.kind,
        owner: contentInput.owner,
        resolvedAt: instant("2026-08-13T01:11:00.000Z"),
        consume: false,
      }),
    ).resolves.toMatchObject({ content: contentInput.content });
    await persistence.close();
  });

  it("P7-A-PERSISTENCE-002 P7-V-PERSISTENCE-002-TRUNCATED-PROTOCOL", () => {
    expect(() =>
      assertPersistenceUtilityMessage({
        protocolVersion: 1,
        type: "response",
      }),
    ).toThrow(PersistenceUtilityProtocolError);
  });

  it("P7-A-PERSISTENCE-002 P7-V-PERSISTENCE-002-TRUNCATED-DATABASE", async () => {
    const eventDirectory = createTestDirectory("actestra-p7-truncated-database-");
    const eventPersistence = openSqliteCorePersistence(eventDirectory);
    await eventPersistence.replaceDomainGraph(createDomainGraph());
    await eventPersistence.appendEvent(createStartedEvent());
    await eventPersistence.close();
    const eventDatabase = new DatabaseSync(resolveCoreDatabasePath(eventDirectory));
    eventDatabase
      .prepare("UPDATE core_events SET envelope_json = ? WHERE event_id = ?")
      .run('{"schemaVersion":1', "event-1");
    eventDatabase.close();
    const tamperedEvent = openSqliteCorePersistence(eventDirectory);
    await expect(tamperedEvent.replayEvents(FIXTURE_STREAM_ID)).rejects.toMatchObject({
      code: "corrupt-database",
    });
    await tamperedEvent.close();
  });

  it("P7-A-PERSISTENCE-002 P7-V-PERSISTENCE-002-DIGEST-TAMPER", async () => {
    const contentDirectory = createTestDirectory("actestra-p7-content-tamper-");
    const persistence = openSqliteCorePersistence(contentDirectory);
    await persistence.replaceDomainGraph(createDomainGraph());
    const contentInput = createContentInput();
    await persistence.storeContentReference(contentInput);
    await persistence.close();
    const contentDatabase = new DatabaseSync(resolveCoreDatabasePath(contentDirectory));
    contentDatabase
      .prepare("UPDATE content_references SET content_blob = ? WHERE reference = ?")
      .run(
        Buffer.from("x".repeat(Buffer.byteLength(contentInput.content))),
        contentInput.reference,
      );
    contentDatabase.close();
    const tamperedContent = openSqliteCorePersistence(contentDirectory);
    await expect(
      tamperedContent.resolveContentReference({
        contractVersion: 1,
        reference: contentInput.reference,
        kind: contentInput.kind,
        owner: contentInput.owner,
        resolvedAt: instant("2026-08-13T01:11:00.000Z"),
        consume: false,
      }),
    ).rejects.toMatchObject({ code: "content-integrity" });
    await tamperedContent.close();
  });

  it("P7-A-PERSISTENCE-002 P7-V-PERSISTENCE-002-INVALID-SQLITE", () => {
    const invalidDirectory = createTestDirectory("actestra-p7-invalid-database-");
    const invalidDatabasePath = resolveCoreDatabasePath(invalidDirectory);
    fs.mkdirSync(path.dirname(invalidDatabasePath), { recursive: true });
    fs.writeFileSync(invalidDatabasePath, "not a SQLite database");
    expect(() => openSqliteCorePersistence(invalidDirectory)).toThrowError(
      expect.objectContaining({ code: "corrupt-database" }),
    );
  });

  it("P7-A-PERSISTENCE-002 P7-V-PERSISTENCE-002-CLOSED-PORT", async () => {
    const persistence = openSqliteCorePersistence(createTestDirectory("actestra-p7-closed-port-"));
    await persistence.close();
    await expect(persistence.loadDomainGraph()).rejects.toMatchObject({ code: "closed" });
    await expect(persistence.close()).resolves.toBeUndefined();
  });

  it.each(REDACTION_CANARY_CASES)("%s", async (_testName, category) => {
    const protectedText = protectedCanary(category);
    const canaries = { [category]: protectedText };
    const diagnostic = toDiagnosticEvent(
      createEvent(2, "agent.message", {
        role: "assistant",
        content: protectedText,
      }),
    );
    assertCanariesAbsent(JSON.stringify(diagnostic), canaries);
    expect(diagnostic.payload).toEqual({
      redacted: true,
      classification: "workspace-content",
    });

    const refusal = new ActestraGeneralWorkModelError("model-completion-refused", protectedText);
    const directory = createTestDirectory("actestra-p7-redaction-");
    const persistence = openSqliteCorePersistence(directory);
    const evidence = createAttemptEvidence(refusal.code);
    await expect(persistence.appendAgentAttemptEvidence(evidence)).resolves.toEqual({
      status: "appended",
    });
    const restored = await persistence.listRecentAgentAttemptEvidence(50);
    const serializedEvidence = JSON.stringify(restored);
    assertCanariesAbsent(serializedEvidence, canaries);
    expect(serializedEvidence).toContain("model-completion-refused");
    expect(serializedEvidence.length).toBeLessThan(2_048);

    await expect(
      persistence.appendAgentAttemptEvidence({
        ...createAttemptEvidence("model-request-rejected", {
          sessionId: sessionId(`session-p7-invalid-${category}`),
          streamId: eventStreamId(`stream-p7-invalid-${category}`),
        }),
        detail: protectedText,
      } as never),
    ).rejects.toMatchObject({ code: "invalid-record" });
    assertCanariesAbsent(
      JSON.stringify(await persistence.listRecentAgentAttemptEvidence(50)),
      canaries,
    );
    await persistence.close();
  });

  it.each(REDACTION_TERMINAL_CASES)("%s", async (_testName, failureCode, forbiddenProjection) => {
    const directory = createTestDirectory(
      `actestra-p7-terminal-${failureCode}-${forbiddenProjection}-`,
    );
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph({ ...createDomainGraph(), artifacts: [] });
    const started = createStartedEvent();
    const workerFailure = createEvent(2, "worker.failed", {
      errorCode: failureCode,
      message: "The bounded attempt failed.",
      retryable: false,
    });
    const taskFailure = createEvent(3, "task.failed", {
      from: "running",
      to: "failed",
      errorCode: failureCode,
      message: "The bounded task failed.",
    });
    await persistence.appendEvent(started);
    await persistence.appendEvent(workerFailure);
    await persistence.appendEvent(taskFailure);

    if (forbiddenProjection === "completed") {
      await expect(
        persistence.appendEvent(
          createEvent(
            4,
            "task.completed",
            { from: "failed", to: "completed" },
            { eventId: eventId(`event-false-completed-${failureCode}`) },
          ),
        ),
      ).rejects.toMatchObject({ code: "event-after-terminal" });
    }

    await persistence.appendAgentAttemptEvidence(createAttemptEvidence(failureCode));
    const replay = await persistence.replayEvents(FIXTURE_STREAM_ID);
    expect(replay.map((event) => event.type)).toEqual([
      "task.started",
      "worker.failed",
      "task.failed",
    ]);
    expect(replay.at(-1)).toMatchObject({
      type: "task.failed",
      payload: { to: "failed", errorCode: failureCode },
    });
    expect(replay.some(({ type }) => type === "task.completed")).toBe(false);
    expect(await persistence.listRecentAgentAttemptEvidence(50)).toEqual([
      createAttemptEvidence(failureCode),
    ]);
    expect((await persistence.loadDomainGraph())?.artifacts).toEqual([]);
    await persistence.close();
  });

  it("admits the exact trusted Goose artifact control", async () => {
    const baseline = createRunnerArtifactFixture();
    await expect(
      admitGooseRunnerArtifact(baseline.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: baseline.manifestSha256,
      }),
    ).resolves.toMatchObject({ targetTriple: "aarch64-apple-darwin" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-SELF-AUTHORIZING-MANIFEST", async () => {
    const fixture = createRunnerArtifactFixture();
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "digest-mismatch" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-WRONG-DIGEST", async () => {
    const fixture = createRunnerArtifactFixture();
    fs.writeFileSync(path.join(fixture.directory, "actestra-goose-runner"), "tampered");
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: fixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "digest-mismatch" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-WRONG-ARCHITECTURE", async () => {
    const fixture = createRunnerArtifactFixture();
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "x86_64-apple-darwin",
        trustedManifestSha256: fixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "incompatible-artifact" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-SYMLINK", async () => {
    const fixture = createRunnerArtifactFixture();
    const linkedDirectory = path.join(
      createTestDirectory("actestra-p7-runner-link-"),
      "artifact-link",
    );
    fs.symlinkSync(fixture.directory, linkedDirectory, "dir");
    await expect(
      admitGooseRunnerArtifact(linkedDirectory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: fixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "invalid-manifest" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-UNEXPECTED-FILE", async () => {
    const fixture = createRunnerArtifactFixture();
    fs.writeFileSync(path.join(fixture.directory, "untrusted-sidecar"), "unexpected");
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: fixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "invalid-manifest" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-FEATURE-WIDENING", async () => {
    const fixture = createRunnerArtifactFixture();
    const widenedManifest = {
      ...fixture.manifest,
      goose: { ...fixture.manifest.goose, cargoFeatures: ["telemetry"] },
    } as unknown as RunnerManifest;
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: writeRunnerManifest(fixture.directory, widenedManifest),
      }),
    ).rejects.toMatchObject({ code: "incompatible-artifact" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-UNSAFE-DEPENDENCY", async () => {
    const fixture = createRunnerArtifactFixture();
    const lockPath = path.join(fixture.directory, "Cargo.lock");
    const unsafeLock = fs
      .readFileSync(lockPath, "utf8")
      .replace('name = "lru"\nversion = "0.18.2"', 'name = "lru"\nversion = "0.18.1"');
    fs.writeFileSync(lockPath, unsafeLock);
    const unsafeDependencyManifest = {
      ...fixture.manifest,
      build: {
        ...fixture.manifest.build,
        lockfile: { file: "Cargo.lock", sha256: sha256(unsafeLock) },
      },
    } as RunnerManifest;
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: writeRunnerManifest(fixture.directory, unsafeDependencyManifest),
      }),
    ).rejects.toMatchObject({ code: "incompatible-artifact" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-MISSING-LICENSE", async () => {
    const fixture = createRunnerArtifactFixture();
    fs.rmSync(path.join(fixture.directory, "GOOSE-APACHE-2.0.txt"));
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: fixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "invalid-manifest" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-MISSING-SBOM", async () => {
    const fixture = createRunnerArtifactFixture();
    fs.rmSync(path.join(fixture.directory, "actestra-goose-runner.cdx.json"));
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: fixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "invalid-manifest" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-MISSING-AUDIT", async () => {
    const fixture = createRunnerArtifactFixture();
    fs.rmSync(path.join(fixture.directory, "actestra-goose-runner.audit.json"));
    await expect(
      admitGooseRunnerArtifact(fixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: fixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "invalid-manifest" });
  });

  it("P7-A-ARTIFACT-001 P7-V-ARTIFACT-001-PACKAGED-SOURCE-COPY-DRIFT", () => {
    const overlay = JSON.parse(
      fs.readFileSync("downstream/aionui-v2.1.41/overlay.json", "utf8"),
    ) as { sourceCopies: readonly { source: string; destination: string }[] };
    const sourceCopy = overlay.sourceCopies.find(
      ({ destination }) =>
        destination === "packages/desktop/src/actestra/main/workers/gooseRunnerArtifact.ts",
    );
    expect(sourceCopy).toBeDefined();
    const reviewedSource = fs.readFileSync(sourceCopy!.source);
    const tamperedCopy = Buffer.concat([reviewedSource, Buffer.from("\n// tampered\n")]);
    expect(sha256(tamperedCopy)).not.toBe(sha256(reviewedSource));
    const checkerSource = fs.readFileSync("scripts/check-aionui-downstream.mjs", "utf8");
    expect(checkerSource).toContain("Actestra source copy drifted from its reviewed source");
  });
});
