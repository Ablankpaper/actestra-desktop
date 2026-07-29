# ADR-0013: Gate AionUi Approval Delivery Through P3 Policy and Audit

- Status: Accepted
- Date: 2026-07-29

## Context

ADR-0012 makes a desktop AionUi confirmation response durable before it is
sent to the loopback AionCore compatibility runtime. That closes the
crash-before-delivery gap, but F3.1 still calls the native transport directly.
The accepted P3 gateway, policy, capability-manifest, authorization, and
durable audit contracts are not in that delivery path.

The native confirmation does not provide a complete Actestra
`ProtectedOperation` for the underlying file, shell, MCP, or other tool. Its
provider option identifiers may also be opaque. F3.2 must therefore avoid:

- inventing the action or resource semantics of the underlying native tool;
- treating a selected native option as a portable P3 approval grant;
- adding a second user confirmation after the preserved AionUi card;
- claiming that transport delivery authorizes or proves the native operation.

One bounded operation is known exactly: main may send the already persisted
response to the fixed loopback confirmation endpoint.

## Decision

### F3.2 authority scope

Actestra routes only the native response-delivery operation through the
accepted P3 privileged tool gateway.

The protected operation is fixed to:

- tool `aionui-approval-delivery-v1`;
- action `network.request`;
- resource `external-service`;
- no credential references;
- one opaque input reference derived from the persisted request hash and
  delivery attempt;
- one fixed user-facing summary that contains no native prompt, command, path,
  option, or response body.

This operation represents delivery to AionCore. It does not represent the
underlying tool that AionCore may run after accepting the response.

### Compatibility-scoped audit identity

The gateway requires workspace, task, session, worker, and request
identifiers. F3.2 derives private compatibility-scoped identifiers from
SHA-256 hashes of the bounded native conversation and call identities.

These identifiers:

- correlate delivery audit records without storing raw native identifiers;
- are not inserted into authoritative P3 workspace, task, session, or worker
  tables;
- cannot be used as evidence that those domains have migrated;
- never include the native message identifier, response body, prompt,
  description, command, path, or credential.

### Exact manifest and policy

The main-owned executor publishes one immutable capability manifest for the
exact tool, action, resource, no-credential mode, and 12-second transport
bound. Any other tool or capability request fails closed.

The F3.2 policy snapshot contains one exact allow rule for that manifest. The
rule does not bypass user consent: it runs only after F3.1 has persisted the
response selected through the preserved AionUi confirmation UI. Requiring a
second P3 approval here would create two competing confirmation flows.

No other production tool rule is activated. The existing general platform
composition remains deny-by-default with its disabled executor.

### Gateway and audit order

For each delivery attempt, the accepted P3 gateway performs:

1. protected-operation and manifest validation;
2. deterministic policy evaluation;
3. durable `policy.evaluated` audit append;
4. policy authorization with no credential lease;
5. durable `tool.started` audit append;
6. loopback native delivery;
7. durable `tool.completed` or `tool.failed` audit append.

Native delivery cannot start if policy or pre-execution audit is unavailable.
The input-reference registry exists only in trusted main memory for the active
call and is removed after success or failure.

### Error and restart behavior

A structured native rejection remains the F3.1 user-visible error after
`tool.failed` evidence persists. If outcome audit fails after native delivery
may have started, the gateway reports an uncertain post-execution failure.
F3.1 then uses its existing pending-confirmation reconciliation before any
retry.

On restart, schema version 5 pending decisions re-enter the same gate. The
policy and manifest are deterministic, while the schema version 3 privileged
audit sequence remains durable and gapless.

The native pending-list read used only for ambiguity reconciliation remains a
bounded compatibility read. F3.2 does not represent it as tool release or
pending-request authority.

### Migration and rollback

F3.2 needs no new schema. It reuses:

- schema version 5 for the authoritative decision and delivery outbox;
- schema version 3 for metadata-only privileged audit records.

`ACTESTRA_APPROVAL_POLICY_GATE=0` is the explicit runtime rollback to F3.1
persist-before-direct-delivery behavior. Removing downstream patch `0004`
provides the source rollback. Existing decision and audit rows remain
immutable and inert; rollback does not edit migration history, the frozen
AionUi source, or the native profile.

## Consequences

### Positive

- Every enabled native response delivery has a fixed capability, policy
  decision, pre-execution audit, attempt audit, and outcome audit.
- Pre-execution policy or audit failure cannot silently call AionCore.
- Native structured errors and F3.1 reconciliation semantics remain intact.
- The original AionUi permission cards, ACP options, pet confirmation, loading
  states, and response shapes remain unchanged.
- No underlying native tool semantics are guessed or promoted.

### Costs

- Compatibility-scoped identifiers exist in audit without corresponding
  authoritative P3 domain rows.
- The low-frequency gate holds policy decision and authorization identifier
  history in main memory until restart.
- Native pending-list reconciliation is not yet policy-gated.
- AionCore still owns pending-request creation, provider semantics, and the
  protected operation.

## Rejected alternatives

### Treat the native confirmation as a P3 tool approval

Rejected because the response lacks a complete trusted protected-operation
snapshot and opaque provider option identifiers do not have portable approval
semantics.

### Prompt the user a second time through P3 approval

Rejected because it would duplicate the preserved AionUi confirmation
experience and create two user-consent authorities.

### Audit after direct native delivery

Rejected because policy and tool-start evidence must be durable before the
effect begins.

### Persist native prompts, commands, paths, or response bodies in audit

Rejected because privileged audit is metadata-only. F3.1 retains only the
bounded response body required for crash-safe redelivery in its separate
private outbox.

### Enable a general native or MCP executor

Rejected because F3.2 owns one exact loopback delivery capability. General
tool transport, credentials, input storage, and underlying operation authority
require separate slices.

## Review triggers

The pending-list read trigger was reviewed by
[ADR-0014](0014-aionui-approval-reconciliation-policy-gate.md). That later
decision wraps the F3.2 transport without changing this delivery capability,
policy revision, or rollback.

Review this decision if:

- pending-confirmation creation moves to Actestra;
- the underlying native tool operation can be represented by a complete
  trusted `ProtectedOperation`;
- pending-list reads become an enabled general network capability;
- the loopback route, response schema, or AionCore version changes;
- an input-reference utility process replaces the bounded in-memory registry;
- the gate needs credential references or a non-loopback endpoint;
- AionUi is updated from `v2.1.41`.
