# P8.2b Linux Goose Runtime Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose the already-probed Linux Goose controls into a rootless, Main-owned bridge and ACP lifecycle without enabling Linux runtime admission before the exact native integration gate is green.

**Architecture:** Main will create the attempt private root before starting its two HTTP handlers, bind those handlers to restrictive Unix sockets inside the root, and expose only synthetic per-attempt loopback ports. The Rust runner will validate the closed environment, set parent-death and fixed limits, unshare user/mount/network namespaces, apply Landlock and the existing thread-aware seccomp policy, bind the two namespace-local loopback ports, and relay bounded bytes to the inherited Main Unix sockets before starting the pinned Goose ACP server. The existing Darwin path, AionUI/Main/Core authorities, artifact admission, `complete=false`, and Darwin-only resolver remain unchanged.

**Tech Stack:** TypeScript/Node `http` and Unix sockets, Rust 1.96.1, `libc`, Tokio 1.48, Vitest, native Ubuntu 24.04 CI.

---

## Fixed boundary and review notes

- Do not edit `foundation/`, Renderer, preload, provider, persistence, or the Goose source pin.
- Do not add root, sudo, setuid, cgroup mutation, host-network fallback, a second supervisor, or a generic proxy.
- Linux and Windows remain fail closed. This batch may add the Linux adapter and tests, but must not change the production resolver to admit Linux.
- The six evidence booleans and `complete=false` remain unchanged until a later exact Artifact/ACP integration gate.
- The current composition order is unsafe for an in-root socket design; the bridge factory below is the deliberate lifecycle seam that fixes it.

## File responsibility map

- `apps/desktop/src/main/workers/gooseBridgeSocket.ts`: bounded socket-path validation, synthetic loopback-port reservation, Unix listener setup/permissions, and idempotent socket removal.
- `apps/desktop/src/main/workers/gooseMcpCapabilityServer.ts`: optional Unix listener while retaining the existing HTTP handler and lease/policy checks.
- `apps/desktop/src/main/workers/gooseLoopbackModelServer.ts`: optional Unix listener while retaining the existing model/session checks.
- `apps/desktop/src/main/workers/gooseRunnerProcess.ts`: prepared-root/bridge-factory lifecycle, Linux environment contract, Linux spawn selection, and closed native failure markers.
- `workers/goose-runner/src/containment/linux.rs`: production namespace/network/Landlock setup exports and fixed stage errors.
- `workers/goose-runner/src/linux_runtime.rs`: Linux loopback listeners and bounded Unix-to-TCP relay; transport only.
- `workers/goose-runner/src/main.rs`: Linux setup ordering and relay/Goose shutdown ownership.
- `workers/goose-runner/Cargo.toml`: only the Tokio features required for net/io/time/sync.
- `tests/main/gooseBridgeSocket.test.ts`, `tests/main/gooseMcpCapabilityServer.test.ts`, `tests/main/gooseLoopbackModelServer.test.ts`: Unix listener contracts and cleanup.
- `tests/main/gooseRunnerLifecycle.test.ts`, `tests/main/gooseRunnerContainment.test.ts`: prepared-root and closed Linux launch contracts.
- `tests/scripts/gooseRunnerPortability.test.mjs`, `tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`: source/startup-order contracts.
- `workers/goose-runner` Rust unit tests: relay bounds, endpoint mapping, and setup order.
- `docs/PROJECT_STATUS.md`: exact local/native evidence and remaining non-claims.

### Task 1: Add the bounded Main Unix bridge listener abstraction

**Files:**

- Create: `apps/desktop/src/main/workers/gooseBridgeSocket.ts`
- Create: `tests/main/gooseBridgeSocket.test.ts`
- Modify: `apps/desktop/src/main/workers/gooseMcpCapabilityServer.ts`
- Modify: `apps/desktop/src/main/workers/gooseLoopbackModelServer.ts`
- Modify: their focused tests

- [ ] **Step 1: Write the failing socket-contract tests.**

Cover: absolute non-root socket paths only; `socketPath` and `loopbackPort` are required together; stale regular files are rejected; a Unix listener gets mode `0600`; the returned synthetic Host/URL uses the exact reserved port; close unlinks only the owned socket and is idempotent.

- [ ] **Step 2: Run the focused tests and verify RED.**

Run `bun run test -- tests/main/gooseBridgeSocket.test.ts` and confirm the missing module/listener contract fails for the expected reason.

- [ ] **Step 3: Implement the minimal abstraction.**

Export `GooseBridgeListenerOptions`, `reserveGooseLoopbackPort()`, `listenGooseBridgeServer()`, and `closeGooseBridgeServer()`. Use `lstat` before unlinking; only an existing Unix socket may be removed. Require a bounded absolute path, reserve a port with a temporary `127.0.0.1` listener, listen on the Unix path, then `chmod` it to `0600`. Return `{ host, port }` and never return a host-network URL for the Unix listener itself.

- [ ] **Step 4: Thread optional socket options into both existing HTTP servers.**

Add only optional `socketPath`/`loopbackPort` fields to each start-options contract. Keep all existing handlers, headers, leases, counters, and response serialization unchanged. On Unix mode use the shared listener helper and set `expectedHost` to `127.0.0.1:<loopbackPort>`; on existing mode retain random TCP behavior. Close must use the shared idempotent unlink path.

- [ ] **Step 5: Run focused server tests and commit.**

Run the new socket test plus the two existing server test files, then format and `git diff --check`. Commit as `feat: add Main-owned Unix bridge listeners`.

### Task 2: Add the Linux runner setup and bounded relay

**Files:**

- Create: `workers/goose-runner/src/linux_runtime.rs`
- Modify: `workers/goose-runner/src/containment/linux.rs`
- Modify: `workers/goose-runner/src/containment/mod.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `workers/goose-runner/Cargo.toml` and lockfile
- Add Rust unit tests in the new module and source-contract tests

- [ ] **Step 1: Write failing Rust/source tests.**

Lock these facts: PDEATHSIG is installed before namespace setup; Linux setup requires the fixed port/socket/workspace keys; only `127.0.0.1` listeners are accepted; relay maps capability socket to capability port and model socket to model port; no more than eight concurrent relay connections; each direction has a bounded byte ceiling and timeout; Tokio is constructed only after setup and seccomp.

- [ ] **Step 2: Run the tests and verify RED.**

Run the focused Rust/source tests. Confirm they fail because the runner has no Linux runtime module or bridge environment keys.

- [ ] **Step 3: Reuse and export the existing Linux primitives.**

Expose one production `prepare_linux_filesystem_containment(private_root, workspace_root)` that calls the same user/mount/network namespace and Landlock functions used by the hostile probe. Add a fixed `linux-*` stage vocabulary, `set_parent_death_signal()`, and a loopback-up operation using `ioctl`; do not invoke `ip`, `exec`, root, or a helper.

- [ ] **Step 4: Implement the relay-only module.**

Parse and validate the closed environment; bind two nonblocking `std::net::TcpListener`s to `127.0.0.1` in the new namespace; convert them to Tokio listeners after setup; connect each accepted stream only to its fixed Unix socket; copy both directions with a fixed buffer, per-connection byte ceiling, timeout, and eight-connection cap; retain handles and abort/await them on shutdown. No URL parsing, destination selection, logging, persistence, retry, or policy logic belongs here.

- [ ] **Step 5: Wire startup and shutdown in `main.rs`.**

For Linux use this exact order: validate environment → `PR_SET_PDEATHSIG`/parent race check → RLIMITs → user/mount/network namespaces and loopback → Landlock → seccomp → listeners → Tokio → liveness watcher → relay tasks → pinned Goose ACP. Emit only fixed network/resource markers on setup failure, shut down relay tasks before returning, and preserve the existing Darwin/Windows branches.

- [ ] **Step 6: Run macOS Rust tests and dependency-free Linux type checks.**

Run `cargo fmt --check`, the locked macOS release tests, and the existing dependency-minimal Linux-target compile wrapper. Do not call these native Ubuntu evidence.

- [ ] **Step 7: Commit the runner slice.**

Commit as `feat: compose Linux Goose namespace relay`.

### Task 3: Connect the bridge factory to Main lifecycle without opening admission

**Files:**

- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `apps/desktop/src/main/workers/gooseMcpSessionComposition.ts`
- Modify: `tests/main/gooseRunnerLifecycle.test.ts`
- Modify: `tests/main/gooseMcpSessionComposition.test.ts`

- [ ] **Step 1: Write failing lifecycle tests.**

Use injected runner/transport dependencies to prove: runtime/admission validation happens before root creation; once admitted, the bridge factory receives the prepared root; both Main servers start inside that root before the transport is created; model/capability URLs and Unix paths are bound one-to-one; any startup failure closes both servers and removes the root; duplicate close shares one promise. Keep the existing macOS order and assertions unchanged unless the new Linux-only path is selected.

- [ ] **Step 2: Run and verify RED.**

Run the two focused files and confirm the bridge-factory seam is absent.

- [ ] **Step 3: Implement prepared-root and bridge-factory APIs.**

Add an immutable prepared-root type and an optional `prepareBridge` callback to `openGooseRunnerHandshake`. The function must perform target/containment preflight first, create the root, invoke the callback, validate its exact endpoint contract, and clean up callback resources plus root on every failure. `close()` must close the runner transport and callback-owned servers exactly once before root removal. Direct TCP options remain the unchanged Darwin path.

- [ ] **Step 4: Integrate Linux composition.**

On Linux-only code paths (which remain unreachable because the resolver is still Darwin-only), generate two leases, reserve two ports, start the existing handlers on `root/bridge/*.sock`, return the synthetic URLs/model binding plus exact socket paths to the handshake, and keep the existing discovery/prompt/counter logic. The renderer and Core APIs do not change.

- [ ] **Step 5: Run focused lifecycle/composition tests and commit.**

Run the affected tests, strict TypeScript, format, and diff check. Commit as `feat: bind Linux bridge to Goose lifecycle`.

### Task 4: Native evidence wiring and status update

**Files:**

- Modify: `.github/workflows/ci.yml` only if the existing Ubuntu containment job needs the new exact command/environment keys
- Modify: `tests/scripts/gooseRunnerContainmentAcceptance.test.mjs`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: this plan/spec status if implementation scope changes

- [ ] **Step 1: Add failing source/evidence assertions.**

Assert the native acceptance command still rejects `complete=false`, does not bind partial evidence, and the exact artifact digest/source digest are passed to the same runner code used by production. Add a regression that a Linux bridge setup marker maps to `network-policy-unavailable`, not `spawn-failed`.

- [ ] **Step 2: Run the tests and verify RED.**

Run the focused script tests and record the expected missing marker/contract failure.

- [ ] **Step 3: Implement only the evidence plumbing.**

Keep success-only uploads, closed diagnostics, exact artifact binding, and the existing separate Ubuntu job. Do not turn `complete` true and do not modify the Darwin-only resolver.

- [ ] **Step 4: Run the complete local gate.**

Run focused tests, Goose Rust tests, `bun run check`, `bun run docs:check`, format/lint/typecheck, and `git diff --check`. Report local evidence separately from target-native evidence.

- [ ] **Step 5: Update project status and commit.**

Record exact local results, the next required Ubuntu native run, and the explicit non-claims. Commit as `docs: record Linux runtime composition evidence`.

### Exit gate for this implementation batch

This batch is not called P8.2b-complete until a fresh exact-head Ubuntu 24.04 job proves the same Artifact through filesystem, network, process/resource, parent-death, cleanup, and authenticated ACP integration. Until then `complete=false`, the containment record is unbound, and Linux runtime resolution remains fail closed. Windows, P8.3, and P8.4 remain separate work.

