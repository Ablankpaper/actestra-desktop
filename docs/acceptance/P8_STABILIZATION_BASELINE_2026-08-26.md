# P8 Stabilization Baseline — 2026-08-26

## Purpose

This record freezes the source and evidence boundary for stabilization work.
It does not claim that P8.2, P8.3, P8.4, a candidate, a release, or user
acceptance is complete.

| Field | Value |
| --- | --- |
| Repository | Ablankpaper/actestra-desktop |
| Baseline source SHA | b8d77c5c5101454e9c30b1484b4e2f64b88cc672 |
| Baseline source tree | e25988340c3f6c67e14f20c10b5c3c4108b69bc4 |
| Remote ref | origin/main at verification time |
| Baseline commit | docs: record P8.2 integration closure (#73) |
| PR | #73, merged 2026-08-25 17:24:24Z |
| PR exact head | 0b02d1af2c893778436a650a12ea1e839d3ccd0f |
| PR CI | Run 32873869921, 8/8 jobs successful |
| PR merge-ref commit | 5ff3d39187218a0c1b1f832c231f4195bbf7afce |
| PR merge-ref tree | e25988340c3f6c67e14f20c10b5c3c4108b69bc4 (equal to baseline tree) |
| Post-merge push-CI | None; no run exists for b8d77c5c because historical [skip ci] markers were retained |
| Stabilization worktree | /Users/zizimutou/actestra-worktrees/p8-stabilization |
| Stabilization branch | codex/release/p8-stabilization |
| Worktree created | 2026-08-26T01:28:56+08:00 |

The merge changed only docs/PROJECT_STATUS.md relative to the preceding
main commit 35c1820c5709e111c9e58a6ba456e8ee07e5c519. No runtime or frozen
foundation file changed in that merge. The retained CI artifacts are exact-tree
evidence for this baseline, but their CI event was a pull-request merge-ref
event rather than a push on the merged commit object. A future candidate,
signature, or release artifact must be rebuilt and bound to the baseline SHA.

## Preserved work and boundaries

- The primary checkout at /Users/zizimutou/Desktop/agent remains on
  e8074b73d894f3a7220dc239d510aed58bf06d65 with its existing untracked
  handoff. It is not the stabilization source of truth.
- Existing P4, P5, P7, P8, and product-fix worktrees are preserved. No WIP,
  generated dependency tree, local profile, database, or evidence directory
  is cleaned or overwritten by this baseline.
- foundation/aionui-v2.1.41 remains frozen. Any blocking UI fix must use a
  recorded downstream overlay or patch.
- Actestra remains independent from Aera and other local repositories.

## Stabilization freeze rules

Allowed on this branch:

- release-blocking correctness, security, data-integrity, recovery,
  cancellation, cleanup, packaging, or platform-boundary fixes;
- narrow tests and evidence updates required to prove such a fix;
- corrections to evidence or status documents that make current state more
  accurate.

Not allowed on this branch:

- new user-facing capability or design implementation;
- opportunistic UI redesign, upstream synchronization, or architecture
  replacement;
- broad refactoring without a P8 blocker;
- weakening a verifier to turn incomplete or unsupported evidence into a pass.

New feature design documents may continue in a separate design branch. They do
not enter this stabilization branch until P8.2, P8.3, P8.4, and the stable
baseline exit review are complete.

## Gate state at baseline

| Gate | State | Boundary |
| --- | --- | --- |
| P8.2 | Open; narrow slices are verified and product journeys remain incomplete | See P8.2 evidence ledger |
| P8.3 | Not started | Candidate integrity, provenance, signing/notarization, update trust, and rollback remain open |
| P8.4 | Not started | Clean-machine lifecycle, real Provider, runbook, issue intake, and internal acceptance remain open |
| Release and candidate | Not claimed | No candidate, release, deployment, distribution, or user-acceptance claim is made |

The companion ledger is P8.2_EVIDENCE_LEDGER_2026-08-26.md.
