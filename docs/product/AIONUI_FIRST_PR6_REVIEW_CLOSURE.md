# AionUi-first PR 6 Review Closure

Status: Review remediation is implemented at
`e343e83a7c22d8977bb2e9dd06169a69ed9826d5`, pushed on
`feat/aionui-first-foundation`, and passes exact-head
[CI run 30431363721](https://github.com/bignormal/actestra-desktop/actions/runs/30431363721).
Pull request 6 subsequently reached final head
`70b2f29329fec26bf0e3d6384d8563aedcb7a4ce`, squash merged as
`61b9405fc007aa8cb16ec05a65f421cb7d277b51`, and passed exact main CI run
30434563810. Candidate, release, distribution, and acceptance remain separate
gates.

Date: 2026-07-29

## Scope and preservation rule

This document first records the review performed while PR 6 was Draft against
`main`, with the immutable AionUi `v2.1.41` foundation excluded from downstream
edits but included in byte-level preservation verification. The subsequent
closure outcome is recorded separately below.

No AionUi route, sidebar entry, permission card, pet window, Guide workflow,
provider selector, workspace composer, settings surface, or renderer layout was
removed or redesigned. Remediation is confined to compatibility metadata,
main-process authority, persistence, packaging, installer support, generation
tools, tests, and documentation.

## Automated review coverage

The full committed review could not run as one operation because the PR has
1,772 files while the reviewer accepts at most 150. Of those, 1,771 are the
frozen foundation plus its provenance metadata and are separately protected by
the exact SHA-256 manifest gate.

The review was partitioned by owned change surface:

| Partition                               | Reviewed files | Major | Minor |
| --------------------------------------- | -------------: | ----: | ----: |
| Root application contracts and services |             14 |     7 |     4 |
| Downstream AionUi patches               |              5 |     9 |     0 |
| Repository scripts                      |              7 |     5 |     2 |
| Total                                   |             26 |    21 |     6 |

CodeRabbit raised 27 issues. Twenty were valid and remediated: 15 major and 5
minor. Seven were rejected after source and ADR verification: 6 major and 1
minor.

The reviewer initially rate-limited before the tests and documentation
partitions. After quota recovery, successive full uncommitted reviews covered
all 21 current changed files, including tests and documentation, and raised 8
additional valid issues: 3 major and 5 minor. All eight are remediated below.
The attempted zero-issue follow-up then returned a 30-minute rate limit, so this
closure does not claim a completed zero-issue review.

## Valid remediation

### Compatibility projection and persistence

- Empty or null native `failure_kind` no longer fabricates a failed runtime.
- Workspace metadata records the complete bounded response count instead of
  the 50-item projection cap.
- Explicit failed and cancelled turn-completion statuses remain terminal for
  both native `status` and `state` aliases.
- Optional source timestamps must already be normalized milliseconds at the
  projection boundary.
- Revision hashes use canonical key order and exclude capture time for every
  domain.
- Repeated unchanged revisions observed later are durably idempotent while the
  first capture timestamp remains intact.
- Evidence identifiers are checked against domain, native identity hash, and
  native revision hash; tuple conflicts are detected before SQLite insertion.
- Core graph, event, and timestamp validation errors are normalized to the
  declared `invalid-evidence` contract.

### Approval authority

- Unexpected validator failures return authority-unavailable `503`, not a
  renderer-caused `400`.
- Invalid durable records fail closed instead of rejecting the service promise.
- Every native transport call has a service-owned deadline in addition to the
  concrete loopback transport limit. The transport receives an abort signal,
  and an ignored cancellation retains an in-process delivery guard until the
  operation settles, preventing concurrent redelivery while the durable
  response remains pending.

### Downstream product and packaging boundaries

- The downstream runbook now makes frozen-foundation verification mandatory.
- Builder copyright retains both Actestra ownership and upstream AionUi
  attribution.
- Packaged applications disable CDP before consulting environment or persisted
  development settings.
- `ACTESTRA_CDP_PORT` takes precedence. The legacy `AIONUI_CDP_PORT` input is
  explicitly retained only for frozen upstream E2E and benchmark callers and
  has a documented removal condition plus policy tests.
- The Windows installer writer and desktop reader now use the same Actestra
  profile-v1 failure-marker path.
- The macOS unsigned-build hook removes extended attributes before ad-hoc
  signing, uses argumentized process execution, and propagates signing failure
  instead of logging false success.

### Generation and evidence tooling

- Generated-tree deletion is restricted to the repository-owned exact
  `.actestra/aionui-v2.1.41` path.
- Provenance, manifest, patch, source-copy, asset-copy, and destination paths
  must remain within their declared roots.
- The downstream checker independently validates the same containment rules.
- CDP capture supports the documented one-argument default endpoint, restricts
  discovery and WebSocket targets to loopback, bounds discovery, connection,
  and command time, rejects evaluation exceptions and malformed results, and
  closes resources on every exit path. Bracketed IPv6 loopback hostnames are
  normalized consistently for discovery and WebSocket validation.
- Downstream ordering checks begin after the complete anchor match so an
  overlapping anchor cannot produce false-positive evidence.

## Rejected candidates

| Candidate                                                     | Reason rejected                                                                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Silently clamp shadow-history limits                          | The persistence contract deliberately rejects caller misuse; clamping would hide a boundary error.                                                                      |
| Permit non-upstream `window.open` targets                     | The deny-all handler is intentional. External URLs use the separate bounded main-owned operation; allowing arbitrary targets would weaken the window boundary.          |
| Add a missing `Message` import                                | The materialized About modal already imports `Message`; the report was stale against generated output.                                                                  |
| Treat root source copies as absent downstream dependencies    | `overlay.json` declares all copies and the materializer creates them before patches; clean materialization, types, tests, and build prove the dependency path.          |
| Fall back to native approval after authority `503`            | ADR-0012 permits native fallback only for the explicit main-owned rollback switch. Automatic fallback would bypass persist-before-deliver authority.                    |
| Return an invented success payload for a handled confirmation | The preserved bridge contract returns `Promise<void>` and both retained call sites ignore a response body.                                                              |
| Require F2 markers in every legacy harness package            | That verifier also covers the deliberately retained P3 legacy harness. F2 markers are mandatory in the AionUi-first downstream build, not in the compatibility harness. |

## Local verification

| Gate                             | Result                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root focused remediation         | Pass: 4 files, 24 tests                                                                                                                                          |
| Root full check                  | Pass: formatting, lint, strict types, Electron SQLite, 31 files and 164 tests, process smoke, 40-source boundary, frozen and downstream checks, production build |
| Frozen AionUi preservation       | Pass: 1,766 files, 27 routes, 41 bridge domains                                                                                                                  |
| Downstream declaration           | Pass: 95 declared changes, 4 R0 invariants, 15 reviewed source copies                                                                                            |
| Downstream focused tests         | Pass: 9 files, 30 tests                                                                                                                                          |
| Downstream complete native suite | Pass: 330 files, 1 skipped; 2,606 tests, 5 skipped                                                                                                               |
| Downstream strict types          | Pass                                                                                                                                                             |
| Downstream production build      | Pass: 563 main, 7 preload, 10,163 renderer modules                                                                                                               |
| Real arm64 packaged launch       | Pass as local runtime proof: Actestra and bundled AionCore started from an isolated profile                                                                      |
| Packaged CDP denial              | Pass: `ACTESTRA_CDP_PORT=9231` still logged CDP disabled and no listener existed                                                                                 |
| Package identity and attribution | Pass: `com.bignormal.actestra`, `Actestra`, and upstream attribution present                                                                                     |
| Ad-hoc signing                   | Blocked locally: macOS retained `com.apple.provenance` after `xattr -cr`; the strict hook now fails the build instead of reporting success                       |

[Apple documents `xattr -cr <app>`](https://developer.apple.com/library/archive/qa/qa1940/_index.html)
as the remediation for disallowed bundle extended attributes. The current
local environment immediately restores its provenance attribute, so the
assembled and launchable app is local runtime evidence only, not signed package
or candidate evidence.

The temporary `~/.actestra-v1` CLI-safe symlink created by the packaged launch
was removed after graceful exit; its isolated profile target was retained under
`/tmp` for this review session.

## Subsequent closure outcome

1. A scoped local follow-up reviewed all 21 final owned changed files and
   completed with zero findings. This is review evidence for that owned change
   surface, not a completed single-pass review of the 1,774-file pull request.
2. Exact final-head CI run 30431557027 passed. The Ready-triggered GitHub
   CodeRabbit check skipped because 1,774 files exceeded its 150-file limit, so
   that status is not substituted for the completed scoped local review.
3. Pull request 6 squash merged as
   `61b9405fc007aa8cb16ec05a65f421cb7d277b51`, and exact main CI run
   30434563810 passed.
4. The macOS provenance/signing behavior still requires reproduction on a
   clean signing host before any signed-package or candidate claim.
