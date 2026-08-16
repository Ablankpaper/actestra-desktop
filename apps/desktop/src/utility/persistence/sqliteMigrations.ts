import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PersistenceError } from "../../core";

export const ACTESTRA_SQLITE_APPLICATION_ID = 1_095_980_114;
export const CURRENT_CORE_SCHEMA_VERSION = 23;

export interface SqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

export interface SqliteMigrationResult {
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly appliedVersions: readonly number[];
}

export const CORE_SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: "domain-graph",
    sql: `
      CREATE TABLE actestra_schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE workers (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        adapter_kind TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('created', 'starting', 'ready', 'busy', 'stopping', 'stopped', 'crashed')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('draft', 'ready', 'running', 'blocked', 'completed', 'failed', 'cancelled')
        ),
        active_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        worker_id TEXT NOT NULL REFERENCES workers(id) ON DELETE RESTRICT,
        state TEXT NOT NULL CHECK (
          state IN ('created', 'starting', 'running', 'blocked', 'completed', 'failed', 'cancelled')
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE approvals (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        action TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN ('pending', 'approved', 'denied', 'expired', 'cancelled')
        ),
        requested_at TEXT NOT NULL,
        expires_at TEXT,
        resolved_at TEXT
      ) STRICT;

      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        kind TEXT NOT NULL CHECK (kind IN ('file', 'document', 'dataset', 'directory', 'other')),
        label TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('available', 'superseded')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX sessions_task_id_idx ON sessions(task_id);
      CREATE INDEX approvals_task_id_idx ON approvals(task_id);
      CREATE INDEX artifacts_task_id_idx ON artifacts(task_id);
    `,
  },
  {
    version: 2,
    name: "ordered-core-events",
    sql: `
      CREATE TABLE core_events (
        event_id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        occurred_at TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        type TEXT NOT NULL,
        redaction TEXT NOT NULL CHECK (
          redaction IN ('metadata', 'workspace-content', 'sensitive-reference')
        ),
        envelope_json TEXT NOT NULL,
        UNIQUE (stream_id, sequence)
      ) STRICT;
    `,
  },
  {
    version: 3,
    name: "platform-evidence",
    sql: `
      CREATE TABLE privileged_audit_records (
        sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
        record_id TEXT NOT NULL UNIQUE,
        occurred_at TEXT NOT NULL,
        request_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        tool_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_kind TEXT NOT NULL,
        event_type TEXT NOT NULL,
        redaction TEXT NOT NULL CHECK (redaction = 'metadata'),
        record_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX privileged_audit_request_idx
        ON privileged_audit_records(request_id, sequence);

      CREATE TABLE agent_attempt_evidence (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL UNIQUE,
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (
          state IN (
            'completed',
            'failed',
            'cancelled',
            'crashed',
            'timed-out',
            'protocol-failed'
          )
        ),
        last_core_event_sequence INTEGER NOT NULL CHECK (last_core_event_sequence >= 0),
        incident_code TEXT,
        redaction TEXT NOT NULL CHECK (redaction = 'metadata'),
        evidence_json TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 4,
    name: "aionui-shadow-evidence",
    sql: `
      CREATE TABLE aionui_shadow_evidence (
        sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
        evidence_id TEXT NOT NULL UNIQUE,
        captured_at TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source = 'aionui-v2.1.41'),
        domain TEXT NOT NULL CHECK (
          domain IN (
            'conversation',
            'task',
            'provider',
            'workspace',
            'approval',
            'artifact',
            'runtime'
          )
        ),
        native_identity_hash TEXT NOT NULL,
        native_revision_hash TEXT NOT NULL,
        redaction TEXT NOT NULL CHECK (redaction = 'metadata-only'),
        evidence_json TEXT NOT NULL,
        UNIQUE (domain, native_identity_hash, native_revision_hash)
      ) STRICT;

      CREATE INDEX aionui_shadow_domain_sequence_idx
        ON aionui_shadow_evidence(domain, sequence);
    `,
  },
  {
    version: 5,
    name: "aionui-approval-authority",
    sql: `
      CREATE TABLE aionui_approval_decisions (
        decision_id TEXT PRIMARY KEY,
        native_conversation_id TEXT NOT NULL,
        native_call_id TEXT NOT NULL,
        native_message_id TEXT NOT NULL,
        native_path TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (
          decision IN ('approved', 'denied', 'cancelled', 'selected')
        ),
        always_allow INTEGER NOT NULL CHECK (always_allow IN (0, 1)),
        delivery_state TEXT NOT NULL CHECK (
          delivery_state IN ('pending-delivery', 'delivered')
        ),
        attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_attempt_at TEXT,
        delivered_at TEXT,
        last_error_code TEXT,
        delivery_body_json TEXT NOT NULL,
        record_json TEXT NOT NULL,
        UNIQUE (native_conversation_id, native_call_id)
      ) STRICT;

      CREATE INDEX aionui_approval_delivery_state_idx
        ON aionui_approval_decisions(delivery_state, created_at);
    `,
  },
  {
    version: 6,
    name: "workload-content-and-grants",
    sql: `
      CREATE TABLE workspace_grants (
        grant_id TEXT PRIMARY KEY,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        workspace_id TEXT NOT NULL,
        root_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
        grant_json TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX workspace_grants_active_workspace_idx
        ON workspace_grants(workspace_id)
        WHERE state = 'active';

      CREATE TABLE content_references (
        reference TEXT PRIMARY KEY,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        kind TEXT NOT NULL CHECK (kind IN ('tool-input', 'tool-output')),
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        request_id TEXT,
        grant_id TEXT,
        classification TEXT NOT NULL CHECK (
          classification IN ('workspace-content', 'task-content')
        ),
        media_type TEXT NOT NULL CHECK (
          media_type IN (
            'text/plain; charset=utf-8',
            'text/markdown; charset=utf-8'
          )
        ),
        byte_length INTEGER NOT NULL CHECK (
          byte_length >= 0 AND byte_length <= 1048576
        ),
        sha256 TEXT NOT NULL CHECK (
          length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        expires_at TEXT CHECK (expires_at IS NULL OR expires_at > created_at),
        consumed_at TEXT CHECK (
          consumed_at IS NULL OR (
            consumed_at >= created_at AND
            (expires_at IS NULL OR consumed_at < expires_at)
          )
        ),
        metadata_json TEXT NOT NULL,
        content_blob BLOB NOT NULL CHECK (length(content_blob) = byte_length)
      ) STRICT;

      CREATE INDEX content_references_owner_idx
        ON content_references(workspace_id, task_id, session_id, worker_id);
      CREATE INDEX content_references_request_idx
        ON content_references(request_id)
        WHERE request_id IS NOT NULL;
    `,
  },
  {
    version: 7,
    name: "general-work-recovery-checkpoints",
    sql: `
      CREATE TABLE general_work_checkpoints (
        session_id TEXT PRIMARY KEY,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        phase TEXT NOT NULL CHECK (
          phase IN ('active', 'terminal-pending', 'finalized')
        ),
        revision INTEGER NOT NULL CHECK (revision > 0),
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL CHECK (updated_at >= created_at),
        checkpoint_json TEXT NOT NULL
      ) STRICT;

      CREATE INDEX general_work_recoverable_idx
        ON general_work_checkpoints(phase, updated_at, session_id)
        WHERE phase != 'finalized';
    `,
  },
  {
    version: 8,
    name: "aionui-general-work-journeys",
    sql: `
      CREATE TABLE aionui_general_work_journeys (
        task_id TEXT PRIMARY KEY
          REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        conversation_hash TEXT NOT NULL CHECK (
          length(conversation_hash) = 64 AND
          conversation_hash NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX aionui_general_work_conversation_idx
        ON aionui_general_work_journeys(conversation_hash, created_at, task_id);
    `,
  },
  {
    version: 9,
    name: "aionui-general-work-kinds",
    sql: `
      ALTER TABLE aionui_general_work_journeys
        ADD COLUMN journey_kind TEXT NOT NULL
        DEFAULT 'prompt-artifact'
        CHECK (journey_kind IN ('prompt-artifact', 'workspace-file-artifact'));
    `,
  },
  {
    version: 10,
    name: "aionui-local-research-kind",
    sql: `
      CREATE TABLE aionui_general_work_journeys_v10 (
        task_id TEXT PRIMARY KEY
          REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        conversation_hash TEXT NOT NULL CHECK (
          length(conversation_hash) = 64 AND
          conversation_hash NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        journey_kind TEXT NOT NULL
          DEFAULT 'prompt-artifact'
          CHECK (
            journey_kind IN (
              'prompt-artifact',
              'workspace-file-artifact',
              'local-research-artifact'
            )
          )
      ) STRICT;

      INSERT INTO aionui_general_work_journeys_v10 (
        task_id,
        contract_version,
        conversation_hash,
        created_at,
        journey_kind
      )
      SELECT
        task_id,
        contract_version,
        conversation_hash,
        created_at,
        journey_kind
      FROM aionui_general_work_journeys;

      DROP TABLE aionui_general_work_journeys;
      ALTER TABLE aionui_general_work_journeys_v10
        RENAME TO aionui_general_work_journeys;

      CREATE INDEX aionui_general_work_conversation_idx
        ON aionui_general_work_journeys(conversation_hash, created_at, task_id);
    `,
  },
  {
    version: 11,
    name: "aionui-writing-kind",
    sql: `
      CREATE TABLE aionui_general_work_journeys_v11 (
        task_id TEXT PRIMARY KEY
          REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        conversation_hash TEXT NOT NULL CHECK (
          length(conversation_hash) = 64 AND
          conversation_hash NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        journey_kind TEXT NOT NULL
          DEFAULT 'prompt-artifact'
          CHECK (
            journey_kind IN (
              'prompt-artifact',
              'workspace-file-artifact',
              'local-research-artifact',
              'writing-artifact'
            )
          )
      ) STRICT;

      INSERT INTO aionui_general_work_journeys_v11 (
        task_id,
        contract_version,
        conversation_hash,
        created_at,
        journey_kind
      )
      SELECT
        task_id,
        contract_version,
        conversation_hash,
        created_at,
        journey_kind
      FROM aionui_general_work_journeys;

      DROP TABLE aionui_general_work_journeys;
      ALTER TABLE aionui_general_work_journeys_v11
        RENAME TO aionui_general_work_journeys;

      CREATE INDEX aionui_general_work_conversation_idx
        ON aionui_general_work_journeys(conversation_hash, created_at, task_id);
    `,
  },
  {
    version: 12,
    name: "aionui-office-document-kind",
    sql: `
      CREATE TABLE aionui_general_work_journeys_v12 (
        task_id TEXT PRIMARY KEY
          REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        conversation_hash TEXT NOT NULL CHECK (
          length(conversation_hash) = 64 AND
          conversation_hash NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        journey_kind TEXT NOT NULL
          DEFAULT 'prompt-artifact'
          CHECK (
            journey_kind IN (
              'prompt-artifact',
              'workspace-file-artifact',
              'local-research-artifact',
              'writing-artifact',
              'office-document-artifact'
            )
          )
      ) STRICT;

      INSERT INTO aionui_general_work_journeys_v12 (
        task_id,
        contract_version,
        conversation_hash,
        created_at,
        journey_kind
      )
      SELECT
        task_id,
        contract_version,
        conversation_hash,
        created_at,
        journey_kind
      FROM aionui_general_work_journeys;

      DROP TABLE aionui_general_work_journeys;
      ALTER TABLE aionui_general_work_journeys_v12
        RENAME TO aionui_general_work_journeys;

      CREATE INDEX aionui_general_work_conversation_idx
        ON aionui_general_work_journeys(conversation_hash, created_at, task_id);

      CREATE TABLE content_references_v12 (
        reference TEXT PRIMARY KEY,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        kind TEXT NOT NULL CHECK (kind IN ('tool-input', 'tool-output')),
        workspace_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        request_id TEXT,
        grant_id TEXT,
        classification TEXT NOT NULL CHECK (
          classification IN ('workspace-content', 'task-content')
        ),
        media_type TEXT NOT NULL CHECK (
          media_type IN (
            'text/plain; charset=utf-8',
            'text/markdown; charset=utf-8',
            'application/vnd.actestra.office-document-preview+json'
          )
        ),
        byte_length INTEGER NOT NULL CHECK (
          byte_length >= 0 AND byte_length <= 1048576
        ),
        sha256 TEXT NOT NULL CHECK (
          length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        created_at TEXT NOT NULL,
        expires_at TEXT CHECK (expires_at IS NULL OR expires_at > created_at),
        consumed_at TEXT CHECK (
          consumed_at IS NULL OR (
            consumed_at >= created_at AND
            (expires_at IS NULL OR consumed_at < expires_at)
          )
        ),
        metadata_json TEXT NOT NULL,
        content_blob BLOB NOT NULL CHECK (length(content_blob) = byte_length)
      ) STRICT;

      INSERT INTO content_references_v12 (
        reference,
        contract_version,
        kind,
        workspace_id,
        task_id,
        session_id,
        worker_id,
        request_id,
        grant_id,
        classification,
        media_type,
        byte_length,
        sha256,
        created_at,
        expires_at,
        consumed_at,
        metadata_json,
        content_blob
      )
      SELECT
        reference,
        contract_version,
        kind,
        workspace_id,
        task_id,
        session_id,
        worker_id,
        request_id,
        grant_id,
        classification,
        media_type,
        byte_length,
        sha256,
        created_at,
        expires_at,
        consumed_at,
        metadata_json,
        content_blob
      FROM content_references;

      DROP TABLE content_references;
      ALTER TABLE content_references_v12 RENAME TO content_references;

      CREATE INDEX content_references_owner_idx
        ON content_references(workspace_id, task_id, session_id, worker_id);
      CREATE INDEX content_references_request_idx
        ON content_references(request_id)
        WHERE request_id IS NOT NULL;
    `,
  },
  {
    version: 13,
    name: "aionui-scheduled-general-work",
    sql: `
      CREATE TABLE aionui_schedule_jobs (
        job_id TEXT PRIMARY KEY CHECK (
          length(job_id) = 80 AND
          substr(job_id, 1, 16) = 'schedule-aionui-' AND
          substr(job_id, 17) NOT GLOB '*[^0-9a-f]*'
        ),
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        conversation_hash TEXT NOT NULL CHECK (
          length(conversation_hash) = 64 AND
          conversation_hash NOT GLOB '*[^0-9a-f]*'
        ),
        native_conversation_id TEXT NOT NULL CHECK (
          length(native_conversation_id) BETWEEN 1 AND 256
        ),
        native_conversation_title TEXT CHECK (
          native_conversation_title IS NULL OR
          length(native_conversation_title) BETWEEN 1 AND 256
        ),
        workspace_id TEXT NOT NULL UNIQUE
          REFERENCES workspaces(id) ON DELETE RESTRICT,
        workspace_grant_id TEXT NOT NULL UNIQUE
          REFERENCES workspace_grants(grant_id) ON DELETE RESTRICT,
        name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 256),
        description TEXT CHECK (
          description IS NULL OR length(description) BETWEEN 1 AND 2048
        ),
        prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 1 AND 16384),
        schedule_kind TEXT NOT NULL CHECK (schedule_kind IN ('at', 'every', 'cron')),
        schedule_value TEXT NOT NULL CHECK (length(schedule_value) <= 256),
        schedule_time_zone TEXT CHECK (
          schedule_time_zone IS NULL OR length(schedule_time_zone) BETWEEN 1 AND 128
        ),
        schedule_description TEXT NOT NULL CHECK (length(schedule_description) <= 512),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        next_run_at_ms INTEGER CHECK (next_run_at_ms IS NULL OR next_run_at_ms >= 0),
        last_run_at_ms INTEGER CHECK (last_run_at_ms IS NULL OR last_run_at_ms >= 0),
        last_status TEXT CHECK (
          last_status IS NULL OR last_status IN ('ok', 'error', 'skipped', 'missed')
        ),
        last_incident_code TEXT CHECK (
          last_incident_code IS NULL OR length(last_incident_code) BETWEEN 1 AND 128
        ),
        active_claim TEXT CHECK (
          active_claim IS NULL OR length(active_claim) BETWEEN 1 AND 128
        ),
        active_claimed_at_ms INTEGER CHECK (
          active_claimed_at_ms IS NULL OR active_claimed_at_ms >= 0
        ),
        run_sequence INTEGER NOT NULL CHECK (run_sequence >= 0),
        run_count INTEGER NOT NULL CHECK (run_count >= 0 AND run_count <= run_sequence),
        retry_count INTEGER NOT NULL CHECK (retry_count = 0),
        max_retries INTEGER NOT NULL CHECK (max_retries = 0),
        queue_enabled INTEGER NOT NULL CHECK (queue_enabled = 0),
        created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
        updated_at_ms INTEGER NOT NULL CHECK (
          updated_at_ms >= created_at_ms
        ),
        deleted_at_ms INTEGER CHECK (
          deleted_at_ms IS NULL OR deleted_at_ms >= updated_at_ms
        ),
        job_json TEXT NOT NULL,
        CHECK ((active_claim IS NULL) = (active_claimed_at_ms IS NULL)),
        CHECK (schedule_kind = 'cron' OR schedule_time_zone IS NULL),
        CHECK (
          deleted_at_ms IS NULL OR (
            enabled = 0 AND
            next_run_at_ms IS NULL AND
            active_claim IS NULL
          )
        )
      ) STRICT;

      CREATE UNIQUE INDEX aionui_schedule_identity_idx
        ON aionui_schedule_jobs(conversation_hash, job_id);
      CREATE INDEX aionui_schedule_next_run_idx
        ON aionui_schedule_jobs(enabled, next_run_at_ms)
        WHERE deleted_at_ms IS NULL AND enabled = 1;
      CREATE INDEX aionui_schedule_active_claim_idx
        ON aionui_schedule_jobs(active_claim)
        WHERE active_claim IS NOT NULL;
    `,
  },
  {
    version: 14,
    name: "team-plan-authority",
    sql: `
      CREATE TABLE team_plans (
        plan_id TEXT PRIMARY KEY CHECK (
          length(plan_id) = 74 AND
          substr(plan_id, 1, 10) = 'team-plan-' AND
          substr(plan_id, 11) NOT GLOB '*[^0-9a-f]*'
        ),
        protocol_version INTEGER NOT NULL CHECK (protocol_version = 1),
        correlation_id TEXT NOT NULL CHECK (length(correlation_id) BETWEEN 1 AND 128),
        plan_version INTEGER NOT NULL CHECK (plan_version >= 1),
        node_count INTEGER NOT NULL CHECK (node_count BETWEEN 3 AND 5),
        record_sha256 TEXT NOT NULL CHECK (
          length(record_sha256) = 64 AND
          record_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        plan_json TEXT NOT NULL CHECK (length(plan_json) BETWEEN 1 AND 65536),
        UNIQUE (correlation_id, plan_version)
      ) STRICT;

      CREATE INDEX team_plans_correlation_idx
        ON team_plans(correlation_id, plan_version);
    `,
  },
  {
    version: 15,
    name: "team-run-authority",
    sql: `
      CREATE TABLE team_definitions (
        team_id TEXT PRIMARY KEY CHECK (
          length(team_id) = 69 AND
          substr(team_id, 1, 5) = 'team-' AND
          substr(team_id, 6) NOT GLOB '*[^0-9a-f]*'
        ),
        record_sha256 TEXT NOT NULL CHECK (
          length(record_sha256) = 64 AND
          record_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
        removed_at TEXT CHECK (removed_at IS NULL OR length(removed_at) = 24),
        team_json TEXT NOT NULL CHECK (length(team_json) BETWEEN 1 AND 65536)
      ) STRICT;

      CREATE TABLE team_runs (
        run_id TEXT PRIMARY KEY CHECK (
          length(run_id) = 73 AND
          substr(run_id, 1, 9) = 'team-run-' AND
          substr(run_id, 10) NOT GLOB '*[^0-9a-f]*'
        ),
        team_id TEXT NOT NULL REFERENCES team_definitions(team_id) ON DELETE RESTRICT,
        plan_id TEXT NOT NULL REFERENCES team_plans(plan_id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        status TEXT NOT NULL CHECK (
          status IN ('accepted', 'running', 'paused', 'blocked', 'completed', 'failed', 'cancelled')
        ),
        updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
        record_sha256 TEXT NOT NULL CHECK (
          length(record_sha256) = 64 AND
          record_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) BETWEEN 1 AND 262144)
      ) STRICT;

      CREATE TABLE team_run_revisions (
        run_id TEXT NOT NULL REFERENCES team_runs(run_id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision >= 1),
        occurred_at TEXT NOT NULL CHECK (length(occurred_at) = 24),
        record_sha256 TEXT NOT NULL CHECK (
          length(record_sha256) = 64 AND
          record_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) BETWEEN 1 AND 262144),
        PRIMARY KEY (run_id, revision)
      ) STRICT;

      CREATE INDEX team_definitions_updated_idx
        ON team_definitions(updated_at, team_id)
        WHERE removed_at IS NULL;
      CREATE INDEX team_runs_team_updated_idx
        ON team_runs(team_id, updated_at, run_id);
      CREATE INDEX team_runs_recoverable_idx
        ON team_runs(status, updated_at, run_id)
        WHERE status NOT IN ('completed', 'failed', 'cancelled');
    `,
  },
  {
    version: 16,
    name: "team-experience-authority",
    sql: `
      CREATE TABLE team_experience_bindings (
        team_id TEXT PRIMARY KEY CHECK (length(team_id) BETWEEN 1 AND 256),
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        experience TEXT NOT NULL CHECK (experience IN ('standard', 'orchestrated')),
        bound_at TEXT NOT NULL CHECK (length(bound_at) = 24),
        record_sha256 TEXT NOT NULL CHECK (
          length(record_sha256) = 64 AND
          record_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        binding_json TEXT NOT NULL CHECK (length(binding_json) BETWEEN 1 AND 2048)
      ) STRICT;

      CREATE INDEX team_experience_bindings_experience_idx
        ON team_experience_bindings(experience, bound_at, team_id);
    `,
  },
  {
    version: 17,
    name: "standard-team-message-delivery-authority",
    sql: `
      CREATE TABLE standard_team_message_deliveries (
        delivery_id TEXT PRIMARY KEY CHECK (
          length(delivery_id) = 87 AND
          substr(delivery_id, 1, 23) = 'standard-team-delivery-' AND
          substr(delivery_id, 24) NOT GLOB '*[^0-9a-f]*'
        ),
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        client_request_nonce TEXT NOT NULL CHECK (
          length(client_request_nonce) BETWEEN 1 AND 128
        ),
        request_sha256 TEXT NOT NULL CHECK (
          length(request_sha256) = 64 AND
          request_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        team_id TEXT NOT NULL CHECK (length(team_id) BETWEEN 1 AND 256),
        target_slot_id TEXT CHECK (
          target_slot_id IS NULL OR length(target_slot_id) BETWEEN 1 AND 256
        ),
        state TEXT NOT NULL CHECK (
          state IN ('pending-effect', 'effect-observed', 'effect-uncertain')
        ),
        provider_enqueue_status TEXT CHECK (
          provider_enqueue_status IS NULL OR
          provider_enqueue_status IN ('accepted', 'queued', 'blocked_runtime_starting')
        ),
        provider_message_id TEXT CHECK (
          provider_message_id IS NULL OR length(provider_message_id) BETWEEN 1 AND 256
        ),
        provider_run_id TEXT CHECK (
          provider_run_id IS NULL OR length(provider_run_id) BETWEEN 1 AND 256
        ),
        created_at TEXT NOT NULL CHECK (length(created_at) = 24),
        updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
        delivery_json TEXT NOT NULL CHECK (length(delivery_json) BETWEEN 1 AND 8192),
        CHECK (updated_at >= created_at),
        CHECK (state <> 'pending-effect' OR (provider_enqueue_status IS NULL AND provider_message_id IS NULL AND provider_run_id IS NULL)),
        CHECK (state <> 'effect-observed' OR (provider_enqueue_status IS NOT NULL AND provider_message_id IS NOT NULL AND provider_run_id IS NOT NULL)),
        CHECK (state = 'effect-observed' OR provider_enqueue_status IS NULL)
      ) STRICT;

      CREATE UNIQUE INDEX standard_team_message_unresolved_target_idx
        ON standard_team_message_deliveries(team_id, COALESCE(target_slot_id, ''))
        WHERE state IN ('pending-effect', 'effect-uncertain');
      CREATE INDEX standard_team_message_nonce_idx
        ON standard_team_message_deliveries(team_id, target_slot_id, client_request_nonce);
    `,
  },
  {
    version: 18,
    name: "artifact-workspace-delivery",
    sql: `
      CREATE TABLE artifact_deliveries (
        artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        state TEXT NOT NULL CHECK (
          state IN ('pending', 'applying', 'applied', 'conflict', 'failed', 'cancelled')
        ),
        grant_id TEXT NOT NULL CHECK (length(grant_id) BETWEEN 1 AND 256),
        patch_reference TEXT NOT NULL CHECK (length(patch_reference) BETWEEN 1 AND 512),
        patch_sha256 TEXT NOT NULL CHECK (
          length(patch_sha256) = 64 AND patch_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        patch_byte_length INTEGER NOT NULL CHECK (patch_byte_length > 0),
        base_commit TEXT NOT NULL CHECK (
          (length(base_commit) = 40 OR length(base_commit) = 64) AND
          base_commit NOT GLOB '*[^0-9a-f]*'
        ),
        changed_file_count INTEGER NOT NULL CHECK (changed_file_count >= 0),
        approval_id TEXT CHECK (approval_id IS NULL OR length(approval_id) BETWEEN 1 AND 256),
        applied_commit TEXT CHECK (
          applied_commit IS NULL OR (
            (length(applied_commit) = 40 OR length(applied_commit) = 64) AND
            applied_commit NOT GLOB '*[^0-9a-f]*'
          )
        ),
        failure_code TEXT CHECK (
          failure_code IS NULL OR failure_code IN (
            'artifact-ownership-mismatch',
            'patch-unavailable',
            'patch-digest-mismatch',
            'workspace-grant-invalid',
            'workspace-dirty',
            'head-drift',
            'patch-conflict',
            'apply-failed',
            'lock-unavailable'
          )
        ),
        failure_message TEXT CHECK (
          failure_message IS NULL OR length(failure_message) BETWEEN 1 AND 1024
        ),
        created_at TEXT NOT NULL CHECK (length(created_at) = 24),
        updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
        CHECK (updated_at >= created_at),
        CHECK (state <> 'applied' OR applied_commit IS NOT NULL),
        CHECK (state = 'applied' OR applied_commit IS NULL),
        CHECK (state IN ('conflict', 'failed') OR failure_code IS NULL),
        CHECK (state NOT IN ('conflict', 'failed') OR failure_code IS NOT NULL),
        CHECK (failure_message IS NULL OR failure_code IS NOT NULL)
      ) STRICT;

      CREATE INDEX artifact_deliveries_task_idx ON artifact_deliveries(task_id);
      CREATE INDEX artifact_deliveries_state_idx ON artifact_deliveries(state);
    `,
  },
  {
    version: 19,
    name: "artifact-delivery-split-authority",
    sql: `
      CREATE TABLE artifact_deliveries_v19 (
        artifact_id TEXT PRIMARY KEY REFERENCES artifacts(id) ON DELETE CASCADE,
        contract_version INTEGER NOT NULL CHECK (contract_version = 2),
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        state TEXT NOT NULL CHECK (
          state IN ('pending', 'applying', 'applied', 'conflict', 'failed', 'cancelled')
        ),
        patch_owner_grant_id TEXT NOT NULL CHECK (
          length(patch_owner_grant_id) BETWEEN 1 AND 256
        ),
        destination_grant_id TEXT CHECK (
          destination_grant_id IS NULL OR length(destination_grant_id) BETWEEN 1 AND 256
        ),
        patch_reference TEXT NOT NULL CHECK (length(patch_reference) BETWEEN 1 AND 512),
        patch_sha256 TEXT NOT NULL CHECK (
          length(patch_sha256) = 64 AND patch_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        patch_byte_length INTEGER NOT NULL CHECK (patch_byte_length > 0),
        base_commit TEXT NOT NULL CHECK (
          (length(base_commit) = 40 OR length(base_commit) = 64) AND
          base_commit NOT GLOB '*[^0-9a-f]*'
        ),
        changed_file_count INTEGER NOT NULL CHECK (changed_file_count >= 0),
        approval_id TEXT CHECK (approval_id IS NULL OR length(approval_id) BETWEEN 1 AND 256),
        verified_head TEXT CHECK (
          verified_head IS NULL OR (
            (length(verified_head) = 40 OR length(verified_head) = 64) AND
            verified_head NOT GLOB '*[^0-9a-f]*'
          )
        ),
        failure_code TEXT CHECK (
          failure_code IS NULL OR failure_code IN (
            'artifact-ownership-mismatch',
            'patch-unavailable',
            'patch-digest-mismatch',
            'workspace-grant-invalid',
            'workspace-dirty',
            'head-drift',
            'patch-conflict',
            'apply-failed',
            'lock-unavailable'
          )
        ),
        failure_message TEXT CHECK (
          failure_message IS NULL OR length(failure_message) BETWEEN 1 AND 1024
        ),
        created_at TEXT NOT NULL CHECK (length(created_at) = 24),
        updated_at TEXT NOT NULL CHECK (length(updated_at) = 24),
        CHECK (updated_at >= created_at),
        CHECK (state <> 'applied' OR verified_head IS NOT NULL),
        CHECK (state = 'applied' OR verified_head IS NULL),
        CHECK (state <> 'applied' OR destination_grant_id IS NOT NULL),
        CHECK (state <> 'applied' OR approval_id IS NOT NULL),
        CHECK (state <> 'pending' OR approval_id IS NULL),
        CHECK (state IN ('conflict', 'failed') OR failure_code IS NULL),
        CHECK (state NOT IN ('conflict', 'failed') OR failure_code IS NOT NULL),
        CHECK (failure_message IS NULL OR failure_code IS NOT NULL)
      ) STRICT;

      INSERT INTO artifact_deliveries_v19 (
        artifact_id,
        contract_version,
        workspace_id,
        task_id,
        session_id,
        state,
        patch_owner_grant_id,
        destination_grant_id,
        patch_reference,
        patch_sha256,
        patch_byte_length,
        base_commit,
        changed_file_count,
        approval_id,
        verified_head,
        failure_code,
        failure_message,
        created_at,
        updated_at
      )
      SELECT
        artifact_id,
        2,
        workspace_id,
        task_id,
        session_id,
        state,
        grant_id,
        CASE WHEN state = 'applied' THEN grant_id ELSE NULL END,
        patch_reference,
        patch_sha256,
        patch_byte_length,
        base_commit,
        changed_file_count,
        approval_id,
        applied_commit,
        failure_code,
        failure_message,
        created_at,
        updated_at
      FROM artifact_deliveries;

      DROP TABLE artifact_deliveries;
      ALTER TABLE artifact_deliveries_v19 RENAME TO artifact_deliveries;

      CREATE INDEX artifact_deliveries_task_idx ON artifact_deliveries(task_id);
      CREATE INDEX artifact_deliveries_state_idx ON artifact_deliveries(state);
    `,
  },
  {
    version: 20,
    name: "artifact-delivery-patch-owner-identity",
    sql: `
      ALTER TABLE artifact_deliveries ADD COLUMN patch_owner_worker_id TEXT;
      ALTER TABLE artifact_deliveries ADD COLUMN patch_request_id TEXT;

      -- The patch is readable only by the exact owner it was stored under, and persistence resolves
      -- that owner against the publishing session's own worker. Both facts are recoverable for rows
      -- this build wrote: the worker from the session, the request id from the publisher's own naming.
      UPDATE artifact_deliveries
      SET patch_owner_worker_id = (
        SELECT sessions.worker_id FROM sessions WHERE sessions.id = artifact_deliveries.session_id
      )
      WHERE session_id IS NOT NULL;

      UPDATE artifact_deliveries
      SET patch_request_id =
        'request-coding-publish-' ||
        substr(patch_reference, length('coding-publish-patch-') + 1)
      WHERE patch_reference LIKE 'coding-publish-patch-%';
    `,
  },
  {
    version: 21,
    name: "aionui-general-work-requirements",
    sql: `
      ALTER TABLE aionui_general_work_journeys
        ADD COLUMN requirements_json TEXT;
    `,
  },
  {
    version: 22,
    name: "artifact-delivery-destination-workspace",
    sql: `
      ALTER TABLE artifact_deliveries ADD COLUMN destination_workspace_id TEXT;
    `,
  },
  {
    version: 23,
    name: "privileged-audit-integrity-and-retention",
    sql: `
      CREATE TABLE privileged_audit_integrity (
        sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
        previous_sha256 TEXT NOT NULL CHECK (
          length(previous_sha256) = 64 AND previous_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        chain_sha256 TEXT NOT NULL CHECK (
          length(chain_sha256) = 64 AND chain_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        FOREIGN KEY (sequence) REFERENCES privileged_audit_records(sequence) ON DELETE CASCADE
      ) STRICT;

      CREATE TABLE privileged_audit_retention_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        contract_version INTEGER NOT NULL CHECK (contract_version = 1),
        policy_version INTEGER NOT NULL CHECK (policy_version = 1),
        max_age_days INTEGER NOT NULL CHECK (max_age_days = 90),
        max_record_count INTEGER NOT NULL CHECK (max_record_count = 100000),
        pruned_record_count INTEGER NOT NULL CHECK (pruned_record_count >= 0),
        anchor_sequence INTEGER NOT NULL CHECK (anchor_sequence >= 0),
        anchor_sha256 TEXT NOT NULL CHECK (
          length(anchor_sha256) = 64 AND anchor_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        last_sequence INTEGER NOT NULL CHECK (last_sequence >= 0),
        chain_head_sha256 TEXT NOT NULL CHECK (
          length(chain_head_sha256) = 64 AND chain_head_sha256 NOT GLOB '*[^0-9a-f]*'
        ),
        last_maintained_at TEXT NOT NULL,
        CHECK (anchor_sequence = pruned_record_count),
        CHECK (last_sequence >= anchor_sequence)
      ) STRICT;

      INSERT INTO privileged_audit_retention_state (
        singleton, contract_version, policy_version, max_age_days,
        max_record_count, pruned_record_count, anchor_sequence, anchor_sha256,
        last_sequence, chain_head_sha256, last_maintained_at
      )
      SELECT
        1, 1, 1, 90, 100000, 0, 0,
        '4eab5dc1aa1804c942a382c85b6c77673f44b46cae57082957c1ffc0a9af61c1',
        COALESCE(MAX(sequence), 0),
        '4eab5dc1aa1804c942a382c85b6c77673f44b46cae57082957c1ffc0a9af61c1',
        '1970-01-01T00:00:00.000Z'
      FROM privileged_audit_records;
    `,
  },
] as const;

interface MigrationHistoryRow {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
}

function pragmaNumber(database: DatabaseSync, name: "application_id" | "user_version"): number {
  const row = database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
  const value = row === undefined ? undefined : Object.values(row)[0];

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new PersistenceError("corrupt-database", `SQLite PRAGMA ${name} is invalid`);
  }

  return value;
}

function userTableNames(database: DatabaseSync): readonly string[] {
  return database
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all()
    .map((row) => {
      const name = (row as Record<string, unknown>).name;
      if (typeof name !== "string") {
        throw new PersistenceError("corrupt-database", "SQLite schema contains an invalid name");
      }
      return name;
    });
}

function migrationChecksum(migration: SqliteMigration): string {
  return createHash("sha256")
    .update(`${migration.version}\n${migration.name}\n${migration.sql}`)
    .digest("hex");
}

function validateRegistry(migrations: readonly SqliteMigration[]): void {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1;

    if (
      migration.version !== expectedVersion ||
      !Number.isSafeInteger(migration.version) ||
      migration.name.trim().length === 0 ||
      migration.sql.trim().length === 0
    ) {
      throw new PersistenceError(
        "migration-registry",
        `SQLite migration registry must contain contiguous immutable versions; expected ${expectedVersion}`,
      );
    }
  }
}

function readMigrationHistory(database: DatabaseSync): readonly MigrationHistoryRow[] {
  try {
    return database
      .prepare(
        `SELECT version, name, checksum
         FROM actestra_schema_migrations
         ORDER BY version`,
      )
      .all()
      .map((row) => {
        const record = row as Record<string, unknown>;

        if (
          typeof record.version !== "number" ||
          typeof record.name !== "string" ||
          typeof record.checksum !== "string"
        ) {
          throw new PersistenceError(
            "migration-history",
            "Actestra migration history contains an invalid row",
          );
        }

        return {
          version: record.version,
          name: record.name,
          checksum: record.checksum,
        };
      });
  } catch (error) {
    if (error instanceof PersistenceError) {
      throw error;
    }

    throw new PersistenceError(
      "migration-history",
      "Actestra migration history is missing or unreadable",
      {
        cause: error,
      },
    );
  }
}

function verifyMigrationHistory(
  database: DatabaseSync,
  migrations: readonly SqliteMigration[],
  currentVersion: number,
): void {
  const history = readMigrationHistory(database);

  if (history.length !== currentVersion) {
    throw new PersistenceError(
      "migration-history",
      `Actestra schema version ${currentVersion} requires exactly ${currentVersion} history rows`,
    );
  }

  for (let index = 0; index < history.length; index += 1) {
    const recorded = history[index];
    const expected = migrations[index];

    if (
      expected === undefined ||
      recorded.version !== expected.version ||
      recorded.name !== expected.name ||
      recorded.checksum !== migrationChecksum(expected)
    ) {
      throw new PersistenceError(
        "migration-history",
        `Actestra migration history does not match registered migration ${index + 1}`,
      );
    }
  }
}

function verifyDatabaseIntegrity(database: DatabaseSync): void {
  const foreignKeyViolations = database.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyViolations.length > 0) {
    throw new PersistenceError(
      "corrupt-database",
      `Actestra database contains ${foreignKeyViolations.length} foreign-key violation(s)`,
    );
  }

  const quickCheck = database.prepare("PRAGMA quick_check").get() as
    | Record<string, unknown>
    | undefined;
  if (quickCheck === undefined || Object.values(quickCheck)[0] !== "ok") {
    throw new PersistenceError("corrupt-database", "Actestra database failed PRAGMA quick_check");
  }
}

function rollbackMigration(database: DatabaseSync): void {
  try {
    database.exec("ROLLBACK");
  } catch {
    // The original migration error remains the authoritative failure.
  }
}

function applyMigration(
  database: DatabaseSync,
  migration: SqliteMigration,
  appliedAt: string,
): void {
  database.exec("BEGIN IMMEDIATE");

  try {
    database.exec(migration.sql);
    database
      .prepare(
        `INSERT INTO actestra_schema_migrations (version, name, checksum, applied_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(migration.version, migration.name, migrationChecksum(migration), appliedAt);
    database.exec(`PRAGMA application_id = ${ACTESTRA_SQLITE_APPLICATION_ID}`);
    database.exec(`PRAGMA user_version = ${migration.version}`);

    if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
      throw new PersistenceError(
        "corrupt-database",
        `Actestra migration ${migration.version} introduced foreign-key violations`,
      );
    }

    database.exec("COMMIT");
  } catch (error) {
    rollbackMigration(database);
    throw new PersistenceError(
      "corrupt-database",
      `Actestra migration ${migration.version} (${migration.name}) failed`,
      {
        cause: error,
      },
    );
  }
}

export function migrateSqliteDatabase(
  database: DatabaseSync,
  migrations: readonly SqliteMigration[] = CORE_SQLITE_MIGRATIONS,
  appliedAt = new Date().toISOString(),
): SqliteMigrationResult {
  validateRegistry(migrations);

  const applicationId = pragmaNumber(database, "application_id");
  const fromVersion = pragmaNumber(database, "user_version");
  const targetVersion = migrations.at(-1)?.version ?? 0;
  const tables = userTableNames(database);

  if (applicationId !== 0 && applicationId !== ACTESTRA_SQLITE_APPLICATION_ID) {
    throw new PersistenceError(
      "foreign-database",
      `SQLite application ID ${applicationId} does not belong to Actestra`,
    );
  }

  if (applicationId === 0 && (fromVersion !== 0 || tables.length > 0)) {
    throw new PersistenceError(
      "unowned-database",
      "Actestra will not adopt a populated or versioned database without its application ID",
    );
  }

  if (applicationId === ACTESTRA_SQLITE_APPLICATION_ID && fromVersion === 0) {
    throw new PersistenceError(
      "migration-history",
      "An Actestra-owned database cannot have schema version 0",
    );
  }

  if (fromVersion > targetVersion) {
    throw new PersistenceError(
      "future-schema",
      `Actestra database schema ${fromVersion} is newer than supported schema ${targetVersion}`,
    );
  }

  if (fromVersion > 0) {
    verifyMigrationHistory(database, migrations, fromVersion);
  }

  const appliedVersions: number[] = [];
  for (const migration of migrations.slice(fromVersion)) {
    applyMigration(database, migration, appliedAt);
    appliedVersions.push(migration.version);
  }

  verifyMigrationHistory(database, migrations, targetVersion);
  verifyDatabaseIntegrity(database);

  return {
    fromVersion,
    toVersion: targetVersion,
    appliedVersions,
  };
}
