# P8 Stabilization Baseline — 2026-08-26

## Purpose

This record freezes the source and evidence boundary for stabilization work.
It does not claim that P8.2, P8.3, P8.4, a candidate, a release, or user
acceptance is complete.

| Field | Value |
| --- | --- |
| Repository | Ablankpaper/actestra-desktop |
| Baseline source SHA | 6f2a64d2eb4e159459005ce80eda71a14c754ad6 |
| Baseline source tree | 95b68da2a0730a243cab5ed919dd4468ac760849 |
| Remote ref | origin/main at verification time |
| Baseline commit | docs: establish p8 stabilization baseline |
| PR | #74, merged 2026-08-25 18:13:06Z |
| PR exact head | 1c35fdf245af600623078e3a998fd3c77747197e |
| PR CI | Run 32879077165, 8/8 jobs successful |
| Post-merge push-CI | Run 32882463581, 8/8 jobs successful, exact head `6f2a64d2` |
| Stabilization worktree | /Users/zizimutou/actestra-worktrees/p8-stabilization-current |
| Stabilization branch | codex/release/p8-stabilization-current |
| Worktree created | 2026-08-26 (exact `origin/main` checkout) |

The merge changed only the stabilization documentation relative to the
preceding main commit `b8d77c5c5101454e9c30b1484b4e2f64b88cc672`; no runtime or
frozen foundation file changed. The exact-head push-CI run is direct evidence for
this baseline's declared CI jobs and current fresh-profile/runtime slices. It is
not, by itself, P8.2 product-journey closure, P8.3 candidate trust, or P8.4
clean-machine acceptance. Any candidate, signature, or release artifact must
remain bound to this exact baseline SHA.

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
