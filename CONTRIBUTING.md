# Contributing to Actestra

Actestra is currently a private, early-stage project. Changes should be small,
traceable, and tied to the active phase gate.

## Workflow

1. Read the [documentation index](docs/README.md) and
   [project status](docs/PROJECT_STATUS.md).
2. Create a focused branch using the conventions in
   [Git Workflow](docs/governance/GIT_WORKFLOW.md).
3. Make one coherent change.
4. Update architecture, roadmap, status, or provenance documents when the source
   of truth changes.
5. Run relevant checks and record the commands and results in the pull request.
6. Open a pull request and complete the repository checklist.

## Commit messages

Use Conventional Commits:

```text
feat: add task event stream
fix: isolate worker cancellation
docs: define upstream baseline gate
chore: initialize repository tooling
test: cover approval timeout
refactor: separate adapter lifecycle
```

## Pull requests

A pull request should explain:

- what changed and why;
- which phase or gate it serves;
- user, security, migration, and licensing impact;
- commands used to validate the change;
- what remains unverified.

Do not merge a change that silently broadens filesystem, shell, network,
credential, publishing, or messaging authority.

## Licensing

Do not copy source, assets, icons, prompts, skills, model files, or bundled tools
from an upstream project until its license and provenance have been recorded.
See [Upstream Policy](docs/governance/UPSTREAM_POLICY.md).
