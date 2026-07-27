# ADR-0002: Actestra Owns Product State

- Status: Accepted
- Date: 2026-07-27

## Context

General agents, coding agents, orchestration engines, MCP servers, and desktop
frameworks often maintain separate sessions, configuration files, credentials,
approvals, and histories. Exposing these independent systems directly would
produce inconsistent recovery, permissions, audit evidence, and user
expectations.

## Decision

Actestra is the source of truth for:

- workspaces and grants;
- tasks, sessions, workers, and dependency graphs;
- permissions and approval evidence;
- versioned events;
- artifacts and output ownership;
- credential references;
- audit and recovery metadata.

External runtimes are workers behind a versioned `AgentAdapter` and unified event
contract. Their native sessions may be retained for compatibility or debugging,
but they are not the only authoritative record for product behavior.

The desktop renderer consumes Actestra state and events. It does not consume an
external worker protocol directly or receive privileged credentials.

## Consequences

### Positive

- Consistent UI, recovery, audit, and policy across workers.
- Workers can be upgraded, replaced, or disabled independently.
- Multi-agent orchestration can reason about stable task and dependency states.
- Protected operations have one approval evidence path.

### Costs

- Events and state require explicit schemas and migrations.
- Adapters must reconcile worker-native state with Actestra state.
- Crash recovery and event ordering require dedicated tests.
- Some worker-native UI features must be reimplemented through common concepts.

## Rejected alternatives

### Let each worker own its sessions and permissions

Rejected because the product could not provide coherent recovery, cancellation,
audit, or team coordination.

### Store only rendered chat history

Rejected because chat text cannot prove tool execution, approval, artifact,
dependency, or failure state.

### Let the renderer orchestrate workers

Rejected because renderer compromise or reload would affect privileged lifecycle
and state integrity.

## Review triggers

Review this decision only if a future runtime can provide the complete Actestra
state, policy, migration, audit, and multi-worker contract without creating a
second source of truth.
