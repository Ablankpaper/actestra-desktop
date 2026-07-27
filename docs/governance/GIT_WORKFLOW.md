# Git Workflow

## Default branch

`main` is the integration branch and should remain reviewable and reproducible.

The initial empty-repository bootstrap may be pushed directly to create `main`.
After bootstrap, changes should use pull requests unless the repository owner
explicitly approves an exception.

## Branch names

Use a short lowercase slug:

| Change | Pattern | Example |
| --- | --- | --- |
| Feature | `feat/<slug>` | `feat/task-event-store` |
| Fix | `fix/<slug>` | `fix/worker-cancel-race` |
| Documentation | `docs/<slug>` | `docs/baseline-runbook` |
| Maintenance | `chore/<slug>` | `chore/pin-node-version` |
| Time-boxed experiment | `spike/<slug>` | `spike/goose-transport` |
| Upstream evaluation | `upstream/<project>-<version>` | `upstream/aionui-v2-1-41` |

Do not encode secrets, customer names, or personal data in branch names.

## Commits

Use Conventional Commits with one coherent purpose:

```text
feat: add worker lifecycle contract
fix: stop tools after task cancellation
docs: record aionui baseline evidence
chore: configure markdown checks
test: cover approval denial
refactor: isolate event translation
```

Rules:

- Stage only intended files.
- Do not commit generated packages, credentials, local profiles, or logs.
- Preserve meaningful upstream import boundaries.
- Include documentation and provenance changes with the code they describe.

## Pull requests

Each pull request must state:

- phase and gate served;
- behavior and boundary changed;
- validation commands and results;
- security and permission impact;
- migration and rollback impact;
- upstream and licensing impact;
- unverified or blocked items.

Prefer squash merge for normal feature work. Preserve separate commits only when
they provide necessary upstream provenance or migration history.

## Required checks

Checks will be added when the application toolchain exists. Until then:

- Markdown links must resolve within the repository.
- formatting and whitespace checks must pass;
- no secrets or ignored build output may be staged;
- the documentation index and project status must remain current.

Run the bootstrap documentation checks from the repository root:

```bash
npx --yes markdownlint-cli2@0.20.0 "**/*.md" "#node_modules"
node scripts/check-doc-links.mjs
git diff --check
```

Application changes later require, at minimum:

- format and lint;
- type checking;
- unit tests;
- integration tests for changed boundaries;
- desktop build;
- targeted package or smoke proof when packaging changes.

## Tags and releases

- Use Semantic Versioning after the first versioned candidate.
- Pre-release tags use `vMAJOR.MINOR.PATCH-alpha.N`,
  `vMAJOR.MINOR.PATCH-beta.N`, or `vMAJOR.MINOR.PATCH-rc.N`.
- A tag is not a release unless artifacts and evidence are published.
- A release is not user acceptance.

See [Release Evidence](RELEASE_EVIDENCE.md).

## Upstream updates

Evaluate upstream changes on a dedicated branch. Record:

- upstream repository;
- tag and exact commit;
- previous revision;
- imported paths or package versions;
- local patches;
- license or NOTICE changes;
- build, test, migration, and packaging evidence.

Follow [Upstream Policy](UPSTREAM_POLICY.md).
