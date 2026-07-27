# Actestra MVP

Status: Draft product scope for the first internal alpha

## Product statement

Actestra is a desktop AI workspace that lets a user complete general work,
delegate coding tasks to a specialized worker, and coordinate a small team of
agents without learning multiple tools or managing separate runtime state.

## Target users

- Individuals who want AI to work with local files and produce usable artifacts.
- Knowledge workers who need research, writing, analysis, and office workflows.
- Developers who need repository-aware coding, terminal execution, diffs, and
  test evidence.
- Advanced users who want visible, controllable multi-agent delegation.

## Core journeys

### 1. General work

The user selects a workspace, describes an outcome, reviews requested
permissions, watches progress, and receives an artifact without needing a CLI.

### 2. Coding work

The user selects a Git repository. Actestra creates an isolated worktree, routes
the task to the Goose worker, shows commands and diffs, runs checks, and returns
evidence before the user chooses whether to publish.

### 3. Team work

The user gives Actestra a complex goal. A leader creates a small dependency
graph, assigns general or coding workers, exposes progress and approval nodes,
and aggregates the result into one deliverable.

## MVP capabilities

- Desktop onboarding and model/provider configuration.
- Local workspace selection with explicit scope.
- One Actestra-owned task and conversation history.
- General worker for file, research, and artifact tasks.
- Goose worker adapter for repository and terminal tasks.
- Small team orchestration with a leader, dependencies, parallel workers,
  retries, pause, cancel, and user handoff.
- Unified events for messages, tool requests, approvals, artifacts, completion,
  failure, and cancellation.
- Risk-based approvals for filesystem, shell, network, message, publish, and Git
  actions.
- Diff, command, test, and artifact previews.
- Local credential storage through operating-system secure storage.
- Crash recovery for task, approval, and artifact metadata.
- Audit trail for user-approved operations.

## Explicit non-goals

- Importing Aera accounts, data, profiles, memory, code, or release systems.
- Supporting every external agent CLI in the first release.
- Embedding the full Eigent or CAMEL runtime before the Actestra core is proven.
- A public marketplace for agents, skills, or MCP servers.
- Organization administration, billing, mobile clients, or cloud collaboration.
- Autonomous payment, message sending, deployment, publishing, or Git push
  without explicit confirmation.
- Hidden or default YOLO execution.

## Safety baseline

| Action | Default policy |
| --- | --- |
| Read within an approved workspace | Allowed and audited |
| Create a new artifact in a task output area | Allowed and surfaced |
| Modify existing user files | Confirmation required |
| Delete or overwrite files | Confirmation required |
| Execute shell commands | Scoped approval required |
| Install software or change system settings | Explicit approval required |
| Access credentials | Brokered; never exposed to the renderer or model text |
| Send, publish, deploy, pay, or push | Confirmation for every material action |

## Internal-alpha success criteria

The MVP is ready for internal alpha only when:

1. a clean machine can install and launch a signed candidate;
2. all three core journeys complete against representative fixtures;
3. task, approval, artifact, and audit data survive restart;
4. cancel and failure paths leave no untracked worker or worktree;
5. the application never performs a protected action without the required
   approval;
6. macOS passes first, followed by defined Windows and Linux acceptance;
7. artifacts, checksums, SBOM, third-party notices, and exact source commit are
   available for the candidate;
8. fresh-user acceptance is recorded separately from CI and packaging proof.
