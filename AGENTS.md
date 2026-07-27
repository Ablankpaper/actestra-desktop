# Actestra Repository Instructions

These instructions apply to the entire repository.

## Product boundary

- Actestra is an independent product.
- Do not import code, configuration, credentials, user data, release state, or
  branding from Aera or any other local checkout.
- AionUi, Goose, and Eigent are upstream references with distinct roles. Do not
  combine their repositories into one source tree without an accepted
  architecture decision and recorded provenance.

## Before making changes

1. Read [docs/README.md](docs/README.md).
2. Read [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).
3. Read the relevant accepted decisions under
   [docs/architecture/decisions](docs/architecture/decisions/README.md).
4. Confirm the checkout, branch, remote, and working tree with `git status -sb`
   and `git remote -v`.
5. Preserve unrelated user changes.

## Source-of-truth rules

- Accepted ADRs define architectural decisions.
- `docs/architecture/SYSTEM_OVERVIEW.md` defines current system boundaries.
- `docs/product/MVP.md` defines product scope.
- `docs/roadmap/DEVELOPMENT_SEQUENCE.md` defines phase order and gates.
- `docs/PROJECT_STATUS.md` records verified progress, not intent.

If a change alters one of these truths, update the relevant document in the same
change.

## Development rules

- Build vertical slices behind stable interfaces.
- Keep the renderer free of runtime, credential, shell, and filesystem authority.
- Run external agents in isolated worker processes.
- Treat coding workspaces as isolated Git worktrees.
- Route tool use through a policy and approval boundary.
- Default to least privilege; never add a hidden or default YOLO mode.
- Store product state in Actestra-owned services, not an external worker's
  private session format.
- Avoid compatibility shims without an owner, removal condition, and tests.

## Upstream and licensing

- Pin every imported upstream to an exact commit.
- Record imports in
  [docs/governance/UPSTREAM_VERSIONS.md](docs/governance/UPSTREAM_VERSIONS.md).
- Preserve applicable LICENSE, NOTICE, copyright, and attribution text.
- Mark modified upstream files where the upstream license requires it.
- Update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) in the same change.
- Do not set or change the root project license without owner approval.

## Validation and status

- Run the narrowest relevant checks first, then the broader project checks.
- Report local validation, commit, push, CI, candidate, release, deployment, and
  acceptance as separate states.
- Do not call a phase complete until its exit gate has evidence.
- After a material change, update `docs/PROJECT_STATUS.md` with the exact result
  and remaining blocker.

## Git

Follow [docs/governance/GIT_WORKFLOW.md](docs/governance/GIT_WORKFLOW.md).
Never commit secrets, local credentials, generated packages, or unrelated
working-tree changes.
