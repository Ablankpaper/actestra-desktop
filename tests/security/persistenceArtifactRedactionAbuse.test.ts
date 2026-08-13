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
  it("P7-A-PERSISTENCE-001 rejects replay and stale records", async () => {
    const directory = createTestDirectory("actestra-p7-persistence-");
    const persistence = openSqliteCorePersistence(directory);
    await persistence.replaceDomainGraph(createDomainGraph());

    const started = createStartedEvent();
    await expect(persistence.appendEvent(started)).resolves.toEqual({ status: "appended" });
    await expect(persistence.appendEvent(started)).resolves.toEqual({ status: "duplicate" });
    await expect(
      persistence.appendEvent({
        ...started,
        occurredAt: instant("2026-07-28T06:00:09.000Z"),
      }),
    ).rejects.toMatchObject({ code: "event-id-conflict" });
    await expect(
      persistence.appendEvent(
        createEvent(
          1,
          "agent.message",
          {
            role: "assistant",
            content: "A reused sequence must not commit.",
          },
          { eventId: eventId("event-sequence-regression") },
        ),
      ),
    ).rejects.toMatchObject({ code: "event-sequence-conflict" });
    await expect(
      persistence.appendEvent(
        createEvent(3, "agent.message", {
          role: "assistant",
          content: "A sequence gap must not commit.",
        }),
      ),
    ).rejects.toMatchObject({ code: "event-sequence-gap" });
    await expect(
      persistence.appendEvent(
        createEvent(
          2,
          "agent.message",
          { role: "assistant", content: "A cross-owner event must not commit." },
          { sessionId: sessionId("session-cross-owner") },
        ),
      ),
    ).rejects.toMatchObject({ code: "domain-reference" });
    const second = createEvent(2, "agent.message", {
      role: "assistant",
      content: "Only the valid second event commits.",
    });
    await expect(persistence.appendEvent(second)).resolves.toEqual({ status: "appended" });
    await expect(persistence.replayEvents(FIXTURE_STREAM_ID)).resolves.toEqual([started, second]);

    const checkpoint = createGeneralWorkCheckpoint();
    await expect(persistence.persistGeneralWorkCheckpoint(checkpoint)).resolves.toMatchObject({
      status: "stored",
    });
    await expect(persistence.persistGeneralWorkCheckpoint(checkpoint)).resolves.toMatchObject({
      status: "duplicate",
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
    await expect(
      persistence.persistArtifactDelivery(
        createArtifactDeliveryRecord({
          taskId: taskId("task-cross-owner"),
          updatedAt: instant("2026-08-13T01:02:00.000Z"),
        }),
      ),
    ).rejects.toMatchObject({ code: "artifact-delivery-conflict" });
    await expect(persistence.getArtifactDelivery(FIXTURE_ARTIFACT_ID)).resolves.toEqual(pending);

    const terminalEvidence = createAttemptEvidence("worker-execution-failed");
    await expect(persistence.appendAgentAttemptEvidence(terminalEvidence)).resolves.toEqual({
      status: "appended",
    });
    await expect(persistence.appendAgentAttemptEvidence(terminalEvidence)).resolves.toEqual({
      status: "duplicate",
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

  it("P7-A-PERSISTENCE-002 rejects malformed and tampered persistence", async () => {
    const contentDirectory = createTestDirectory("actestra-p7-content-tamper-");
    const persistence = openSqliteCorePersistence(contentDirectory);
    await persistence.replaceDomainGraph(createDomainGraph());
    const contentInput = {
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
    await persistence.storeContentReference(contentInput);
    await expect(
      persistence.storeContentReference({
        ...contentInput,
        unsupportedField: "must-fail-closed",
      } as never),
    ).rejects.toMatchObject({ code: "invalid-record" });
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

    const eventDirectory = createTestDirectory("actestra-p7-event-tamper-");
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

    const invalidDirectory = createTestDirectory("actestra-p7-invalid-database-");
    const invalidDatabasePath = resolveCoreDatabasePath(invalidDirectory);
    fs.mkdirSync(path.dirname(invalidDatabasePath), { recursive: true });
    fs.writeFileSync(invalidDatabasePath, "not a SQLite database");
    expect(() => openSqliteCorePersistence(invalidDirectory)).toThrowError(
      expect.objectContaining({ code: "corrupt-database" }),
    );
  });

  it("P7-A-REDACTION-001 removes protected values from evidence", async () => {
    const canaries = {
      credential: protectedCanary("credential"),
      path: protectedCanary("path"),
      prompt: protectedCanary("prompt"),
      completion: protectedCanary("completion"),
      toolArgument: protectedCanary("tool-argument"),
      contentReference: protectedCanary("content-reference"),
      patch: protectedCanary("patch"),
      environment: protectedCanary("environment"),
    } as const;
    const protectedText = Object.values(canaries).join("\n");
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
          sessionId: sessionId("session-p7-invalid-evidence"),
          streamId: eventStreamId("stream-p7-invalid-evidence"),
        }),
        detail: protectedText,
      } as never),
    ).rejects.toMatchObject({ code: "invalid-record" });
    await persistence.close();
  });

  it("P7-A-REDACTION-002 prevents false terminal success", async () => {
    const failureCodes = [
      "model-completion-refused",
      "model-request-rejected",
      "unsupported-tool",
      "worker-execution-failed",
      "persistence-unavailable",
    ] as const;

    for (const [index, failureCode] of failureCodes.entries()) {
      const directory = createTestDirectory(`actestra-p7-terminal-${String(index)}-`);
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
      await expect(
        persistence.appendEvent(
          createEvent(
            4,
            "task.completed",
            { from: "failed", to: "completed" },
            { eventId: eventId(`event-false-completed-${String(index)}`) },
          ),
        ),
      ).rejects.toMatchObject({ code: "event-after-terminal" });
      await persistence.appendAgentAttemptEvidence(
        createAttemptEvidence(failureCode, {
          sessionId: sessionId(`session-p7-failure-${String(index)}`),
          streamId: eventStreamId(`stream-p7-failure-${String(index)}`),
        }),
      );

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
      expect(await persistence.listRecentAgentAttemptEvidence(50)).toEqual([
        createAttemptEvidence(failureCode, {
          sessionId: sessionId(`session-p7-failure-${String(index)}`),
          streamId: eventStreamId(`stream-p7-failure-${String(index)}`),
        }),
      ]);
      expect((await persistence.loadDomainGraph())?.artifacts).toEqual([]);
      await persistence.close();
    }
  });

  it("P7-A-ARTIFACT-001 rejects untrusted artifact and package substitutions", async () => {
    const baseline = createRunnerArtifactFixture();
    await expect(
      admitGooseRunnerArtifact(baseline.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: baseline.manifestSha256,
      }),
    ).resolves.toMatchObject({ targetTriple: "aarch64-apple-darwin" });

    await expect(
      admitGooseRunnerArtifact(baseline.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "digest-mismatch" });
    await expect(
      admitGooseRunnerArtifact(baseline.directory, {
        expectedTargetTriple: "x86_64-apple-darwin",
        trustedManifestSha256: baseline.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "incompatible-artifact" });

    const symlinkFixture = createRunnerArtifactFixture();
    const linkedDirectory = path.join(
      createTestDirectory("actestra-p7-runner-link-"),
      "artifact-link",
    );
    fs.symlinkSync(symlinkFixture.directory, linkedDirectory, "dir");
    await expect(
      admitGooseRunnerArtifact(linkedDirectory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: symlinkFixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "invalid-manifest" });

    const unexpectedFixture = createRunnerArtifactFixture();
    fs.writeFileSync(path.join(unexpectedFixture.directory, "untrusted-sidecar"), "unexpected");
    await expect(
      admitGooseRunnerArtifact(unexpectedFixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: unexpectedFixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "invalid-manifest" });

    const executableFixture = createRunnerArtifactFixture();
    fs.writeFileSync(path.join(executableFixture.directory, "actestra-goose-runner"), "tampered");
    await expect(
      admitGooseRunnerArtifact(executableFixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: executableFixture.manifestSha256,
      }),
    ).rejects.toMatchObject({ code: "digest-mismatch" });

    const featureFixture = createRunnerArtifactFixture();
    const widenedManifest = {
      ...featureFixture.manifest,
      goose: { ...featureFixture.manifest.goose, cargoFeatures: ["telemetry"] },
    } as unknown as RunnerManifest;
    await expect(
      admitGooseRunnerArtifact(featureFixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: writeRunnerManifest(featureFixture.directory, widenedManifest),
      }),
    ).rejects.toMatchObject({ code: "incompatible-artifact" });

    const dependencyFixture = createRunnerArtifactFixture();
    const lockPath = path.join(dependencyFixture.directory, "Cargo.lock");
    const unsafeLock = fs
      .readFileSync(lockPath, "utf8")
      .replace('name = "lru"\nversion = "0.18.2"', 'name = "lru"\nversion = "0.18.1"');
    fs.writeFileSync(lockPath, unsafeLock);
    const unsafeDependencyManifest = {
      ...dependencyFixture.manifest,
      build: {
        ...dependencyFixture.manifest.build,
        lockfile: { file: "Cargo.lock", sha256: sha256(unsafeLock) },
      },
    } as RunnerManifest;
    await expect(
      admitGooseRunnerArtifact(dependencyFixture.directory, {
        expectedTargetTriple: "aarch64-apple-darwin",
        trustedManifestSha256: writeRunnerManifest(
          dependencyFixture.directory,
          unsafeDependencyManifest,
        ),
      }),
    ).rejects.toMatchObject({ code: "incompatible-artifact" });

    for (const [file, expectedCode] of [
      ["GOOSE-APACHE-2.0.txt", "digest-mismatch"],
      ["actestra-goose-runner.cdx.json", "digest-mismatch"],
      ["actestra-goose-runner.audit.json", "digest-mismatch"],
    ] as const) {
      const materialFixture = createRunnerArtifactFixture();
      fs.appendFileSync(path.join(materialFixture.directory, file), "tampered");
      await expect(
        admitGooseRunnerArtifact(materialFixture.directory, {
          expectedTargetTriple: "aarch64-apple-darwin",
          trustedManifestSha256: materialFixture.manifestSha256,
        }),
      ).rejects.toMatchObject({ code: expectedCode });
    }

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
