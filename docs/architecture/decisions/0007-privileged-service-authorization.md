# ADR-0007: Privileged Service Authorization

- Status: Accepted
- Date: 2026-07-28

## Context

Actestra owns workspace, task, session, worker, approval, credential-reference,
event, and audit state. P3.5 must define the boundary through which later MCP
servers and native tools request privileged work without introducing a real
credential backend, tool transport, worker process, or renderer operation.

The boundary must prevent a worker or renderer from:

- declaring a harmless action while invoking a more powerful tool;
- treating a missing policy rule or unavailable service as permission;
- reusing approval evidence for a changed or second operation;
- passing secret values through events, logs, fixtures, snapshots, or tool
  metadata;
- executing before the required audit evidence is accepted;
- treating an approval grant as proof that the requested tool succeeded.

ADR-0002 already makes Actestra the source of truth for permissions,
credential references, and audit evidence. ADR-0004 defines approval and tool
event references without raw credential fields. ADR-0006 keeps policy,
credentials, and tool execution outside `AgentAdapter`. This decision defines
the P3.5 authority chain between those boundaries.

## Decision

### Main-owned, closed contracts

Actestra defines privileged contract version `1`. The contracts are pure
TypeScript, runtime validated, and closed to undeclared fields.

Every protected operation binds:

- tool request, workspace, task, session, and worker identifiers;
- an Actestra-owned tool identifier and opaque input reference;
- one declared action and resource kind;
- a user-facing summary that is never copied into audit records;
- zero or more opaque credential references;
- the request time.

The initial action vocabulary is:

- workspace read;
- task-output artifact creation;
- workspace modification;
- workspace deletion;
- shell execution;
- system change;
- network request;
- message send;
- publish;
- Git push;
- credential use;
- generic tool invocation.

The initial resource vocabulary is workspace, task output, repository, external
service, and system. Unknown actions, resources, versions, identifiers, extra
fields, duplicate credential references, or future-dated requests fail closed.

Raw tool arguments do not cross this contract. A protected operation carries
an opaque input reference owned by a later main-process integration. This keeps
P3.5 fixtures and audit records free of workspace content and secret material.

### Tool capability manifest

Before policy evaluation, the gateway loads a version-1 capability manifest
from the injected tool executor. The manifest declares:

- the exact tool identifier;
- allowed actions;
- allowed resource kinds;
- whether credential use is forbidden, optional, or required;
- a positive execution timeout bound.

The requested tool, action, resource kind, and credential-use mode must match
the manifest exactly. The manifest is capability metadata, not worker input.
Unknown or malformed manifests fail before policy evaluation or execution.

The executor port is transport neutral. P3.5 does not select MCP framing,
process hosting, native-tool transport, argument storage, cancellation
transport, or a real timeout mechanism. A future transport must implement the
accepted manifest and gateway contracts rather than bypass them.

### Policy snapshot and conservative evaluation

The policy engine evaluates one immutable, versioned policy snapshot. Rules
match:

- actions;
- resource kinds;
- credential-use mode;
- optionally, exact tool identifiers.

Rules have one effect: `allow`, `require-approval`, or `deny`. Rule order has no
authority. Every matching effect is considered using this conservative
precedence:

1. `deny`;
2. `require-approval`;
3. `allow`.

No matching rule produces a deny decision. Duplicate rule identifiers, empty
match sets, unknown values, or an unavailable policy engine fail closed.

Each decision records a main-generated decision identifier, policy revision,
request identifier, effect, stable reason code, matching rule identifiers, and
observed evaluation time. A policy decision authorizes only the operation for
which the main-owned gateway requested it.

P3.5 defines the rule representation and evaluator, but does not register a
default production policy. A real tool registry and startup integration must
exist before a production allow rule can be activated.

### Approval evidence

An `allow` decision produces direct policy evidence for the immediately
following gateway execution. A `require-approval` decision creates or resumes
one Actestra-owned approval request.

An approval request snapshots the complete protected operation and policy
revision. It has a configured finite expiry and one terminal resolution:
approved, denied, expired, or cancelled. User decisions include an opaque local
actor reference; expiry is system-resolved.

Approved evidence is consumed at most once. Consumption requires:

- the same approval identifier;
- the exact protected operation;
- the same policy revision and a current `require-approval` decision;
- resolution before expiry;
- use before expiry;
- no previous consumption.

A changed operation, changed policy revision, denial, cancellation, expiry,
unknown approval, or replay fails closed. A caller must create a fresh tool
request rather than mutate or revive terminal evidence.

Approval permits a later execution attempt. It does not prove tool start,
completion, external side effects, or success.

### Credential references and leases

Protected operations carry only opaque credential references. Secret values
remain behind a future operating-system secure-storage implementation and are
never returned by the P3.5 contract.

After authorization, the credential broker may issue short-lived,
operation-bound lease references. A lease contains only:

- lease and credential references;
- the bound tool request and authorization grant identifiers;
- issue and expiry times.

The broker rejects a grant that does not match the operation. The gateway
releases every issued lease after the deterministic executor returns or fails.
Broker mutations are serialized so issue, rollback, release, expiry sweep, and
identifier reservation cannot interleave. Released operation metadata and
lease-identifier replay protection are retained only for a configured duration
after lease expiry, then evicted.
The P3.5 reference broker has no secret store and performs no keychain,
filesystem, network, process, or environment access.

### Metadata-only audit trail

The audit trail is append-only in memory for P3.5, with a version, generated
record identifier, gapless sequence, observed time, and fixed `metadata`
redaction class. Durable storage belongs to P3.6.

Audit context includes only opaque ownership identifiers, tool identifier,
action, and resource kind. The initial audit vocabulary covers:

- policy evaluation;
- approval request, resolution, and consumption;
- credential lease issue and release;
- tool start, completion, and failure.

Approval summaries, input references, raw arguments, output content, secret
values, credential values, and arbitrary exception messages are excluded.
Failures use stable error codes only.

A policy-decision audit record must append successfully before the gateway can
create approval evidence or execute. Approval and credential state changes
also append their audit record before becoming authoritative. A tool-start
record must append before calling the executor.

If outcome auditing or credential cleanup fails after the executor was called,
the gateway reports that execution may already have occurred and callers must
not retry automatically. Audit failure never rewrites an attempted operation
as success.

### Gateway order

The main-owned gateway performs one fixed sequence:

1. validate the protected operation;
2. load and validate the tool capability manifest;
3. evaluate policy;
4. append policy audit evidence;
5. reject, return an approval request, or consume approval evidence;
6. issue credential lease references;
7. append tool-start evidence;
8. call the injected transport-neutral executor;
9. append completion or failure evidence;
10. release credential leases.

No injected component may reorder or skip these checks. P3.5 implementations
are not registered at application startup and expose no preload or renderer
operation.

## Consequences

### Positive

- Missing, conflicting, stale, expired, or replayed authority fails closed.
- A tool cannot self-declare capabilities that differ from its main-owned
  manifest.
- Policy and approval behavior is deterministic without real-time sleeps.
- Credentials remain references throughout P3.5 and cannot leak through its
  result or audit shapes.
- Audit evidence distinguishes authorization, attempted execution, and outcome.
- MCP and native transports can share one authority chain.

### Costs

- Main integration must maintain operation input references and a trusted tool
  registry.
- A conservative rule lattice can require more explicit policy than an ordered
  first-match language.
- One-shot approval requires a new request after expiry or any material change.
- Post-execution audit or cleanup failure must be surfaced as uncertain rather
  than retried automatically.
- P3.5 in-memory evidence is not restart recovery.

## Rejected alternatives

### Let workers evaluate their own policy

Rejected because a worker could reinterpret scope, bypass a central denial, or
produce unverifiable approval evidence.

### Use ordered first-match policy rules

Rejected because rule reordering or shadowing could silently weaken a denial.

### Treat no matching policy rule as allow

Rejected because new tools and actions would gain authority by omission.

### Put raw arguments or credentials in approval and audit records

Rejected because persistent and diagnostic surfaces would become a secret and
workspace-content exfiltration path.

### Reuse one approval for equivalent requests

Rejected because equivalence is ambiguous across tool arguments, policy
revisions, workspaces, sessions, and time.

### Consider approval to be execution success

Rejected because authorization cannot prove transport delivery, external side
effects, tool completion, or audit durability.

### Connect a real keychain, MCP server, or native tool in P3.5

Rejected because startup ownership, persistence projection, renderer intent
operations, cancellation transport, and packaged boundary proof remain P3.6 or
later work.

## Review triggers

Review this decision if:

- a real MCP or native-tool transport cannot implement the capability manifest;
- raw input references cannot be resolved without weakening the main boundary;
- policy needs path-, host-, command-, or argument-level matching;
- credential injection requires a different lease or process-isolation model;
- durable audit persistence needs stronger integrity or retention semantics;
- multi-user identity requires signed or delegated approval evidence;
- a real executor needs transactional or two-phase outcome recording.
