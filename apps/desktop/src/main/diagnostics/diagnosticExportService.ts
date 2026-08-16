import { createHash, randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  assertAionUiDiagnosticExportResult,
  type AionUiDiagnosticExportPort,
  type AionUiDiagnosticExportResult,
} from "../../compatibility/aionui";
import {
  DIAGNOSTIC_EXPORT_EXCLUSIONS,
  DIAGNOSTIC_EXPORT_MAX_ATTEMPTS,
  DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS,
  DIAGNOSTIC_EXPORT_MAX_BYTES,
  assertAgentAttemptEvidence,
  assertAuditRecord,
  assertDiagnosticExportReport,
  assertPrivilegedAuditRetentionState,
  type AgentAttemptEvidence,
  type AuditRecord,
  type DiagnosticAttemptRecord,
  type DiagnosticAuditEvent,
  type DiagnosticExportReport,
  type PlatformEvidencePersistencePort,
  type PrivilegedClock,
} from "../../core";

export type DiagnosticExportPersistencePort = Pick<
  PlatformEvidencePersistencePort,
  "maintainPrivilegedAudit" | "listRecentPrivilegedAudit" | "listRecentAgentAttemptEvidence"
>;

export interface DiagnosticExportSaveDialogPort {
  showSaveDialog(options: {
    readonly title: string;
    readonly defaultPath: string;
    readonly filters: readonly {
      readonly name: string;
      readonly extensions: readonly string[];
    }[];
  }): Promise<
    { readonly cancelled: true } | { readonly cancelled: false; readonly filePath: string }
  >;
}

export interface DiagnosticExportFileState {
  readonly mode: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export interface DiagnosticExportWritableFile {
  write(data: Uint8Array): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface DiagnosticExportFileSystemPort {
  lstat(filePath: string): Promise<DiagnosticExportFileState | null>;
  openExclusive(filePath: string, mode: number): Promise<DiagnosticExportWritableFile>;
  chmod(filePath: string, mode: number): Promise<void>;
  rename(sourcePath: string, destinationPath: string): Promise<void>;
  remove(filePath: string): Promise<void>;
}

export interface DiagnosticExportServiceConfig {
  readonly persistence: DiagnosticExportPersistencePort;
  readonly clock: PrivilegedClock;
  readonly app: DiagnosticExportReport["app"];
  readonly saveDialog: DiagnosticExportSaveDialogPort;
  readonly fileSystem?: DiagnosticExportFileSystemPort;
  readonly aliasSalt?: () => Uint8Array;
  readonly temporaryId?: () => string;
}

export class DiagnosticExportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DiagnosticExportError";
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

const nodeFileSystem: DiagnosticExportFileSystemPort = Object.freeze({
  lstat: async (filePath: string) => {
    try {
      return await fs.lstat(filePath);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  },
  openExclusive: async (filePath: string, mode: number) => {
    const handle = await fs.open(filePath, "wx", mode);
    return {
      write: async (data: Uint8Array) => {
        await handle.writeFile(data);
      },
      sync: async () => {
        await handle.sync();
      },
      close: async () => {
        await handle.close();
      },
    };
  },
  chmod: async (filePath: string, mode: number) => {
    await fs.chmod(filePath, mode);
  },
  rename: async (sourcePath: string, destinationPath: string) => {
    await fs.rename(sourcePath, destinationPath);
  },
  remove: async (filePath: string) => {
    await fs.rm(filePath, { force: true });
  },
});

function closedResult(
  status: AionUiDiagnosticExportResult["status"],
): AionUiDiagnosticExportResult {
  const result = Object.freeze({ status });
  assertAionUiDiagnosticExportResult(result);
  return result;
}

export function assertDiagnosticExportEncodedSize(byteLength: number): void {
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 0 ||
    byteLength > DIAGNOSTIC_EXPORT_MAX_BYTES
  ) {
    throw new DiagnosticExportError(
      `Diagnostic export encoded size must not exceed ${DIAGNOSTIC_EXPORT_MAX_BYTES} bytes`,
    );
  }
}

function assertTemporaryId(value: string): void {
  if (value.length === 0 || value.length > 128 || !/^[a-zA-Z0-9-]+$/u.test(value)) {
    throw new DiagnosticExportError("Diagnostic export temporary identifier is invalid");
  }
}

async function assertDestination(
  fileSystem: DiagnosticExportFileSystemPort,
  destination: string,
): Promise<void> {
  if (
    !path.isAbsolute(destination) ||
    destination.length === 0 ||
    destination.length > 4096 ||
    destination.includes("\0")
  ) {
    throw new DiagnosticExportError("Diagnostic export destination is invalid");
  }
  const parent = await fileSystem.lstat(path.dirname(destination));
  if (parent === null || !parent.isDirectory() || parent.isSymbolicLink()) {
    throw new DiagnosticExportError("Diagnostic export destination parent is invalid");
  }
  const destinationState = await fileSystem.lstat(destination);
  if (
    destinationState !== null &&
    (!destinationState.isFile() || destinationState.isSymbolicLink())
  ) {
    throw new DiagnosticExportError("Diagnostic export destination is not a regular file");
  }
}

async function writePrivateAtomic(
  fileSystem: DiagnosticExportFileSystemPort,
  destination: string,
  data: Uint8Array,
  temporaryId: string,
): Promise<void> {
  assertTemporaryId(temporaryId);
  await assertDestination(fileSystem, destination);
  const temporaryPath = path.join(
    path.dirname(destination),
    `.actestra-diagnostic-${temporaryId}.tmp`,
  );
  let temporaryCreated = false;
  let handle: DiagnosticExportWritableFile | null = null;
  try {
    handle = await fileSystem.openExclusive(temporaryPath, 0o600);
    temporaryCreated = true;
    await handle.write(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.chmod(temporaryPath, 0o600);
    await assertDestination(fileSystem, destination);
    await fileSystem.rename(temporaryPath, destination);
    temporaryCreated = false;
    const finalState = await fileSystem.lstat(destination);
    if (
      finalState === null ||
      !finalState.isFile() ||
      finalState.isSymbolicLink() ||
      (finalState.mode & 0o077) !== 0
    ) {
      throw new DiagnosticExportError("Diagnostic export output is not a private regular file");
    }
  } finally {
    if (handle !== null) {
      await handle.close().catch((): undefined => undefined);
    }
    if (temporaryCreated) {
      await fileSystem.remove(temporaryPath).catch((): undefined => undefined);
    }
  }
}

function outcomeCode(record: AuditRecord): string | null {
  switch (record.event.type) {
    case "policy.evaluated":
      return record.event.reasonCode;
    case "approval.resolved":
    case "approval.decision-recorded":
      return record.event.decision;
    case "tool.failed":
      return record.event.errorCode;
    default:
      return null;
  }
}

function mayHaveExecuted(record: AuditRecord): boolean | null {
  if (record.event.type === "tool.completed") return true;
  if (record.event.type === "tool.failed") return record.event.mayHaveExecuted;
  return null;
}

function createOpaqueAliases(
  rawIdentifiers: readonly string[],
  kind: "request" | "attempt",
  salt: Uint8Array,
): ReadonlyMap<string, string> {
  if (salt.byteLength < 16 || salt.byteLength > 64) {
    throw new DiagnosticExportError("Diagnostic export alias salt is invalid");
  }
  const unique = [...new Set(rawIdentifiers)];
  if (unique.length > 9_999) {
    throw new DiagnosticExportError("Diagnostic export alias count exceeds its bound");
  }
  unique.sort((left, right) => {
    const digest = (value: string) =>
      createHash("sha256")
        .update(kind, "utf8")
        .update("\0", "utf8")
        .update(salt)
        .update("\0", "utf8")
        .update(value, "utf8")
        .digest("hex");
    return digest(left).localeCompare(digest(right));
  });
  return new Map(
    unique.map((raw, index) => [raw, `${kind}-${String(index + 1).padStart(4, "0")}`]),
  );
}

function requiredAlias(aliases: ReadonlyMap<string, string>, raw: string): string {
  const alias = aliases.get(raw);
  if (alias === undefined) {
    throw new DiagnosticExportError("Diagnostic export alias mapping is incomplete");
  }
  return alias;
}

function diagnosticAuditEvents(
  records: readonly AuditRecord[],
  salt: Uint8Array,
): readonly DiagnosticAuditEvent[] {
  const aliases = createOpaqueAliases(
    records.map((record) => record.event.context.requestId),
    "request",
    salt,
  );
  return Object.freeze(
    records.map((record) => {
      assertAuditRecord(record);
      return Object.freeze({
        sequence: record.sequence,
        occurredAt: record.occurredAt,
        requestAlias: requiredAlias(aliases, record.event.context.requestId),
        type: record.event.type,
        action: record.event.context.action,
        resourceKind: record.event.context.resourceKind,
        outcomeCode: outcomeCode(record),
        mayHaveExecuted: mayHaveExecuted(record),
      });
    }),
  );
}

function diagnosticAttempts(
  evidence: readonly AgentAttemptEvidence[],
  salt: Uint8Array,
): readonly DiagnosticAttemptRecord[] {
  const aliases = createOpaqueAliases(
    evidence.map((attempt) => attempt.sessionId),
    "attempt",
    salt,
  );
  return Object.freeze(
    evidence.map((attempt) => {
      assertAgentAttemptEvidence(attempt);
      return Object.freeze({
        attemptAlias: requiredAlias(aliases, attempt.sessionId),
        state: attempt.state,
        taskState: attempt.taskState ?? null,
        startedAt: attempt.startedAt,
        lastSignalAt: attempt.lastSignalAt,
        restartCount: attempt.restartCount,
        forcedCancellation: attempt.forcedCancellation,
        incidentCode: attempt.incident?.code ?? null,
      });
    }),
  );
}

function defaultFilename(generatedAt: string): string {
  return `Actestra-diagnostics-${generatedAt.replaceAll(":", "-").replace(".000Z", "Z")}.json`;
}

export class DiagnosticExportService implements AionUiDiagnosticExportPort {
  private readonly fileSystem: DiagnosticExportFileSystemPort;
  private readonly aliasSalt: () => Uint8Array;
  private readonly temporaryId: () => string;

  constructor(private readonly config: DiagnosticExportServiceConfig) {
    this.fileSystem = config.fileSystem ?? nodeFileSystem;
    this.aliasSalt = config.aliasSalt ?? (() => randomBytes(32));
    this.temporaryId = config.temporaryId ?? randomUUID;
  }

  async exportReport(): Promise<AionUiDiagnosticExportResult> {
    try {
      const generatedAt = this.config.clock.now();
      const save = await this.config.saveDialog.showSaveDialog({
        title: "Export Actestra diagnostics",
        defaultPath: defaultFilename(generatedAt),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (save.cancelled === true) return closedResult("cancelled");
      if (save.cancelled !== false || !("filePath" in save)) {
        return closedResult("rejected");
      }
      const destination = save.filePath;
      await assertDestination(this.fileSystem, destination);

      const retention = await this.config.persistence.maintainPrivilegedAudit(generatedAt);
      assertPrivilegedAuditRetentionState(retention);
      const [auditRecords, attemptEvidence] = await Promise.all([
        this.config.persistence.listRecentPrivilegedAudit(DIAGNOSTIC_EXPORT_MAX_AUDIT_EVENTS),
        this.config.persistence.listRecentAgentAttemptEvidence(DIAGNOSTIC_EXPORT_MAX_ATTEMPTS),
      ]);
      const salt = this.aliasSalt();
      const events = diagnosticAuditEvents(auditRecords, salt);
      const attempts = diagnosticAttempts(attemptEvidence, salt);
      const report = Object.freeze({
        schemaVersion: 1,
        generatedAt,
        redaction: "metadata-only",
        app: Object.freeze({ ...this.config.app }),
        audit: Object.freeze({
          retention,
          exportedRecordCount: events.length,
          truncated: retention.retainedRecordCount > events.length,
          events,
        }),
        attempts: Object.freeze({
          exportedRecordCount: attempts.length,
          truncated: attempts.length === DIAGNOSTIC_EXPORT_MAX_ATTEMPTS,
          records: attempts,
        }),
        exclusions: DIAGNOSTIC_EXPORT_EXCLUSIONS,
      } satisfies DiagnosticExportReport);
      assertDiagnosticExportReport(report);
      const data = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8");
      assertDiagnosticExportEncodedSize(data.byteLength);
      await writePrivateAtomic(this.fileSystem, destination, data, this.temporaryId());
      return closedResult("saved");
    } catch {
      return closedResult("rejected");
    }
  }
}
