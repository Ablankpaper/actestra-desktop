# Development Sequence

This roadmap defines order and phase gates. It is not a claim that planned
features are implemented.

## Principles

- Prove the unmodified foundation before refactoring it.
- Preserve AionUi functions and functional UI by default; swap providers behind
  compatibility seams instead of redrawing or deleting workflows.
- Establish one product source of truth before adding external workers.
- Integrate one vertical slice at a time.
- Add orchestration only after individual workers have stable lifecycle and
  event contracts.
- Treat security, packaging, and acceptance as engineering deliverables.
- Keep local validation, push, CI, candidate, release, and acceptance distinct.

## Phase summary

| Phase | Outcome                                                  | Entry dependency  |
| ----- | -------------------------------------------------------- | ----------------- |
| P0    | Project foundation                                       | New repository    |
| P1    | Reproducible AionUi baseline                             | P0                |
| P2    | Independent Actestra product shell                       | P1                |
| P3    | Actestra platform core and contracts                     | P2                |
| P4    | Native AionUi preservation and Actestra authority fusion | P3                |
| P5    | Goose coding-worker vertical slice                       | P3, P4 event path |
| P6    | Multi-agent team orchestration                           | P4, P5            |
| P7    | Security and reliability hardening                       | P4-P6             |
| P8    | Cross-platform internal beta                             | P7                |

Current execution state on 2026-08-04: native-fusion slices F0 through F3.3,
general-work through GW-P4.6, and the representative workspace-file, bounded
local-research, writing, Office-document, and schedule extensions are accepted
on `main`. Office reached exact final PR head
`091f786d57c6b4569cdaac17ea969a0b9070ea02`, passed PR CI run 30602624426,
squash merged as `505afb2f3916e75c7abb07cdf461bda29a602b9b`, and passed
exact merged-main CI run 30602821085. Its 50-file/338-test root gate,
343-file/2,644-test native gate, final production build, Apple
Development-signed unnotarized local arm64 package, and schema-12 target-app
Office/file/research/writing/denial/cancellation smoke remain separate local
evidence. The Ready PR's Free-plan CodeRabbit output contains only a summary
and walkthrough, with no submitted review or inline comment, so it is not
represented as line-level review evidence.

ADR-0023's independent schedule slice is implemented and pushed from exact
verified main `505afb2f3916e75c7abb07cdf461bda29a602b9b`. It retains the
native `/scheduled` routes, dialog, detail/history, status, CRUD, pause,
run-now, and event surfaces while moving bounded existing-conversation jobs,
schema-13 grants and claims, timing, missed/interrupted recovery, and General
Work execution into Actestra main/Core. The pre-review 56-file/414-test root
gate, 345-file/2,658-test native gate, production build, Apple Development-
signed unnotarized arm64 package, and actual schema-13 target-app smoke are
diagnostic baseline evidence only; review remediation changed production bytes.
The third 50-file CodeRabbit confirmation raised four issues (three Major, one
Minor): the two valid documentation corrections are applied, while the empty
manual cron and explicit unsupported Skill suggestions are rejected by
ADR-0023. The fourth confirmation raised three issues (one Major, two Minor):
the valid protocol negative test and status correction are applied; the request
for a pre-existing Actestra workspace registry or Git worktree allowlist is
rejected because ADR-0020 makes validated native selection the initial
authority, ADR-0023 captures it atomically as a canonical grant, and coding
worktrees remain P5. Two follow-up confirmations were then rate-limited before
analysis (first with a 3-minute wait, then 31 seconds), so they are not
zero-issue evidence; the final manual 51-file review includes the later
Node-free schedule contract split and found no additional confirmed defect.
Final-byte validation now passes 56 root files/424 tests, 345 native files/2,658
tests, strict native TypeScript, the 607/24/10,184-module native production
build, a newly built Apple Development-signed unnotarized arm64 package, exact
package/ASAR/resource checks, and actual schema-13 target-app smoke. Ready PR 20
reached initial head `70b11992f4de015e0952d482a126cd1270208aa8`; CI run
30657973409 exposed that CI packaged the legacy root output rather than the
target native app. Focused workflow TDD produced exact final head
`c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`; PR CI 30659567604 passes the full
native package and clean-profile smoke path. PR 20 squash merged as
`5b0748af674165f9e9475be61dc1e02a1b08c8bc`, and exact merged-main CI
30660078199 passes. Its remote CodeRabbit output is a rate-limited summary, not
line-level review evidence. Representative tool failure is accepted through
exact final head `077f30bcfa3929959c971d08081092bbf976e2ee`, PR CI 30673687603,
squash merge `c7c414c0c5a126b276fb02b372e02fff437e5f23`, and merged-main CI 30673919260. Its CodeRabbit status is a rate-limited Free walkthrough rather
than formal line-level review. Worker-crash/recovery is accepted through exact
implementation `47ed445eab204c0998e44167455c062600158dd3`, final PR head
`3593fac8db48a0cb149bb6c736374eeaccebe332`, PR CI 30687199671, squash merge
`80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`, and merged-main CI 30687433298.
Its completed local gates, packaged target-app evidence, manual review, and
exact scope audits close the P4 exit gate. P5.0 is accepted through PR 26,
exact head `e622f36e697b4e0be1037175267452e24cc180e3`, squash merge
`b61dd3ea44a4c522ca0c15a84a01d8f76b335e4c`, and merged-main CI 30691300690. ADR-0024 selects Goose `v1.45.0` at exact commit
`4dc0420f5704a92806c6628c8f0a3497d7a88759`, stdio ACP, and the
Actestra-built minimal runner. P5.1 is accepted through PR 28, exact hotfix head
`eed1623e9849b9f662f3dec690d02d7c85a693ef`, squash merge
`d313fb2ed65e4b010f777435953752818fbbfae4`, and merged-main CI 30700441312.
It admits the exact runner, applies ADR-0025's sole RSA metadata-only
disposition, and proves strict initialize and deny-network cleanup without
session or repository effects. P5.2 is accepted through PR 43; its closed
worktree and six-capability foundation reached pull request 31 at exact final
head `c10110b38e8714b831a6d6d0fc09aa8df4218b7c`, passed exact-head CI
30808650150, squash merged as
`266e3857bed7d4c32b773f92deff676bf2144b15`, and passed exact merged-main CI 30809931486. CodeRabbit was rate-limited before line-level review; its successful
status and Free walkthrough are not review evidence.

The desktop-main composition reached exact final head
`5c4dade91d279e6a6f7d4c2daad1ebe972e47b98`, passed exact-head CI
30817462671, squash merged as
`f55b5550c6ac189f09536061a70e8c8c7299c4f4`, and passed exact merged-main CI 30818949121. Its exact-head CodeRabbit re-review covered 12 changed files and
reported 0 issues. The composition creates a main-owned lifecycle service,
persists the exact active grant before exposing the Tool Gateway, tracks opening
and cleanup races, and closes coding authority before persistence shutdown. The
combined focused set passes 5 files and 49 tests. The downstream contract passes
184 declared files, 4 R0 invariants, and 63 reviewed source copies; a clean
3,177-package materialization passes strict TypeScript and its generated native
composition test. The root gate components pass 65 files/498 tests with 1 file
and 1 test skipped, the 85-source boundary, frozen/downstream contracts, and the
58/3/28-module production build. No renderer surface changes.

The ACP session lifecycle slice adds one-process/one-session ACP `session/new`
with exact request-ID correlation, one loopback MCP declaration and opaque
attempt lease, bounded Goose setup notifications and frames, normalized session
identity, and transport plus private-root cleanup on rejection, timeout, error,
or exit. Its combined P5.2 focused gate passes 7 files and 85 tests; the complete
root gate passes 65 files and 523 tests with 1 file and 1 test skipped. Pull
request 33 reached exact final head
`5d873f2feb94679341627aab0472a66630cf16cd`, passed exact-head CI 30823601815,
squash merged as `c5f498e926adac484694dab6d2f05b9822cc0b12`, and passed exact
merged-main CI 30825221070. CodeRabbit supplied only a Free-plan summary and
walkthrough, with no submitted review or inline review thread. This remains
fixture-backed protocol/lifecycle evidence, not a real Goose coding session.
Pull request 34 changed only the four P5 source-of-truth documents, passed
exact-head CI 30827073008, squash merged as
`776d1e1c10d13f036a3318f7d3c193a7819443a2`, and passed exact merged-main CI 30828549443.

The random-port `127.0.0.1` MCP transport carries the opaque
attempt lease, strict pinned Goose/MCP headers and initialization order, bounded
non-chunked JSON, no stateful session, and only the six closed coding schemas.
It reached pull request 35 at exact head
`93a8e9633f2be7b5f8c8b1eead3f2a21b0770073`, passed exact-head CI
30832907098, squash merged as `8a31bafc1cd322744189fc4ed1e68f769225c999`,
and passed exact merged-main CI 30834217310. The session-composition slice
started from that exact merge. Pull request 36 old head
`9e277e1593b2715ed3721e1febb886985a942824` passed its macOS job but failed
Goose runner admission in exact-head CI 30837296114 at `session/new`; that SHA
was not rerun. The correction uses separate main-generated MCP/model leases,
starts an authenticated non-inference model catalog and MCP on separate random
loopback ports, admits only those ports through the Worker sandbox, and supplies
the closed provider/model environment required by pinned Goose. After
`session/new`, one explicit `_goose/unstable/tools/list` request triggers the
real authenticated MCP `tools/list`; the composition requires all six coding
tool identifiers before returning. The corrected focused input passes 4 files
and 51 tests, and the admitted-artifact real integration passes 1 file/1 test.
Worker-first MCP/model all-settled cleanup is idempotent. The corrected complete
root gate passes 68 files and 582 tests with 1 file and 1 test skipped, the
88-source boundary, frozen/downstream contracts, and production build. Corrected
final head `5fe78bfaf2982556af975d23bc904d10b77a1f29` passed exact-head CI
30843561874, squash merged as `08e6fefcd87721fbe4f21eee73f9ba6c52a638c0`,
and passed exact merged-main CI 30845006202.

The authenticated `tools/call` slice starts from that exact merge. It
admits only after authenticated discovery; binds the exact ACP session,
worktree, unique bounded Worker correlation, closed tool, and versioned input;
and routes through a caller-supplied main invoker. That invoker creates the
Actestra request and input references, persists the exact active-grant owner,
uses the existing policy/approval/audit/executor path, and resolves only matching
durable output. Replay, post-close calls, invalid results, and private failures
fail closed; shutdown stops admission and cancels and awaits in-flight calls.
Closure is rechecked after body intake and before the deferred invoker, so a
close-winning race cannot enter main authority. The affected focused fingerprint
passes 3 files and 65 tests, and the dedicated
Goose runner job now includes the real Gateway bridge test. Its single final
root gate passes formatting and zero-warning lint, 68 test files and 589 tests
with 1 file and 1 test skipped, the 89-source boundary, frozen/downstream
contracts, and the production build. A 12-file committed CodeRabbit review
raised six findings: the close race and fixed `/tmp` fixture were confirmed and
fixed, while four suggestions were rejected because the Gateway union is closed,
invalid tools already fail the parser, the CST date is correct, and 128 calls is
the intentional containment ceiling. Pull request 37 reached exact head
`84b0550495717343b75ca2540cb7c191ab65b12a`, passed exact-head CI
30851778390, squash merged as `d933546454e63a2d836e728f1b93980cb4a7c0ac`,
and passed exact merged-main CI 30853499159. CodeRabbit stopped at its review
limit; GitHub has no submitted review or inline review thread.

The authenticated inference/prompt slice starts from that exact merge. It
upgrades the authenticated model catalog to a session-bound, bounded
OpenAI-compatible model proxy, keeps the model invoker in Electron main, and
admits one strict ACP text prompt after exact tool discovery. Goose private
session naming is disabled so Actestra Core retains naming authority. Four
affected files and 55 tests pass, and one admitted-artifact integration proves
exactly two model requests, one authenticated MCP file-read call, the tool result
in the second request, final assistant text and usage, and complete cleanup. The
single final-byte root gate passes 68 test files and 593 tests with 1 file and 1
test skipped, the 89-source boundary, frozen/downstream contracts, and the
production build. Pull request 38 reached exact head
`cc773081ba448266951a3b2ac3654831022118fc`, passed exact-head CI 30859115162,
and squash merged as `a6280dd38eacdbada9db159c4784110ec8e42770`. Its single
automatic merged-main CI 30860137257 passed the macOS foundation job but failed
the Goose job when one real-Git desktop-main integration test took 5.260 seconds
under parallel runner load and crossed Vitest's implicit five-second unit-test
deadline; the other 123 Goose tests passed. The correction gives only that
integration test an explicit bounded deadline. Pull request 39 reached exact
head `38cbbaaedbb8e5955b96a6d7148841180e751e35`, passed exact-head CI
30861770178, squash merged as
`7e8732e264febff42fb3d451011b3b8e48caaff5`, and passed exact merged-main CI 30862710547. The desktop-main lifecycle starts from that merge. It
creates the exact worktree/grant/Gateway before opening Goose, injects the
main-owned tool invoker, waits for Goose openings during shutdown, rejects a
close-winning open race, and always attempts Goose cleanup before grant
revocation and worktree removal. Its affected local evidence passes 3 files and
22 tests, ACP normalization 31 tests, root and native TypeScript, the 192-file/
71-source-copy downstream contract, and the generated native test. Its single
final-byte root gate passes 68 test files and 597 tests with 1 file and 1 test
skipped, the 89-source boundary, frozen/downstream contracts, and the production
build. Pull request 40 reached exact head
`c35f8c37c14dedaa980dfbb539f16fc21379be8a`, passed exact-head CI
30865837496, squash merged as
`1909033977576d94f6983f9c911b8e0a866a59de`, and passed exact merged-main CI 30866691199. The approval-outcome slice starts from that merge. It keeps the
default `approval-required` result fail closed, accepts only an explicit
main-owned approved or denied decision plus Actestra actor, persists that
terminal resolution first, executes an approval only through the same operation
and one-shot approval ID, and projects denial without execution. Abort and any
approval snapshot drift fail closed. The current focused file passes 18 tests
with 2 real-Goose tests skipped locally because the admitted artifact environment
is absent; the existing Goose CI gate selects both. The single final-production/
test-byte root gate passes 68 test files and 601 tests with 1 file and 3 tests
skipped, the 89-source boundary, frozen/downstream contracts, strict types,
smoke, and the production build; materialized-native TypeScript and its generated
composition test also pass. Pull request 41 delivered those approval outcomes at
exact head `917a95260d84f09aacf5038d92a5230d1781676d`, exact-head CI
30870425378, squash merge `7dfc4973021d68d5df0ded12fa218ecd42da9691`,
and passing merged-main CI 30871703449.

The durable normalized-evidence slice starts from that exact merge. It derives
only Actestra-owned stream/correlation identity, persists `task.started` before
Goose opens, normalizes bounded assistant/tool/approval/failure/cancellation
events, reconciles Task/Session/Worker/Approval projections, and leaves a
successful prompt blocked with its isolated worktree retained for review. Close
persists cancellation before Worker/grant/worktree release, and pending
approvals become cancelled before any terminal Task event. Sanitized opening and
prompt failures, cancelled prompts, approval-handler failure, and committed-
response-loss retries are covered without a second Goose or tool invocation.
General Work and coding graph writes share one mutation barrier. The affected
local gate passes 2 files with 44 tests passed and 2 artifact-gated skipped,
strict TypeScript, and affected zero-warning lint. The overlay passes with 194
declared files, 4 R0 invariants, and 73 source copies without a renderer or
schema change. The installed materialized-native tree passes strict TypeScript
and its generated 1-file/1-test composition proof. The final-byte root gate
passes formatting over 206 files, zero-warning lint over 198 files, strict
TypeScript, the Electron SQLite probe, 68 passing and 1 skipped test files with
613 passing and 3 skipped tests, deterministic smoke, the 91-source product
boundary, frozen/downstream contracts, and the
59-main/3-preload/28-renderer-module production build. Pull request 42 delivered
that evidence at exact head `a20882abeb6caac3b4f230fde42a7e06965a0730`,
exact-head CI 30876755457, squash merge
`e064dc88e717cef093c866cdbc2692d23ed7dd03`, and passing merged-main CI 30877711241.

The publish/Artifact slice starts from that exact merge. A main-only
seventh Tool Gateway capability captures a locked, at-most-1-MiB binary patch
across tracked, staged, unstaged, and bounded untracked paths without changing
the real Git index. It remains outside Goose's six MCP tools. The one-shot
approval handler receives only base commit, byte length, and SHA-256. Approved
execution re-captures and rejects drift before durable output, event, Artifact,
Task, Session, and Worker projection writes; cleanup then closes Goose, grant,
and worktree in order. Denial and drift retain blocked review and the source
checkout remains unchanged.

Its final production fingerprint passes 5 focused files with 123 tests
passed and 2 admitted-artifact tests skipped. Its single complete root gate
passes 68 test files and 618 tests with 1 file and 3 tests skipped, the
93-source boundary, exact foundation, 196-file/75-source-copy downstream
contract, strict types, smoke, and the 59/3/28-module production build.

Pull request 43 delivered that boundary at exact head
`305a29d9b2b514865983ae9d8a23f877566bb7a5`, exact-head CI 30883055147,
squash merge `9048fe2cc23819f596d8721adb8c544dcd0b786f`, and exact
merged-main CI 30884138218. Both CI layers passed Goose runner admission and
macOS arm64 foundation. CodeRabbit was rate-limited before review and left no
submitted review or inline comment. P5.2 is accepted on that evidence.

P5.3 was developed on branch `codex/p5-aionui-coding-journey` from exact
`9048fe2cc23819f596d8721adb8c544dcd0b786f`. R1 downstream patch 0013 keeps
AionUI as the only product UI while adding one fixed main-owned Goose readiness
provider, retained Agent Settings/Repair states, five closed main-frame coding
intents, a context-isolated preload provider, a non-Team ACP selector, and
native message, permission, terminal, diff, test, review, cancellation, and
Artifact projections. Native ACP and Team paths remain unchanged, and coding
attachments fail explicitly.

The P5.3 affected root set passes 7 files and 26 tests; its artifact-gated file
passes 2 journeys against real admitted Goose. One pauses for main-owned file-
write and registered focused-test approvals, projects the final assistant
result, then requires the exact main-captured patch approval before producing
an available Artifact. The other cancels a real in-flight prompt. Both remove
private Worker state, active grant, and the isolated worktree while keeping the
source checkout clean and unchanged. The downstream contract passes
217/4/80 declared/R0/source-copy checks, while materialized native TypeScript
and 3 files/8 tests pass. On the unchanged final production/test fingerprint,
one complete root gate passes 74/2 test files, 642/5 tests, the 98-source
boundary, exact 1,766-file/27-route/41-bridge foundation, the 217/4/80
downstream contract, and the 61/3/28 build. Pull request 44 reached exact head
`15a8e29b44a6684313f29a694f0d0615de95cf36`, passed exact-head CI
30899489690, squash merged as `ee8425e39e201078cd64fe3af38355279ecf56de`,
and passed exact merged-main CI 30900884248. P5.3 is accepted on that evidence.

P6 is now the ordered phase. Its first slice started from that exact merge on
branch `codex/p6-team-plan-admission`. Actestra Core closes and validates a
versioned 3-5-node plan-candidate protocol, fixed depth/concurrency/attempt
budgets, declared General/coding capabilities, classified context references,
human feedback, and at least one parallel branch. It maps admitted candidates
to deterministic Actestra plan, node, and Task identities. Desktop main owns a
cancellable planner port that sends only the normalized, deeply frozen request,
sanitizes planner failures, and returns only Core-admitted plans. Two focused
files pass 30 tests. The single production/test-fingerprint root gate passes
76/2 test files, 672/5 tests, the 100-source product boundary, exact foundation,
the then-current 217/4/80 downstream contract, and the 62/3/28 build.

Initial PR 45 head `59cf48fbbb45d78c803ab6691547b61878fc8eb3` used the sole
exact-head run 30905371865. Root source/tests passed, but materialized TypeScript
failed because the Core barrel export lacked a matching source-copy declaration;
the still-running Goose job was cancelled after that failure. The focused
overlay correction reached exact head
`a3d08a934160c1a5d61ff987ade29212bd3c0b05`, passed exact-head CI
30906689796, squash merged as
`30742934adde1e0944c4e8ced1f005452a1f3568`, and passed exact merged-main CI 30907869824.

The next slice starts from that exact merge on branch
`codex/p6-team-plan-persistence`. Schema 14 persists the canonical admitted
graph behind the supervised utility before desktop main returns it. Core
revalidates reloaded records; plan and correlation/version identities are
unique; canonical JSON digests expose disk drift; identical retries are
idempotent; conflicting identities and substituted utility responses fail
closed. No CrewAI/Python runtime, scheduler, state-machine execution, Worker
launch, bridge, renderer, Team UI, or P6 phase acceptance is claimed.

## P0 — Project Foundation

### Deliverables

- Repository, documentation index, product scope, architecture decisions, Git
  workflow, and upstream policy.
- Explicit separation from Aera and other local products.
- Evidence-based project status.

### Exit gate

- Bootstrap files are reviewed, committed, and available on the remote default
  branch.

## P1 — Reproducible Upstream Baseline

### Deliverables

- Pin one exact AionUi tag and commit.
- Build and run the unmodified source on macOS.
- Run the upstream test suites.
- Produce an unsigned local desktop package.
- Inventory licenses, NOTICE files, assets, bundled runtimes, telemetry, update
  endpoints, configuration stores, and external services.
- Create a module map: keep, wrap, replace, remove, or defer.
- Record all commands and required tool versions.

### Exit gate

- A second clean checkout repeats install, launch, tests, and package generation.
- Evidence and upstream revision are recorded in the repository.
- No Actestra feature work is mixed into the baseline proof.

## P2 — Independent Actestra Product Shell

### Deliverables

- Replace external branding, identifiers, icons, deep links, update endpoints,
  telemetry endpoints, and default service names.
- Establish Actestra-owned application directories and migration versioning.
- Disable unsafe automatic approval behavior.
- Separate renderer, main process, privileged services, and worker processes.
- Add a first-run flow that works without Aera or upstream accounts.

### Exit gate

- A clean profile launches as Actestra with no upstream or Aera brand, account,
  endpoint, data-path, or update dependency except documented third-party
  components.
- Packaging and smoke tests remain green.

## P3 — Platform Core and Contracts

### Deliverables

- Define task, session, workspace, worker, approval, event, and artifact models.
- Implement the `AgentAdapter` lifecycle: capabilities, start, send, approve,
  typed tool resolution, cancel, subscribe, and dispose.
- Implement a versioned unified event envelope.
- Establish Actestra-owned persistence and migrations.
- Establish credential broker, policy engine, approval service, MCP/tool gateway,
  and audit trail.
- Add worker heartbeat, timeout, crash, restart, and cancellation semantics.

### Exit gate

- A deterministic fake worker passes lifecycle, event ordering, approval,
  cancellation, crash recovery, and migration tests.
- Renderer tests prove privileged operations cannot bypass the main-process
  boundary.

## P4 — Native AionUi Preservation and Actestra Fusion

The `F` labels below are the native-fusion track already used by F0 through
F3.3. The `GW-P4.n` labels are the separate ordered general-work execution
track. The `GW` prefix is mandatory in cross-track status text so, for example,
GW-P4.3 General Worker cannot be confused with the historical F3.1 authority
slice previously described as P4.3/F3.1.

### Deliverables

- **F0 — native baseline:** freeze the exact AionUi source, preserve all
  routes and bridge domains, run the native test/build/launch path, record
  golden screenshots, and establish the R0/R1/R2 retention matrix.
- **F1 — identity and isolation:** apply Actestra identity and versioned
  profiles without changing the AionUi layout or removing feature entries;
  isolate upstream account, telemetry, update, feedback, catalog, and other
  unowned external effects while retaining their UI states.
- **F2 — compatibility projection:** map native conversation, task, provider,
  workspace, approval, artifact, and runtime shapes to read-only or
  metadata-only P3 shadow projections. ADR-0011 keeps those projections inert,
  main-owned, fail-isolated, and separate from authoritative P3 tables.
- **F3 — narrow native authority:** move one functional domain at a time to
  Actestra persistence, policy, approval, audit, artifact, and worker authority
  while keeping AionUi bridge and UI semantics.
  - **F3.1 — approval response and delivery:** reserve the immutable desktop
    confirmation response before native delivery, reconcile uncertain attempts
    on retry and restart, retain structured native errors, and provide an
    explicit native rollback. Pending-request creation, provider semantics,
    policy and approval for the underlying protected operation, and that
    operation's execution remain future slices.
  - **F3.2 — approval delivery policy and audit:** represent only delivery of
    the persisted response as one fixed loopback `network.request`; validate an
    exact capability manifest, evaluate one exact policy rule, and persist
    policy, start, and outcome audit before acknowledging delivery. Do not
    infer or authorize the underlying native tool, and retain an explicit F3.1
    rollback.
  - **F3.3 — approval reconciliation policy and audit:** gate only the bounded
    loopback pending-state read used after an ambiguous attempt and during
    restart. Reduce the native list to an in-memory boolean before the gateway
    consumes it; persist only metadata policy/start/outcome audit, keep native
    request creation and content authoritative in AionCore, and retain an
    explicit rollback of the read to F3.1 while retaining F3.2 delivery.
- **GW-P4.2 — general-work persistence foundation:** move schemas 1 through 5 and
  all P3/F2/F3 persistence operations behind a dedicated utility process; add
  schema version 6 workspace grants and immutable, bounded UTF-8 content
  references; prove that SQLite is unreachable from Electron main. Preserve
  the complete AionUi application and expose an explicit compatibility
  unavailable state if the utility cannot start.
- **GW-P4.3 — General Worker and Adapter v2:** launch one deterministic real worker
  process, negotiate its exact protocol and capabilities, add typed tool-result
  resolution, and prove timeout, malformed-message, stale-attempt, crash,
  cancellation, and cleanup behavior.
- **GW-P4.4 — scoped native tools and policy:** admit only bounded workspace
  text-read and create-only task-output write capabilities through trusted
  manifests, workspace grants, deny-by-default policy, and durable audit.
- **GW-P4.5 — coordination and recovery:** connect task/attempt state, worker
  supervision, tools, normalized events, content, artifacts, cancellation,
  terminal evidence, and restart recovery without orphan processes or silent
  success.
- **GW-P4.6 — preserved-AionUi journey:** map the completed general-work flow into
  original AionUi conversation, workspace, permission, preview, artifact, and
  status surfaces through bounded intents and projections; extend target-app
  packaged smoke through restart, denial, and cancellation. The first vertical
  slice uses one explicit bounded text intent, schema-version-8 atomic
  journey/grant/content registration, a real supervised General Worker,
  redacted status and Artifact projections, non-persisted native Preview, and
  prepared-task startup recovery. The representative-file extension adds one
  closed `/actestra file` intent, schema-version-9 kind persistence, a fixed
  main-owned `actestra-input.txt` read bounded to the Worker's 64 KiB transport,
  private same-Worker processing, stable oversized-input failure, and one
  create-only Artifact. The local-research extension adds one closed
  `/actestra research` intent, schema-version-10 kind persistence, the fixed
  main-owned `actestra-research.txt` source, private deterministic
  same-Worker evidence processing, and one create-only `research.md` file
  Artifact. The writing extension adds one closed `/actestra write` intent,
  schema-version-11 kind persistence, prompt-only registration, private
  Worker-authored `draft.md` content persisted by main before create-only
  output, and one `document` Artifact. The Office extension adds one closed
  `/actestra office` intent, schema-version-12 kind and Preview-media
  persistence, a private Worker-authored document model persisted by main, one
  exact create-only Office tool that generates fixed `brief.docx`, and an
  owned `document` Artifact rendered through the retained Word Preview without
  exposing paths or package bytes. These extensions add no generic local or
  network research, renderer-selected paths, or another UI. Office has exact
  merged-main evidence. ADR-0023 retains the native cron surface while
  adding schema-13 Actestra schedule authority, main-owned timers and atomic
  claims, skipped missed runs, interrupted-run recovery, and bounded
  existing-conversation General Work execution. Its pre-review local
  implementation and target-app smoke passed; the first formal 50-file review
  raised 12 issues and the valid concerns now pass focused remediation tests,
  lint, and strict TypeScript. Complete final-byte root/native gates, package,
  package audits, target-app smoke, and manual review closure now pass locally.
  Ready PR 20's initial CI exposed a wrong-package path; the focused remediation
  reached final head `c06ca5b4bd842fbad098ffc3b9e7bcef1aadbceb`, passed PR CI
  30659567604, squash merged as `5b0748af674165f9e9475be61dc1e02a1b08c8bc`,
  and passed merged-main CI 30660078199. The representative tool-failure slice
  has RED-to-GREEN, 56/425 root, 345/2,662 native, production-build, complete
  15-file manual-review, pinned signed-unnotarized arm64 package, strict
  resource/signature, and real schema-13 target-app first-run plus restart
  evidence. Exact implementation commit
  `fd5524c7f0485923b2aa765df95b5ef0b14187e7` reached Ready pull request 22 at
  exact final head `077f30bcfa3929959c971d08081092bbf976e2ee`, passed PR CI
  30673687603, squash merged as
  `c7c414c0c5a126b276fb02b372e02fff437e5f23`, and passed merged-main CI 30673919260. The separate Worker-crash/recovery implementation now has
  focused local contracts for failed Task/Session, crashed Worker/Attempt,
  canonical event order, fail-closed missing evidence, and no-relaunch restart.
  Its complete final-byte gates, packaged target-app smoke, 14-file manual
  review, and exact scope audits pass. Exact final head
  `3593fac8db48a0cb149bb6c736374eeaccebe332` passed PR CI 30687199671, squash
  merged as `80e84a28cb6e4e08eb73ec83193908ab3aa69cbe`, and passed merged-main CI 30687433298. The P4 phase exit gate is accepted.
- Support scoped workspace reads and task-output writes through the preserved
  file, workspace, conversation, preview, and artifact surfaces.
- Add representative file, research, writing, office-document, schedule,
  denial, cancellation, crash, and conflict fixtures.

### Exit gate

- The native AionUi retention contract passes with no unexplained missing route,
  bridge domain, functional entry, or user-visible behavior.
- A clean profile launches with Actestra identity and no unapproved upstream
  account, endpoint, telemetry, updater, or public listener effect.
- The general-work core journey completes end to end after restart with
  Actestra declared as the system of record for every fused domain.
- Permission denial, cancellation, tool failure, Worker crash/recovery, and
  artifact conflict paths are covered.

## P5 — Goose Coding-Worker Vertical Slice

### Deliverables

- Pin an exact Goose revision and compatible published interface. ADR-0024
  selects `v1.45.0` at
  `4dc0420f5704a92806c6628c8f0a3497d7a88759`, ACP `1.0.1` with schema
  `1.1.0`, and `v1.44.0` as the lowest rollback comparison.
- Build an Actestra-owned minimal Goose core runner with default features
  disabled, no upstream CLI, no builtins, no scheduler, auditable dependency
  metadata, SBOM, exact artifact manifest, and an accepted RustSec result.
- Launch Goose outside the renderer through a dedicated adapter.
- Register Goose through the preserved AionUi agent settings, selector, repair,
  ACP conversation, permission, terminal, diff, and test experience; do not add
  a separate Goose application UI.
- Create an isolated Git worktree per coding task.
- Translate Goose messages, tool requests, commands, diffs, tests, and approvals
  into Actestra events.
- Add version detection and fail-closed compatibility checks.
- Clean up workers and worktrees after completion, failure, and cancellation.

### Ordered slices

1. **P5.0 — source and protocol admission:** accept ADR-0024, exact upstream,
   license, provenance, lock-audit, rollback, telemetry, network, and packaging
   evidence. Exit with no imported or executed Goose runtime.
2. **P5.1 — minimal runner and handshake:** build and admit one exact runner,
   validate ACP name/version/capabilities and private-root cleanup, and fail
   unsupported versions before session or repository effects. ADR-0025 permits
   only the exact uncompiled `rsa 0.9.10` audit-metadata disposition when the
   active graph, all-target inverse queries, compiled artifacts, and normalized
   audit all supply the required independent proof.
3. **P5.2 — isolated coding capability:** create one fixture Git worktree and
   route only closed file, terminal, Git, diff, and test capabilities through
   the Actestra gateway, then register one approved main-captured patch as an
   Actestra Artifact, with denial, approval, drift, failure, cancellation, and
   process cleanup evidence. Publish remains outside the Goose MCP tool list.
4. **P5.3 — preserved AionUI coding journey:** project the accepted events and
   artifacts into the retained agent settings, selector, repair, ACP
   conversation, permission, terminal, diff, and test surfaces, then run the
   full P5 gate.

### Exit gate

- A repository fixture can be modified, tested, reviewed, and cancelled without
  writing to the source checkout or bypassing approvals; an approved patch can
  become an Actestra Artifact only after exact re-capture.
- Unsupported Goose versions fail with a clear, non-destructive error.
- The admitted runner's source pin, feature set, lock, executable digest,
  license, SBOM, binary audit, network policy, and process cleanup all agree;
  the broad upstream CLI cannot be substituted silently.

## P6 — Multi-Agent Team Orchestration

### Accepted development-delivery gate (2026-08-13)

The current development delivery slice has closed the coding delivery and
General v1 implementation gates in source, focused tests, downstream
materialization, packaged P4 smoke, and a real provider-backed Electron run.
Coding now delivers an isolated-worktree patch Artifact and requires a second
explicit approval before Main applies it to the original workspace. General
remains text-only with structured requirements admission and structured output
validation. The mixed General+Goose acceptance exercised real model/tool
execution, patch Artifact creation, separate workspace-apply approval, final
human feedback, whole-Team cancellation, restart recovery, and no-orphan
shutdown on the ad-hoc-signed development app. Pull request 51 passed exact-head
CI `31623674948` at
`aef8d537be6409f4a0ce2d53299413b26155ed82`, squash merged as
`1aefa46597d334b4fad48cf176fed1b166cdbacc`, and passed merged-main CI
`31625296206`. P6's development-delivery exit gate is accepted. Formal signing,
release, deployment, cross-platform acceptance, and final user acceptance
remain separate P7/P8 or release gates.

Current progress includes the closed plan-candidate admission, desktop-main
planner port, schema-14 admitted-plan durability barrier, schema-15 Team run
authority, a local generic planner-sidecar protocol/supervisor, and a local
Actestra-owned scheduler/control/recovery service. The current
local Task 5 layer composes that scheduler with the real General Work journey
and admitted Goose coding journey, including protected approvals, durable
Artifact re-read, reference-only aggregation, denial, and whole-Team
cancellation. The local Task 6 layer now adds the fixed Team request/event
bridge, trusted-current-main-frame IPC, schema-15 Team CRUD and per-Team run
listing, plus a main-owned provider that composes real plan admission and
TeamOrchestrator execution. Local Tasks 7 and 8 add downstream patch 0014, the
fixed preload provider, AionUI-native creation/list and `/team/:id` group-chat
surfaces, member/role and General+Goose configuration, workspace/task input,
messages, explainable plan/node/Worker/dependency/blocked state, controls,
Artifacts, aggregation, and persistent activity recovery. The current Task 14
correction adds schema-16 immutable Team experience
bindings and changes provider-active renderer list/get to consume one Main/Core
projection instead of merging native and orchestrated lists or guessing missing
types. Existing AionUI Teams migrate to `standard`; schema-15 Actestra Teams
bind to `orchestrated`; conflicts fail closed. The same local batch adds
schema-17 metadata-only standard-Team message delivery authority: Main persists
the intent before the provider effect, replays only an observed durable
acknowledgement for the same nonce and request digest, and fails closed on
changed, pending, uncertain, or conflicting deliveries without persisting
message content or attachment paths. The Task 14 batch is integrated on `main`
through the P6 merge above; its pre-delivery history forked from
`a3f23d6391a6f6c34f5a88cfa12e35b9665e5196`. ADR-0026 authorizes a separate
Actestra-native planner v1 implementation with engine identity
`actestra-native-team-planner@1.0.0`; the current development bundle packages
and admits that exact planner. The final root gate, packaged target-app
acceptance, exact-head CI, merge, and merged-main CI are GREEN. Formal signing,
release, deployment, cross-platform acceptance, and real CrewAI admission
remain open; no CrewAI runtime is imported or packaged.

The same local batch retains Core/sidecar result adapters and persisted-grant
workspace resolution, but deliberately removes the local-Agent provider/runtime
from the shipped downstream graph. Ordinary product startup does not import,
construct, version-probe, help-probe, or invoke Claude or Codex and does not
forward credentials. Manifest and native-wiring guards reject both provider
source copies and startup runtime injection. A non-shipped evaluation prototype
projects zero capabilities and rejects structured invocation before spawn; it
is research evidence only. A future admitted provider still requires a safe
credential-backed model proxy and pre-execution proof; script-based Codex has
no equivalent native proof, and Claude `--bare` cannot reuse OAuth/Keychain.
The admitted non-fixture General Worker, Goose runtime, and real mixed Team
journey are now verified in the packaged development app. The current local
ledger includes visible creation/configuration, execution, approval and
feedback controls, Artifact aggregation/apply, cancellation, restart recovery,
and no-orphan shutdown; planner-only evidence was not used as a substitute.

The current local UI correction also projects live submission availability from
Main before effect. When the admitted planner/orchestrator composition is absent,
the closed run-state reports `planner-unavailable`, the Main-owned restart next
action, and its runtime authority source. AionUI shows that state and blocks the
task intent before calling the bridge; the POST route remains independently fail
closed. Planner submit failures now retain a separate bounded invalid-plan or
timeout category through Main, bridge, and localized AionUI recovery guidance.
Control/approval, workflow-feedback, whole-Team cancel, and rename failures now
use fixed localized inline guidance instead of exposing raw runtime messages.
The renderer maps the closed Main blocked-reason enum to fixed English/Chinese
explanations while keeping Main/Core as the reason authority. It also maps the
closed run-status, assistant-status, node-state, and node-capability enums to
fixed English/Chinese AionUI labels instead of displaying internal tokens. The
focused Workspace DOM file passes 14 tests, materialized strict TypeScript
passes, and the 293-file downstream contract guards that projection.
This is explainability and invalid-intent containment, not planner admission or
Team execution evidence.

### Deliverables

- Leader planning with bounded task decomposition.
- Keep an Actestra-owned TeamOrchestrator as the only authoritative dependency,
  attempt, budget, approval, artifact, cancellation, and recovery state
  machine.
- Admit a capability-gated local provider under the 2026-08-06 ADR-0015
  amendment only after tools, hooks, network, credentials, and arbitrary reads
  are hard-blocked before execution and a non-renderer safe credential path is
  proven. Keep Claude and Codex admission-disabled until then; post-hoc event
  rejection is insufficient. Validate every provider result before it becomes
  authoritative or schedulable. Keep real CrewAI behind its separate exact pin,
  dependency, license, vulnerability, network, packaging, and rollback gates.
- Build a complete AionUI-native Team/group-chat experience covering creation,
  list, `/team/:id`, members and roles, General+Goose configuration, owned
  workspace and task input, chat/messages, plan/node/Worker progress,
  dependencies, approvals, controls, Artifacts, aggregation, and recovery.
  AionUI v2.1.41 remains the design/component/navigation foundation, but page
  and information-architecture evolution is allowed through recorded R1/R2
  downstream patches with retention, compatibility, and rollback evidence; do
  not add a separate Goose or Eigent application UI.
- Persist one Main/Core-owned Team experience binding and route by the Team's
  own `standard` or `orchestrated` type. Existing standard-Team features must
  remain reachable while the Actestra provider is active; renderer-side ID,
  workspace, or provider-availability guesses are not authority.
- Persist standard-Team message delivery intent before provider effect, admit
  only an observed provider acknowledgement, and fail closed on ambiguous or
  interrupted effects without storing message content or attachment paths.
- Dependency graph and ready/running/blocked/completed/failed/cancelled states.
- Parallel general and coding workers.
- Shared artifact references without shared uncontrolled working directories.
- Pause, retry, replace worker, manual handoff, and result aggregation.
- Approval nodes that block downstream work until resolved.

### Exit gate

- A representative mixed general-and-code fixture completes deterministically.
- Dependency, partial failure, retry, cancellation, and aggregation tests pass.
- A user can create, run, understand, and control the representative Team from
  the visible AionUI-native journey. The UI identifies Actestra authority and
  the current General or Goose executor, explains dependencies, approvals,
  interruption and every blocked reason, offers only valid next actions, and
  restores the same understandable state after restart.
- Provider crash, cancellation, restart, authentication failure, malformed
  output, or version/capability mismatch leaves the Actestra graph recoverable
  and creates no orphan process or Worker. The same gate applies again if real
  CrewAI is admitted later.

## P7 — Security and Reliability Hardening

### P7.1 development integration gate (2026-08-15)

The Threat Model and Abuse-Case Ledger are accepted on `main` through pull
request 56, squash merge `d7db878ce0385a14dae579bea3fe299e17e856b7`, and
passing exact-head and merged-main CI. The closed catalog has 28 cases; the
macOS arm64 package passes trust verification, the existing General Work smoke,
and the packaged P7 security hook for all seven required Layer-4 cases.

This P7.1 gate did not itself close the remaining P7 reliability slices. P7.2
Worker resource/process reliability and P7.3 database backup, migration
rollback, and crash recovery are accepted below. P7.4 diagnostic export and
audit retention remains open. Windows/Linux acceptance, formal
signing/notarization, release, deployment, and final user acceptance remain
separate gates.

### P7.2 development integration gate (2026-08-16)

P7.2 applies fixed Main-owned resource profiles to General Worker and Goose Worker only.
It reuses Electron `utilityProcess`, the admitted Goose runner, Supervisor, Tool
Gateway, macOS sandbox, process-group cleanup, and downstream overlay. It does
not add Renderer controls or extend the Planner sidecar or SQLite persistence
utility.

The gate is accepted on `main` through pull request 58 at exact head
`69dde6adfd44188eec475a55ae02cbab893103b4`, pull-request CI run 31900510574,
squash merge `dc904b7b9cf7d0c64c563bcc732547f0ff27ce13`, and merged-main CI run
31901651415. Both CI runs pass the required Goose and macOS jobs; the macOS job
verifies package trust and the General CPU/memory and Goose
output/storage/fork probes against the exact packaged bytes. P7.3 and P7.4
remain separate and are not started by this slice. Windows/Linux enforcement,
formal signing/notarization, release, deployment, and final user acceptance
remain later gates.

### P7.3 development integration gate (2026-08-16)

P7.3 applies private file-level migration recovery to the SQLite persistence
utility only. It creates SHA-256-bound pre-migration backups for existing
Actestra-owned databases, restores the original database if an in-process
migration fails, and recovers an unreadable current database from a pending
manifest after a startup crash. It preserves ADR-0005's forward-only migration
model, DELETE/FULL journal policy, and renderer/preload non-authority.

The gate is accepted on `main` through pull request 60 at exact head
`e4f548f3d5ba3d5fd1e02882b0beaa928241e9e0`, pull-request CI run
31906809232, squash merge `7418d4d6bb348f9c80961343ec49807fbfdab4ad`, and
merged-main CI run 31907989900. Both CI runs pass the required Goose and macOS
jobs; the macOS job repeats package trust, General Work, P7.1 security, and
P7.2 resource smokes against the exact packaged bytes. P7.4 diagnostic export
and audit retention remains open. Windows/Linux enforcement, formal
signing/notarization, release, deployment, and final user acceptance remain
later gates.

### P7.4 pre-merge local and packaged development gate (2026-08-16)

P7.4 adds one explicit-consent, local-only diagnostic export and fixed
privileged-audit retention behind the existing Main and SQLite utility
authorities. Schema 23 chains retained audit records, preserves a verifiable
deleted-prefix anchor, prunes only complete terminal request groups under the
fixed 90-day / 100,000-record policy, and fails closed on corruption or unsafe
hard-cap enforcement. Renderer receives only `saved`, `cancelled`, or
`rejected`; it receives no destination path, report bytes, raw audit records,
SQLite access, logs, credentials, or generic filesystem authority.

The reviewed product-source parent is
`ae3ff15ad3d4d6ceaf0da418bd07e4c979f5759f`. Focused P7.4 verification passes
14 files / 117 tests. `bun run check` exits 0 with 138 test files passed / 2
skipped and 1,516 tests passed / 9 skipped. The unchanged P7.1 gate still
passes all 14 invariants, 28 cases, and 168 exact variants as `denied-safe`.
The same strict-verified ad-hoc macOS arm64 development app passes General
Work, the seven-case P7.1 security smoke, the five-case P7.2 resource smoke,
and the P7.4 diagnostic/audit smoke. The frozen `foundation/` snapshot is
unchanged and no privileged process remains after verification.

This records a local and packaged development gate only. P7.4 and the overall
P7 phase remain pre-merge until the documentation revision, exact-head
pull-request CI, governed merge, and independent merged-main CI pass. P8,
Windows/Linux acceptance, formal signing/notarization, release, deployment,
and final user acceptance remain separate gates.

### Deliverables

- Threat model and abuse-case suite.
- Filesystem, shell, network, credential, MCP, and inter-process boundaries.
- Platform sandbox strategy and least-privilege defaults.
- Signed worker manifests or equivalent integrity checks.
- Resource limits, audit retention, redaction, and diagnostic export.
- Database backup, migration rollback, and crash-recovery tests.

### Exit gate

- Security review has no unresolved release-blocking findings.
- Protected actions cannot execute without policy and approval evidence.
- Recovery tests prove no orphaned privileged process or unreconciled task state.

## P8 — Cross-Platform Internal Beta

### Deliverables

- macOS, Windows, and Linux build and smoke matrices.
- Signing, notarization where applicable, update metadata, and rollback plan.
- SBOM, checksums, provenance, license and NOTICE bundle.
- Clean-machine install, upgrade, uninstall, and fresh-profile acceptance.
- Internal beta runbook and issue intake.

### Exit gate

- Exact source commits map to verified candidate artifacts.
- Platform-specific install and primary journey evidence is recorded.
- Candidate, release, deployment or distribution, and user acceptance are
  reported as separate states.

## Work sequencing rule

A later phase may run a time-boxed spike before the previous gate closes, but
spike code cannot become production architecture until its dependency gate is
satisfied and the decision is recorded. ADR-0015 permits a bounded CrewAI
protocol spike before P6, but it cannot change product authority or count as P6
implementation.
