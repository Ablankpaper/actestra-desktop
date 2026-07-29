# ADR-0011: Observe Native AionUi Through an Inert P3 Shadow Projection

- Status: Accepted
- Date: 2026-07-29

## Context

ADR-0010 makes the exact AionUi `v2.1.41` application the retained product
foundation and requires authority to move one bridge domain at a time. F0
preserves the native application. F1 applies Actestra identity and isolates
unowned external effects without removing the original UI or functions.

F2 needs evidence that native conversation, task, provider, workspace,
approval, artifact, and runtime shapes can enter the accepted P3 contracts.
It must not make either of these unsafe claims:

- that a renderer-originated observation is authoritative Actestra state;
- that projection failure may change a native response, route, state, or UI
  result.

The P3 SQLite adapter already owns forward migrations and strict domain and
event validation. It does not yet own native AionUi general-work records.

## Decision

### Versioned observation contract

Actestra defines native observation contract version 1 for AionUi
`v2.1.41`. It accepts exactly seven bounded metadata domains:

1. conversation;
2. task;
3. provider;
4. workspace;
5. approval;
6. artifact;
7. runtime.

Collectors recognize only declared successful HTTP response paths and
WebSocket event names. A response yields at most 50 observations. Validators
reject unknown fields, unsupported values, invalid timestamps, blank or
oversized identifiers, and malformed payloads.

Conversation titles, descriptions, prompts, messages, filenames, artifact
payloads, approval descriptions, credentials, and arbitrary exception text are
not collected. Native identifiers, provider identifiers, and workspace keys may
exist transiently in the observation sent to main, but only deterministic
SHA-256-derived identities enter durable evidence.

### Side-channel publication

The existing AionUi HTTP and WebSocket adapter publishes recognized metadata as
a fire-and-forget side effect:

- the parsed native response or event payload continues to its original
  consumer unchanged;
- missing projection support, validation rejection, IPC failure, migration
  failure, or persistence failure does not reject or rewrite the native result;
- failure logs contain only a stable rejection code or a generic unavailable
  message.

Preload exposes one fixed `actestra:shadow-observe-v1` operation. Main accepts
one observation only from the current window's current main frame. It does not
expose SQLite, generic IPC, bridge channel selection, filesystem, shell,
credential, worker, policy, approval-resolution, or tool authority.

### Main-owned projection

Main validates each observation and derives a P3 `DomainGraph`. Task
observations may also derive one validated, gapless version 1 `CoreEvent`
stream. All projected identifiers and labels are Actestra-generated and
metadata-only.

The projection is evidence of shape compatibility only. It cannot drive native
UI state, satisfy a policy or approval check, authorize a tool, release a
worker, or become a migration input without a later accepted decision.

### Dedicated SQLite evidence

Schema version 4 adds append-only `aionui_shadow_evidence` storage with:

- a gapless sequence allocated in the write transaction;
- an immutable canonical evidence projection;
- indexed domain, identity hash, revision hash, and capture time;
- idempotent duplicate handling for the same domain, native identity hash, and
  native revision hash;
- strict canonical-to-index parity checks on read.

The adapter validates the P3 graph and event stream before write and again on
read. Shadow evidence is not inserted into the authoritative `workspaces`,
`tasks`, `sessions`, `workers`, `approvals`, `artifacts`, or `core_events`
tables.

### Authority and rollback

During F2, native AionUi remains the system of record for all seven observed
domains. Shadow evidence is inert and has no renderer read path.

Rollback regenerates the downstream tree without patch
`0002-actestra-p3-shadow-projection.mjs`. That stops new observations without
editing the frozen AionUi source or native records. Existing schema version 4
evidence may remain inert; forward-only migration history is not rewritten.

## Consequences

### Positive

- Real native journeys exercise P3 validation and persistence before authority
  moves.
- AionUi responses, events, routes, and functional UI remain unchanged.
- Deterministic hashes prove restart and duplicate behavior without storing raw
  native identity, workspace paths, or user content.
- Projection and persistence failure are contained outside the native response
  path.
- F3 can select one domain using measured native shapes instead of replacing
  all authority at once.

### Costs

- The renderer-side adapter observes metadata before it reaches trusted main;
  the resulting record is compatibility evidence, not a security audit record.
- Schema version 4 consumes local storage even though its records are inert.
- Every supported native response or event shape needs an explicit collector,
  validator, redaction rule, and regression fixture.
- Native schema changes in a later AionUi version require a new reviewed
  observation contract.

## Rejected alternatives

### Write projected records into authoritative P3 tables

Rejected because native AionUi would still own the same data and the product
would have two implicit systems of record.

### Replace native reads with P3 reads during F2

Rejected because F2 has not established migration, write authority, rollback,
or complete error-state compatibility for any domain.

### Persist raw native responses

Rejected because responses may contain user content, paths, provider details,
credentials, artifact payloads, and unbounded or attacker-controlled text.

### Make shadow publication part of native request success

Rejected because a compatibility-evidence failure must not break preserved
AionUi functions or alter their UI states.

### Add a generic renderer-to-main bridge

Rejected because generic channel or persistence access would expand renderer
authority beyond the single bounded observation operation.

## Review triggers

Review this decision if:

- any shadow record is proposed as product, policy, approval, audit, or
  migration authority;
- an F3 domain begins authoritative writes;
- the bridge needs a renderer read path or a utility-process transport;
- the observation source moves from renderer-side responses to a trusted
  backend event source;
- AionUi is updated from `v2.1.41`;
- raw user content, native identifiers, paths, credentials, or arbitrary
  diagnostics are proposed for persistence.
