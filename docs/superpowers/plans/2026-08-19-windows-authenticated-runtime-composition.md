# Windows Authenticated Goose Runtime Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run one real Goose ACP coding session inside the admitted Windows AppContainer Worker while Electron Main retains Provider, Tool Gateway, approval, credential, workspace, and durable-state authority.

**Architecture:** Add one default-off runtime-adapter seam to an immutable commit in a standalone private Goose runtime repository, then connect it to Main through two authenticated, attempt-scoped named-pipe bridges relayed by the existing Windows Supervisor. Preserve the accepted AppContainer, Job Object, handle, environment, network, parent-death, and cleanup boundary; macOS and Linux keep their current transports.

**Tech Stack:** Rust 1.96.1, Goose v1.45.0 at upstream base `4dc0420f5704a92806c6628c8f0a3497d7a88759`, `windows-sys` 0.61.2, ACP 1.0.1/schema 1.1.0, MCP `rmcp` 2.2.0, TypeScript 5.9.3, Bun 1.3.9, Vitest 4.1.0, GitHub Actions `windows-2025`.

---

## Scope and execution rules

- Execute the batches in order. Each batch ends in a reviewable commit and keeps Windows production admission closed until its own exit checks pass.
- Never edit `foundation/`. Do not add Renderer or preload authority.
- Never place a Provider credential, original-workspace path, broad parent environment, network capability, or generic shell fallback in the Supervisor or Worker.
- The Supervisor validates framing and lifecycle only. It must not parse prompts, model messages, tool arguments, tool results, approval state, or workspace policy.
- Use one fixed commit from the standalone private `Ablankpaper/actestra-goose-runtime` repository based on the exact upstream commit. It is not a GitHub Fork and must have no automatic upstream synchronization. Do not import the Goose source tree into Actestra.
- Do not invent a runtime commit, diff digest, Windows result, CI run ID, or Artifact digest. Resolve each value from the real repository, build, or CI output at the step that records it.
- Reuse unchanged GREEN evidence only when its verification key is unchanged. A changed source pin, Cargo lock, bridge contract, runner binary, or CI head requires fresh evidence.
- Deterministic Windows composition evidence does not prove Windows Electron packaging or a real external Provider. Those remain P8.2 and P8.4 gates respectively.

## File map

### External private Goose runtime repository

- Modify `crates/goose/src/acp/server.rs`: define the optional runtime adapter, bind the fixed Provider, install one fixed MCP client before session activation, and reject more than one claimed session.
- Modify `crates/goose/src/acp/server_factory.rs`: carry the optional adapter into each ACP agent and preserve the upstream default when absent.
- Modify `crates/goose/src/acp/server/new_session.rs`: use the fixed Provider/model and reject client-supplied Provider, model, recipe-extension, or MCP-server overrides in adapted mode.
- Test in the same three upstream files: prove default behavior is unchanged, adapted session creation is one-shot, installation precedes activation, and failed installation cleans the partial session.

### Batch 1: Actestra provenance and admission

- Modify `apps/desktop/src/shared/gooseRunnerSource.json`: record canonical repository, base commit, private runtime repository, immutable runtime commit, changed upstream paths, diff SHA-256, and unchanged empty Goose feature set.
- Modify `workers/goose-runner/Cargo.toml` and `workers/goose-runner/Cargo.lock`: pin the exact private runtime commit.
- Modify `scripts/build-goose-runner.mjs`: verify the fetched private runtime checkout, base ancestry, exact changed paths, exact diff digest, and Cargo feature set before building.
- Modify `apps/desktop/src/main/workers/gooseRunnerArtifact.ts`: carry and admit the expanded source contract in the immutable manifest.
- Modify `tests/main/gooseRunnerArtifact.test.ts`, `tests/main/gooseRunnerTarget.test.ts`, and `tests/security/persistenceArtifactRedactionAbuse.test.ts`: fail closed on source/runtime/diff/feature drift.
- Modify `.github/workflows/ci.yml` and its workflow-contract tests: load one repository-scoped read-only deploy key for same-repository CI before Cargo fetches the private runtime dependency; never expose it to external-fork pull requests.
- Modify `workers/goose-runner/PATCHES.md`, `docs/governance/UPSTREAM_VERSIONS.md`, `docs/upstream/GOOSE_V1.45.0_EVALUATION.md`, and `THIRD_PARTY_NOTICES.md`: record provenance, Apache-2.0 modification notice, rollback, and exact upstream evidence.

### Batch 2: Worker and Supervisor runtime

- Refactor `workers/goose-runner/src/windows_bridge.rs`: shared bounded frame header, strict JSON decoding, request correlation, and closed bridge errors.
- Create `workers/goose-runner/src/windows_model_bridge.rs`: model request/response/cancel vocabulary and Goose `Provider` adapter.
- Create `workers/goose-runner/src/windows_capability_bridge.rs`: list/call/cancel vocabulary and Goose `McpClientTrait` adapter.
- Create `workers/goose-runner/src/windows_named_pipe.rs`: single-client AppContainer-scoped named-pipe creation and Worker connection.
- Modify `workers/goose-runner/src/windows_control.rs`: carry only the versioned attempt/session/model/pipe metadata required by the Worker.
- Modify `workers/goose-runner/src/windows_supervisor.rs`: dedicated Worker control/ready handles, exact inherited handle list, two ACL-bound named pipes, ACP/capability/model relays, bounded cancellation, and idempotent cleanup.
- Modify `workers/goose-runner/src/main.rs`: construct the adapters and serve the adapted Goose ACP agent in Worker mode.
- Modify `workers/goose-runner/Cargo.toml`: add only the direct crates required to implement the already-selected Goose/MCP interfaces.
- Modify `scripts/gooseContainmentEvidence.mjs` and `tests/scripts/gooseContainmentDiagnostics.test.mjs`: admit the new closed diagnostic vocabulary without raw Win32 data.

### Batch 3: Main composition

- Create `apps/desktop/src/main/workers/gooseAuthenticatedBridgeProtocol.ts`: strict TypeScript frame contracts matching Rust.
- Create `apps/desktop/src/main/workers/gooseWindowsModelBridgeHost.ts`: Main-owned model invocation, correlation, cancellation, and served/refused/rejected counters.
- Create `apps/desktop/src/main/workers/gooseWindowsCapabilityBridgeHost.ts`: Main-owned exact-six-tool list/call/cancel bridge around `GooseMcpToolInvoker`.
- Create `apps/desktop/src/main/workers/gooseSessionTransport.ts`: explicit `macos-loopback`, `linux-relay`, and `windows-authenticated` transport modes plus shared capability/model boundary interfaces.
- Modify `apps/desktop/src/main/workers/gooseRunnerProcess.ts`: allocate seven Main/Supervisor channels, attach the two Main bridge hosts, and keep Windows `networkPolicy: "deny-all"`.
- Create `tests/main/gooseRunnerWindowsChannelNative.test.ts`: on a real Windows Node runtime, prove fd 5 and fd 6 are independently duplex before the production transport relies on seven rather than nine channels.
- Modify `apps/desktop/src/main/workers/gooseAcpHandshake.ts`: send an MCP-free Windows `session/new` request while preserving the existing macOS/Linux request.
- Modify `apps/desktop/src/main/workers/gooseMcpSessionComposition.ts`: select an explicit transport mode, preserve exact tool discovery and counter semantics, and keep callers platform-neutral.
- Modify the corresponding tests under `tests/main/` and `tests/security/`.

### Batch 4: exact Windows evidence and current truth

- Create `tests/main/gooseRunnerWindowsNative.integration.ts`: deterministic full composition through the real admitted artifact and Tool Gateway.
- Create `scripts/gooseWindowsRuntimeEvidence.mjs` and `scripts/run-goose-runner-windows-runtime.mjs`: bind evidence to exact source/runtime/runner/manifest digests.
- Create `tests/scripts/gooseWindowsRuntimeEvidence.test.mjs`: fail closed on incomplete, widened, sensitive, or mismatched evidence.
- Modify `.github/workflows/ci.yml` and `package.json`: add the exact-head Windows authenticated-runtime job and success-only Artifact upload.
- Modify `docs/architecture/decisions/0024-minimal-goose-acp-runner.md`, `docs/architecture/SYSTEM_OVERVIEW.md`, `docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md`, `docs/roadmap/DEVELOPMENT_SEQUENCE.md`, and `docs/PROJECT_STATUS.md`: record the accepted seam, verified evidence, remaining gates, and non-claims.

## Batch 1 — immutable Goose seam and provenance

### Task 1: Create and test the default-off Goose runtime-adapter seam

**Files:**

- External private runtime modify: `crates/goose/src/acp/server.rs`
- External private runtime modify: `crates/goose/src/acp/server_factory.rs`
- External private runtime modify: `crates/goose/src/acp/server/new_session.rs`
- External private runtime test: tests colocated in those files

- [ ] **Step 1: Initialize the standalone private repository from the exact accepted base**

Run from outside the Actestra worktree:

```bash
test "$(gh api user --jq .login)" = "Ablankpaper"
test "$(gh repo view Ablankpaper/actestra-goose-runtime --json visibility --jq .visibility)" = "PRIVATE"
test "$(gh repo view Ablankpaper/actestra-goose-runtime --json isFork --jq .isFork)" = "false"
runtime_root="${ACTESTRA_GOOSE_RUNTIME_CHECKOUT:?set the private runtime checkout path}"
test "$(git -C "$runtime_root" remote get-url origin)" = \
  "git@github-ablankpaper:Ablankpaper/actestra-goose-runtime.git"
test "$(git -C "$runtime_root" remote get-url canonical)" = \
  "https://github.com/aaif-goose/goose.git"
test "$(git -C "$runtime_root" rev-parse origin/main)" = \
  "4dc0420f5704a92806c6628c8f0a3497d7a88759"
git -C "$runtime_root" switch -c actestra/acp-runtime-adapter-v1 \
  4dc0420f5704a92806c6628c8f0a3497d7a88759
```

Expected: `Ablankpaper/actestra-goose-runtime` is private, is not a GitHub Fork,
has GitHub Actions disabled and no automatic synchronization, and `main` equals
the exact accepted upstream base. The base retains its original upstream
workflow and Dependabot configuration bytes, but they do not move an admitted
runtime ref. The new branch starts at that same commit. If the named branch
already exists, stop and inspect it instead of force-pushing or silently
reusing it.

- [ ] **Step 2: Write failing upstream tests for the seam**

Add tests that construct a fake `Provider`, a fake `McpClientTrait`, and an adapter with this public shape:

```rust
#[derive(Clone)]
pub struct AcpRuntimeAdapter {
    pub provider_id: String,
    pub model_config: goose_providers::model::ModelConfig,
    pub provider: Arc<dyn goose_providers::base::Provider>,
    pub extension_name: String,
    pub extension_config: ExtensionConfig,
    pub extension_client: Arc<dyn crate::agents::mcp_client::McpClientTrait>,
    pub data_dir: PathBuf,
    pub config_dir: PathBuf,
}
```

The tests must assert:

```rust
assert!(server.runtime_adapter.is_none());
assert_eq!(adapted_session.provider_name.as_deref(), Some("actestra"));
assert_eq!(adapted_session.model_config.unwrap().model_name, "actestra-fixed-model");
assert_eq!(loaded_tools, vec!["actestra-capability-proxy__actestra.coding.file-read"]);
assert!(agent.has_session(&first_session_id).await);
assert!(second_session_result.is_err());
assert!(!agent.has_session(&failed_session_id).await);
```

Also send a `NewSessionRequest` containing an HTTP MCP server and a Provider/model override; adapted mode must return invalid parameters before either fake receives a call.
Set global Goose Provider/model/mode/naming and path inputs to conflicting
canaries and assert adapted mode still uses only the fixed adapter values and
its temporary `data_dir`/`config_dir`.

- [ ] **Step 3: Run the private runtime tests and verify RED**

```bash
cargo test --manifest-path "$runtime_root/crates/goose/Cargo.toml" acp_runtime_adapter --no-run
```

Expected: compilation fails because `AcpRuntimeAdapter` and the
Actestra-only adapted constructor do not exist.

- [ ] **Step 4: Implement the minimal seam**

Keep both public `AcpServerFactoryConfig` and `GooseAcpAgentOptions` shapes
unchanged so the default-off seam does not force changes across Goose CLI,
upstream integration tests, or other callers outside the admitted three-file
patch. Store `runtime_adapter: Option<AcpRuntimeAdapter>` in the private
`AcpServer` state instead. Existing `AcpServer::new(config)` initializes it to
`None`; add `AcpServer::new_with_runtime_adapter(config, adapter)` for the
Actestra-only entry point. Add internal
`GooseAcpAgent::new_with_runtime_adapter(...)` and `new_internal(...)`
constructors; the existing `GooseAcpAgent::new(...)` delegates to the internal
constructor with no adapter and retains current behavior. Preserve the
existing `run()` path unchanged; add a separate entry point used only by
Actestra:

```rust
pub async fn run_with_runtime_adapter(adapter: AcpRuntimeAdapter) -> Result<()> {
    let outgoing = tokio::io::stdout().compat_write();
    let incoming = tokio::io::stdin().compat();
    let data_dir = adapter.data_dir.clone();
    let config_dir = adapter.config_dir.clone();
    let server = crate::acp::server_factory::AcpServer::new_with_runtime_adapter(
        crate::acp::server_factory::AcpServerFactoryConfig {
            builtins: Vec::new(),
            data_dir,
            config_dir,
            goose_platform: GoosePlatform::GooseCli,
            additional_source_roots: Vec::new(),
            enable_scheduler: false,
        },
        adapter,
    );
    let agent = server.create_agent().await?;
    serve(agent, incoming, outgoing).await
}
```

In adapted mode, `handle_new_session()` must:

1. reject non-empty `mcp_servers`, Provider/model metadata, enabled-extension metadata, and recipe extension/provider/model overrides;
2. avoid `Config::global()` and persist only the adapter's fixed Provider ID,
   `ModelConfig`, default Goose mode, disabled automatic session naming, and
   per-attempt private data/configuration paths;
3. create the agent with the fixed `Arc<dyn Provider>`;
4. claim exactly one ACP session ID;
5. call `extension_manager.add_client()` with the fixed name/config/client before `register_acp_session()`;
6. remove the partial session and release no active registration if any step fails.

The normal `runtime_adapter: None` path must retain the upstream provider factory, extension loading, and session behavior byte-for-byte except for the optional branch. The adapted path must not call `Paths::data_dir()`, `Paths::config_dir()`, or read Provider/model/extension defaults from environment or global Goose configuration.

The agent stores the adapter and explicit single-session ownership state only
for the adapted path. A failed `session/new` must clear that ownership state so
one safe retry is possible; a successful active session must cause every
second `session/new` to fail closed. In adapted mode `config()` must reject
global configuration access, and model, Provider, mode, and thinking-effort
mutation entry points must reject the request without mutating session state.

- [ ] **Step 5: Run upstream GREEN and inspect the private runtime diff**

```bash
cargo fmt --manifest-path "$runtime_root/crates/goose/Cargo.toml" -- --check
cargo test --manifest-path "$runtime_root/crates/goose/Cargo.toml" acp_runtime_adapter
git -C "$runtime_root" diff --check
git -C "$runtime_root" diff --name-only 4dc0420f5704a92806c6628c8f0a3497d7a88759 -- \
  | sort
```

Expected: tests pass and the changed-path output contains exactly the three declared Goose files.

- [ ] **Step 6: Commit and push the immutable private runtime commit**

```bash
git -C "$runtime_root" add \
  crates/goose/src/acp/server.rs \
  crates/goose/src/acp/server_factory.rs \
  crates/goose/src/acp/server/new_session.rs
git -C "$runtime_root" commit -m "feat: add optional ACP runtime adapter"
git -C "$runtime_root" push origin actestra/acp-runtime-adapter-v1
runtime_commit="$(git -C "$runtime_root" rev-parse HEAD)"
test "$(printf '%s' "$runtime_commit" | wc -c | tr -d ' ')" = "40"
git -C "$runtime_root" merge-base --is-ancestor \
  4dc0420f5704a92806c6628c8f0a3497d7a88759 "$runtime_commit"
```

Expected: the runtime commit is recorded in the private
`Ablankpaper/actestra-goose-runtime` repository and descends from the exact
upstream base.

### Task 2: Pin and fail-closed admit the private runtime in Actestra

**Files:**

- Modify: `apps/desktop/src/shared/gooseRunnerSource.json`
- Modify: `workers/goose-runner/Cargo.toml`
- Modify: `workers/goose-runner/Cargo.lock`
- Modify: `scripts/build-goose-runner.mjs`
- Modify: `apps/desktop/src/main/workers/gooseRunnerArtifact.ts`
- Modify: `tests/main/gooseRunnerArtifact.test.ts`
- Modify: `tests/main/gooseRunnerTarget.test.ts`
- Modify: `tests/security/persistenceArtifactRedactionAbuse.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/scripts/p8NativeBuildWiring.test.mjs`
- Modify: `workers/goose-runner/PATCHES.md`
- Modify: `docs/governance/UPSTREAM_VERSIONS.md`
- Modify: `docs/upstream/GOOSE_V1.45.0_EVALUATION.md`
- Modify: `THIRD_PARTY_NOTICES.md`

- [ ] **Step 1: Write RED source-contract and artifact-admission tests**

Extend the JSON contract expected shape to:

```ts
type GooseSourceContract = Readonly<{
  repository: "https://github.com/aaif-goose/goose.git";
  version: "1.45.0";
  baseCommit: "4dc0420f5704a92806c6628c8f0a3497d7a88759";
  runtimeRepository: "ssh://git@github.com/Ablankpaper/actestra-goose-runtime.git";
  runtimeCommit: string;
  changedPaths: readonly [
    "crates/goose/src/acp/server.rs",
    "crates/goose/src/acp/server_factory.rs",
    "crates/goose/src/acp/server/new_session.rs",
  ];
  cargoFeatures: readonly [];
  patchSetSha256: string;
}>;
```

Tests must mutate one field at a time and expect admission rejection for:
canonical repository, base commit, private runtime repository, runtime commit,
changed path, path order, diff digest, and non-empty feature set. Add a
lockfile test that rejects any Goose source URL or revision not matching the
contract.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
bun run test \
  tests/main/gooseRunnerArtifact.test.ts \
  tests/main/gooseRunnerTarget.test.ts \
  tests/security/persistenceArtifactRedactionAbuse.test.ts
```

Expected: failures identify absent runtime/base/changed-path contract fields.

- [ ] **Step 3: Compute the real runtime digest and update the exact pins**

From the private runtime checkout created in Task 1:

```bash
runtime_commit="$(git -C "$runtime_root" rev-parse HEAD)"
runtime_patch="$(mktemp)"
git -C "$runtime_root" diff --binary --full-index --no-ext-diff \
  4dc0420f5704a92806c6628c8f0a3497d7a88759 "$runtime_commit" -- \
  crates/goose/src/acp/server.rs \
  crates/goose/src/acp/server_factory.rs \
  crates/goose/src/acp/server/new_session.rs > "$runtime_patch"
patch_sha256="$(shasum -a 256 "$runtime_patch" | cut -d ' ' -f 1)"
test "$(printf '%s' "$patch_sha256" | wc -c | tr -d ' ')" = "64"
```

Record those exact computed values in `gooseRunnerSource.json`. Update the two
git dependencies without allowing a package manager command to choose a
different source or revision:

```bash
ACTESTRA_GOOSE_RUNTIME_COMMIT="$runtime_commit" node --input-type=module <<'NODE'
import { readFile, writeFile } from "node:fs/promises";

const commit = process.env.ACTESTRA_GOOSE_RUNTIME_COMMIT;
if (!/^[0-9a-f]{40}$/.test(commit ?? "")) {
  throw new Error("ACTESTRA_GOOSE_RUNTIME_COMMIT must be a 40-character SHA");
}
const file = "workers/goose-runner/Cargo.toml";
const before = await readFile(file, "utf8");
const goose = `goose = { git = "ssh://git@github.com/Ablankpaper/actestra-goose-runtime.git", rev = "${commit}", default-features = false }`;
const replaced = before.replace(
  /^goose = \{ git = "https:\/\/github\.com\/aaif-goose\/goose", rev = "[0-9a-f]{40}", default-features = false \}$/m,
  goose,
);
if (replaced === before) {
  throw new Error("the expected canonical Goose dependency was not found");
}
const providers = `goose-providers = { git = "ssh://git@github.com/Ablankpaper/actestra-goose-runtime.git", rev = "${commit}", default-features = false }`;
const withProviders = replaced.includes("goose-providers =")
  ? replaced.replace(/^goose-providers = .*$/m, providers)
  : replaced.replace(/^goose = .*$/m, `${goose}\n${providers}`);
await writeFile(file, withProviders);
NODE
cargo check --manifest-path workers/goose-runner/Cargo.toml
git diff -- workers/goose-runner/Cargo.toml workers/goose-runner/Cargo.lock
```

Expected: both git dependencies use the same real private runtime SHA, Cargo
resolves it without unrelated lockfile churn, and the diff is reviewed before
any `--locked` command is run.

- [ ] **Step 4: Implement build-time private runtime verification**

In `scripts/build-goose-runner.mjs`, derive the fetched Goose package root from `cargo metadata --locked --format-version 1`, then require:

```js
const expectedChangedPaths = [...sourceContract.goose.changedPaths].sort();
const actualChangedPaths = await gitLines(gooseRoot, [
  "diff",
  "--name-only",
  sourceContract.goose.baseCommit,
  sourceContract.goose.commit,
]);
if (!isDeepStrictEqual(actualChangedPaths.sort(), expectedChangedPaths)) {
  fail(
    "Goose runtime changed-path set differs from the admitted source contract",
  );
}
const patch = await gitBytes(gooseRoot, [
  "diff",
  "--binary",
  "--full-index",
  "--no-ext-diff",
  sourceContract.goose.baseCommit,
  sourceContract.goose.commit,
  "--",
  ...expectedChangedPaths,
]);
if (sha256(patch) !== sourceContract.goose.patchSetSha256) {
  fail("Goose runtime patch digest differs from the admitted source contract");
}
```

Also require `cargo metadata` to report the private runtime URL and exact
commit, and require the resolved Goose feature array to equal `[]`. Add the new
source fields to the emitted manifest and `sourceTreeFiles`.

- [ ] **Step 5: Configure repository-scoped read-only CI access**

Generate a dedicated Ed25519 deploy key outside both repositories. Register
only its public key on `Ablankpaper/actestra-goose-runtime` with
`read_only=true`. Store the private key only as the
`ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY` Actions secret on
`Ablankpaper/actestra-desktop`; never commit either key or print the private
value. Add this condition to every CI job that resolves or builds Goose so an
external-fork pull request never reaches a private-source step:

```yaml
if: github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository
```

Within each admitted job, add a setup step before any Cargo command that needs
Goose. Pin GitHub's accepted ED25519 host key instead of trusting a live
`ssh-keyscan` result:

```yaml
- name: Admit private Goose runtime source
  shell: bash
  env:
    ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY: ${{ secrets.ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY }}
  run: |
    test -n "$ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY"
    key_root="$RUNNER_TEMP/actestra-goose-runtime-ssh"
    install -m 700 -d "$key_root"
    printf '%s\n' "$ACTESTRA_GOOSE_RUNTIME_DEPLOY_KEY" > "$key_root/id_ed25519"
    chmod 600 "$key_root/id_ed25519"
    printf '%s\n' \
      'github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl' \
      > "$key_root/known_hosts"
    echo 'CARGO_NET_GIT_FETCH_WITH_CLI=true' >> "$GITHUB_ENV"
    {
      echo 'GIT_SSH_COMMAND<<ACTESTRA_GOOSE_SSH'
      echo "ssh -i $key_root/id_ed25519 -o IdentitiesOnly=yes -o UserKnownHostsFile=$key_root/known_hosts"
      echo 'ACTESTRA_GOOSE_SSH'
    } >> "$GITHUB_ENV"
```

Workflow-contract tests must prove that external-fork pull requests cannot
reach a private-source build step and that the deploy key is never uploaded,
echoed, or passed to the runner. They must also pin the expected GitHub ED25519
host-key fingerprint
`SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU`. The private runtime
repository itself keeps GitHub Actions disabled and has no webhook, scheduled
sync, moving branch dependency, automatic merge, or update bot with write
authority over an admitted runtime ref. The exact upstream base does contain
inherited workflow and Dependabot configuration files; tests and documentation
must not falsely claim that those files are absent. External proposals cannot
change the immutable runtime SHA admitted by Actestra.

- [ ] **Step 6: Update provenance, Apache-2.0 notice, and rollback truth**

Record the exact private runtime commit and diff digest from Step 3. State that
the three modified upstream files add only the default-off ACP adapter seam,
upstream has no root `NOTICE`, and rollback restores upstream
`4dc0420f5704a92806c6628c8f0a3497d7a88759` while disabling Windows production
runtime admission. Record that the private repository has no automatic
upstream synchronization. Do not claim Windows execution or package acceptance
in this batch.

- [ ] **Step 7: Verify Batch 1 GREEN**

```bash
cargo metadata --manifest-path workers/goose-runner/Cargo.toml --locked --format-version 1 >/dev/null
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
bun run test \
  tests/main/gooseRunnerArtifact.test.ts \
  tests/main/gooseRunnerTarget.test.ts \
  tests/security/persistenceArtifactRedactionAbuse.test.ts
bun run goose:runner:format:check
bun run docs:check
git diff --check
```

Expected: all commands exit zero. Windows production runtime still fails closed because no Worker bridge is admitted yet.

- [ ] **Step 8: Commit Batch 1**

```bash
git add apps/desktop/src/shared/gooseRunnerSource.json \
  workers/goose-runner/Cargo.toml workers/goose-runner/Cargo.lock \
  workers/goose-runner/PATCHES.md scripts/build-goose-runner.mjs \
  apps/desktop/src/main/workers/gooseRunnerArtifact.ts \
  tests/main/gooseRunnerArtifact.test.ts tests/main/gooseRunnerTarget.test.ts \
  tests/security/persistenceArtifactRedactionAbuse.test.ts \
  docs/governance/UPSTREAM_VERSIONS.md \
  docs/upstream/GOOSE_V1.45.0_EVALUATION.md THIRD_PARTY_NOTICES.md
git commit -m "build: admit pinned private Goose runtime"
```

## Batch 2 — Worker adapters and Supervisor relays

### Task 3: Define strict model and capability bridge frames

**Files:**

- Modify: `workers/goose-runner/src/windows_bridge.rs`
- Create: `workers/goose-runner/src/windows_model_bridge.rs`
- Create: `workers/goose-runner/src/windows_capability_bridge.rs`
- Modify: `workers/goose-runner/src/windows_control.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `workers/goose-runner/Cargo.toml`

- [ ] **Step 1: Write RED portable frame tests**

Define one common envelope and two closed vocabularies:

```rust
pub(crate) const WINDOWS_BRIDGE_CONTRACT_VERSION: u64 = 1;
pub(crate) const WINDOWS_BRIDGE_MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;

pub(crate) enum ModelFrame {
    CompletionRequest { request_id: String, lease: String, session_id: String, invocation: Value },
    CompletionResponse { request_id: String, completion: Value },
    Error { request_id: String, code: ModelBridgeErrorCode },
    Cancel { request_id: String, lease: String },
}

pub(crate) enum CapabilityFrame {
    ListRequest { request_id: String, lease: String, session_id: String },
    ListResponse { request_id: String, tools: Vec<Value> },
    CallRequest { request_id: String, lease: String, session_id: String, tool_name: String, arguments: Value },
    CallResponse { request_id: String, is_error: bool, content: String },
    Cancel { request_id: String, lease: String },
    Error { request_id: String, code: CapabilityBridgeErrorCode },
}
```

Tests must reject zero/oversized length, trailing bytes, duplicate JSON keys, unknown keys, unknown kinds, invalid IDs, wrong lease, wrong session, unsupported roles, more than 512 messages, more than 128 tools, more than one model tool call, unknown responses, duplicate responses, and capability tool names outside the six exact IDs.

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_bridge --no-run
```

Expected: compile failure on the new modules/types.

- [ ] **Step 3: Implement the strict codecs and request tracker**

Reuse `windows_control::parse_strict_json()` so duplicate keys are rejected before projection. Every encoder emits a four-byte little-endian length followed by one JSON object. Every decoder checks the length before allocation and requires exact keys for its selected `kind`. Add a bounded pending-request tracker:

```rust
pub(crate) struct PendingRequests {
    ids: HashSet<String>,
    maximum: usize,
}

impl PendingRequests {
    pub(crate) fn begin(&mut self, request_id: &str) -> Result<(), ()>;
    pub(crate) fn complete(&mut self, request_id: &str) -> Result<(), ()>;
    pub(crate) fn cancel(&mut self, request_id: &str) -> Result<(), ()>;
}
```

The JSON `kind` strings are exact and shared with Task 8:
`completion-request`, `completion-response`, `model-error`, `list-request`,
`list-response`, `call-request`, `call-response`, `capability-error`, and
`cancel`. `WindowsBridgeChannel` owns one duplex byte stream and provides this
test-only constructor without creating a socket:

```rust
#[cfg(test)]
pub(crate) fn from_duplex(stream: tokio::io::DuplexStream) -> Self;
```

`begin` rejects duplicates and capacity overflow; `complete` and `cancel` reject unknown IDs. Error enums serialize only closed codes.

- [ ] **Step 4: Add only required direct dependencies**

Use exact versions already present in the admitted lock:

```toml
async-trait = "=0.1.91"
futures = "=0.3.33"
rmcp = { version = "=2.2.0", default-features = false }
tokio-util = { version = "=0.7.19", default-features = false, features = ["rt"] }
```

Retain the exact `goose` and `goose-providers` private runtime lines written by
Task 2.
Run `cargo update --manifest-path workers/goose-runner/Cargo.toml` and inspect
every lock change. Reject unrelated resolver churn; retain only changes
required by the direct declarations and runtime pin.

- [ ] **Step 5: Run GREEN and commit**

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_bridge
bun run goose:runner:format:check
git diff --check
git add workers/goose-runner/src/windows_bridge.rs \
  workers/goose-runner/src/windows_model_bridge.rs \
  workers/goose-runner/src/windows_capability_bridge.rs \
  workers/goose-runner/src/windows_control.rs workers/goose-runner/src/main.rs \
  workers/goose-runner/Cargo.toml workers/goose-runner/Cargo.lock
git commit -m "feat: define Windows authenticated bridge frames"
```

### Task 4: Implement the Worker Provider and MCP adapters

**Files:**

- Modify: `workers/goose-runner/src/windows_model_bridge.rs`
- Modify: `workers/goose-runner/src/windows_capability_bridge.rs`
- Test: portable tests in both files

- [ ] **Step 1: Write RED adapter tests over Tokio duplex streams**

Model tests must call the real Goose `Provider::stream()` method and assert a Main-shaped completion request, then return one text completion and one tool call. Capability tests must call the real `McpClientTrait` methods and assert exact six-tool discovery, one call, cancellation, and unsupported resources/prompts.

```rust
let (worker_side, main_side) = tokio::io::duplex(64 * 1024);
let model_session = Arc::new(OnceCell::new());
model_session.set("session-1".to_string()).unwrap();
let provider = WindowsModelProvider::new(
    WindowsBridgeChannel::from_duplex(worker_side),
    "lease-1".to_string(),
    model_session,
    "actestra-fixed-model".to_string(),
).unwrap();
let stream = provider.stream(&model_config, system, &messages, &tools).await.unwrap();

let (capability_side, capability_main_side) = tokio::io::duplex(64 * 1024);
let capability_session = Arc::new(OnceCell::new());
capability_session.set("session-1".to_string()).unwrap();
let client = WindowsCapabilityClient::new(
    WindowsBridgeChannel::from_duplex(capability_side),
    "lease-1".to_string(),
    capability_session,
).unwrap();
let listed = client.list_tools(session_id, None, CancellationToken::new()).await.unwrap();
assert_eq!(exact_tool_names(&listed), expected_six_names());
```

Assert disconnect and malformed responses return closed `ProviderError`/`ServiceError` values without embedding raw frame bytes.

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_
```

Expected: compile failures for the absent adapter constructors and trait implementations.

- [ ] **Step 3: Implement `WindowsModelProvider`**

The adapter must:

- report the fixed Provider name `actestra`;
- require the fixed model ID supplied in the control frame;
- convert Goose roles/messages/tools to the existing Actestra invocation vocabulary;
- permit only text or one declared tool call in a completion;
- return a single-message Goose stream with bounded usage;
- send `Cancel` when the provider future is dropped or cancellation wins;
- never inspect environment variables or create a socket.

Its public constructor is:

```rust
pub(crate) fn new(
    channel: WindowsBridgeChannel,
    lease: String,
    session_id: Arc<OnceCell<String>>,
    model_id: String,
) -> Result<Self, WindowsModelBridgeError>;
```

- [ ] **Step 4: Implement `WindowsCapabilityClient`**

The adapter must expose one `InitializeResult` with tools enabled and the fixed server name `actestra-capability-proxy`. `list_tools` returns only Main's six supplied tool definitions. `call_tool` carries the Goose tool-call request ID, exact session ID, exact name, and bounded JSON arguments. Default trait implementations continue to reject resources, prompts, subscriptions, sampling, and arbitrary extensions.

Its constructor matches the test in Step 1:

```rust
pub(crate) fn new(
    channel: WindowsBridgeChannel,
    lease: String,
    session_id: Arc<OnceCell<String>>,
) -> Result<Self, WindowsCapabilityBridgeError>;
```

```rust
#[async_trait::async_trait]
impl McpClientTrait for WindowsCapabilityClient {
    async fn list_tools(
        &self,
        session_id: &str,
        next_cursor: Option<String>,
        cancel_token: CancellationToken,
    ) -> Result<ListToolsResult, ServiceError>;

    async fn call_tool(
        &self,
        ctx: &ToolCallContext,
        name: &str,
        arguments: Option<JsonObject>,
        cancel_token: CancellationToken,
    ) -> Result<CallToolResult, ServiceError>;

    fn get_info(&self) -> Option<&InitializeResult>;
}
```

- [ ] **Step 5: Run GREEN and commit**

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_model_bridge
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_capability_bridge
bun run goose:runner:format:check
git diff --check
git add workers/goose-runner/src/windows_model_bridge.rs \
  workers/goose-runner/src/windows_capability_bridge.rs
git commit -m "feat: add Windows Goose Provider and MCP adapters"
```

### Task 5: Add AppContainer-scoped named pipes

**Files:**

- Create: `workers/goose-runner/src/windows_named_pipe.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `workers/goose-runner/Cargo.toml`
- Test: native tests in `windows_named_pipe.rs`

- [ ] **Step 1: Write RED Windows-native tests**

The native matrix must create one AppContainer profile and assert:

1. the owner and exact AppContainer SID can connect;
2. a second client is rejected;
3. a wrong attempt-derived pipe name is rejected;
4. reconnect after disconnect is rejected;
5. capability and model endpoints cannot be crossed;
6. closing the server unblocks pending I/O and leaves no endpoint.

The result type exposes booleans and closed error enums only; no SID, pipe name, PID, handle, path, or raw Win32 error may cross the module boundary.

- [ ] **Step 2: Run the Windows target compile and verify RED**

```bash
cargo check --manifest-path workers/goose-runner/Cargo.toml \
  --target x86_64-pc-windows-msvc --tests --locked
```

Expected: compile failure because `windows_named_pipe` is absent.

- [ ] **Step 3: Implement exact ACL and one-client endpoints**

Use `CreateNamedPipeW` with duplex byte mode, one instance, bounded buffers,
and a security descriptor whose DACL grants only the profile owner and exact
AppContainer SID. Build the ACL with `GetLengthSid`, `InitializeAcl`,
`AddAccessAllowedAce`, `InitializeSecurityDescriptor`, and
`SetSecurityDescriptorDacl`; these APIs are covered by the existing
`Win32_Security`, `Win32_Foundation`, `Win32_Storage_FileSystem`, and
`Win32_System_Pipes` features, so do not add `Win32_Security_Authorization` or
string-SDDL parsing. The endpoint owns its ACL/security-descriptor storage and
every handle through RAII.

```rust
pub(crate) struct WindowsNamedPipeServer;
pub(crate) struct WindowsNamedPipeClient;

impl WindowsNamedPipeServer {
    pub(crate) fn create(
        name: &str,
        owner_sid: PSID,
        app_container_sid: PSID,
    ) -> Result<Self, WindowsNamedPipeError>;
    pub(crate) fn accept_once(&mut self) -> Result<WindowsBridgeChannel, WindowsNamedPipeError>;
}

impl WindowsNamedPipeClient {
    pub(crate) fn connect_once(name: &str) -> Result<WindowsBridgeChannel, WindowsNamedPipeError>;
}
```

Pipe names must equal the names derived by `derive_pipe_names(attempt_id)`. Never grant `ALL APPLICATION PACKAGES`, anonymous, network, or world access.

- [ ] **Step 4: Compile GREEN locally and defer execution claim**

```bash
cargo check --manifest-path workers/goose-runner/Cargo.toml \
  --target x86_64-pc-windows-msvc --tests --locked
bun run goose:runner:format:check
```

Expected: Windows code compiles. Native behavior remains unverified until Windows CI executes it.

- [ ] **Step 5: Commit**

```bash
git add workers/goose-runner/src/windows_named_pipe.rs \
  workers/goose-runner/src/main.rs workers/goose-runner/Cargo.toml \
  workers/goose-runner/Cargo.lock
git commit -m "feat: add AppContainer-scoped Goose named pipes"
```

### Task 6: Refactor the Supervisor to seven channels and sustained relays

**Files:**

- Modify: `workers/goose-runner/src/windows_supervisor.rs`
- Modify: `workers/goose-runner/src/windows_control.rs`
- Modify: `workers/goose-runner/src/main.rs`
- Modify: `scripts/gooseContainmentEvidence.mjs`
- Modify: `tests/scripts/gooseContainmentDiagnostics.test.mjs`
- Modify: `tests/scripts/gooseRunnerWindowsSupervisorContract.test.mjs`

- [ ] **Step 1: Write RED Supervisor and diagnostics tests**

Update the source contract to require seven Main/Supervisor channels and five exact Worker inherited handles: ACP stdin, ACP stdout, stderr, one-shot control, and ready. Parent liveness and Main capability/model channels stay Supervisor-only. Add closed stages:

```text
windows-control-channel-invalid
windows-ready-channel-invalid
windows-capability-pipe-invalid
windows-model-pipe-invalid
windows-acp-relay-failed
windows-capability-relay-failed
windows-model-relay-failed
windows-worker-runtime-failed
windows-runtime-timeout
windows-runtime-cleanup-failed
```

Diagnostics tests must reject any line containing a pipe name, SID, PID, path separator, raw error number, lease, prompt, argument, response, or credential key.

- [ ] **Step 2: Run RED**

```bash
bun run test \
  tests/scripts/gooseRunnerWindowsSupervisorContract.test.mjs \
  tests/scripts/gooseContainmentDiagnostics.test.mjs
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_native_tests --no-run
```

Expected: assertions fail on the current three-handle Worker and ready-on-ACP-stdout path.

- [ ] **Step 3: Add dedicated control and ready handles**

Replace the production `WorkerPipeSet` with an owning set whose inherited list is exact:

```rust
fn inherited_handles(&self) -> [HANDLE; 5] {
    [
        self.worker_stdin,
        self.worker_stdout,
        self.worker_stderr,
        self.worker_control_read,
        self.worker_ready_write,
    ]
}
```

Pass the two dedicated numeric handle values in the exact Worker command line; update `WindowsMode::parse()` to accept only the production Worker switch plus those two bounded decimal values. Worker stdout is ACP-only. The Supervisor consumes ready and never forwards it to Main.

- [ ] **Step 4: Add two named pipes and three relays**

After creating the AppContainer profile, create the capability and model named-pipe servers with its exact SID. Launch and verify the suspended Worker, write control, resume once, accept both clients, consume ready, then start:

1. Main ACP stdin ↔ Worker ACP stdin and Worker ACP stdout ↔ Main ACP stdout;
2. Main capability channel ↔ capability named pipe;
3. Main model channel ↔ model named pipe.

Use bounded read buffers and no semantic JSON projection in the Supervisor. A disconnect, second connection, oversized frame, partial write, relay timeout, Worker exit, or liveness close terminates the Job and every relay.

- [ ] **Step 5: Preserve containment and cleanup assertions**

Extend native tests to assert `TokenIsAppContainer == 1`, exact Job limits, assign-before-resume, one resume, exact handle list, environment canary absence, direct-network denial, parent-death cleanup, and no residual profile or process. Cleanup must be idempotent and retain the original failure plus a separate cleanup failure when both occur.

- [ ] **Step 6: Run GREEN and commit**

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
cargo check --manifest-path workers/goose-runner/Cargo.toml \
  --target x86_64-pc-windows-msvc --tests --locked
bun run test \
  tests/scripts/gooseRunnerWindowsSupervisorContract.test.mjs \
  tests/scripts/gooseContainmentDiagnostics.test.mjs
bun run goose:runner:format:check
git diff --check
git add workers/goose-runner/src/windows_supervisor.rs \
  workers/goose-runner/src/windows_control.rs workers/goose-runner/src/main.rs \
  scripts/gooseContainmentEvidence.mjs \
  tests/scripts/gooseContainmentDiagnostics.test.mjs \
  tests/scripts/gooseRunnerWindowsSupervisorContract.test.mjs
git commit -m "feat: relay Windows Goose runtime through supervisor"
```

### Task 7: Start the adapted Goose ACP runtime inside the Worker

**Files:**

- Modify: `workers/goose-runner/src/main.rs`
- Modify: `workers/goose-runner/src/windows_supervisor.rs`
- Modify: `workers/goose-runner/src/windows_control.rs`
- Modify: `workers/goose-runner/src/windows_model_bridge.rs`
- Modify: `workers/goose-runner/src/windows_capability_bridge.rs`
- Test: portable Rust tests and Windows-native startup test

- [ ] **Step 1: Write RED Worker startup-order tests**

Lock this order with an injectable startup state machine:

```rust
assert_eq!(observed, [
    StartupStage::ControlValidated,
    StartupStage::BoundaryVerified,
    StartupStage::CapabilityConnected,
    StartupStage::ModelConnected,
    StartupStage::AdaptersConstructed,
    StartupStage::ReadyWritten,
    StartupStage::AcpServing,
]);
```

Add a failure test at every transition and assert no later transition occurs. Add an end-to-end in-process ACP test that initializes Goose, opens an MCP-free session, and discovers the injected extension.

- [ ] **Step 2: Run RED**

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked windows_worker_runtime
```

Expected: compile failure for the startup state machine and runtime entry.

- [ ] **Step 3: Implement the production Worker entry**

`run_worker()` must read control from the dedicated handle, verify its boundary,
connect once to both pipes, create the shared session-ID cell, construct both
adapters, and call the private runtime seam:

```rust
let adapter = goose::acp::server::AcpRuntimeAdapter {
    provider_id: "actestra".to_string(),
    model_config: goose_providers::model::ModelConfig::new(&control.model_id),
    provider: Arc::new(model_provider),
    extension_name: "actestra-capability-proxy".to_string(),
    extension_config: injected_extension_config(),
    extension_client: Arc::new(capability_client),
    data_dir: PathBuf::from(&control.private_root).join("goose-data"),
    config_dir: PathBuf::from(&control.private_root).join("goose-config"),
};
write_ready(ready_handle)?;
goose::acp::server::run_with_runtime_adapter(adapter).await
```

Create both directories inside the admitted private attempt root before Goose
startup and reject symlinks or paths outside that root. Cover the exact fixed
model ID and private state paths in the private runtime and Worker tests. Do not read
`GOOSE_PROVIDER`, `GOOSE_MODEL`, `OPENAI_BASE_URL`, global Goose data/config
paths, or an API key.

- [ ] **Step 4: Run local GREEN and commit Batch 2**

```bash
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
cargo check --manifest-path workers/goose-runner/Cargo.toml \
  --target x86_64-pc-windows-msvc --tests --locked
bun run goose:runner:format:check
git diff --check
git add workers/goose-runner/src/main.rs \
  workers/goose-runner/src/windows_supervisor.rs \
  workers/goose-runner/src/windows_control.rs \
  workers/goose-runner/src/windows_model_bridge.rs \
  workers/goose-runner/src/windows_capability_bridge.rs
git commit -m "feat: run adapted Goose ACP in Windows worker"
```

Expected: portable and cross-target compile evidence is GREEN. Windows native runtime behavior is still not claimed.

## Batch 3 — Main-owned authenticated composition

### Task 8: Define matching strict TypeScript bridge contracts

**Files:**

- Create: `apps/desktop/src/main/workers/gooseAuthenticatedBridgeProtocol.ts`
- Create: `tests/main/gooseAuthenticatedBridgeProtocol.test.ts`

- [ ] **Step 1: Write RED protocol tests**

Use the same kinds, exact keys, limits, IDs, lease, session, model, and six-tool rules as Task 3. Tests must include raw duplicate-key JSON, wrong length, trailing bytes, unknown fields, stale response, duplicate response, cross-pipe frame, wrong lease/session, unsupported role, undeclared tool, and oversize content.

- [ ] **Step 2: Run RED**

```bash
bun run test tests/main/gooseAuthenticatedBridgeProtocol.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement exact codecs and strict JSON admission**

Export only closed types and encoders/decoders:

```ts
export const GOOSE_AUTHENTICATED_BRIDGE_VERSION = 1 as const;
export const GOOSE_AUTHENTICATED_BRIDGE_MAX_FRAME_BYTES = 2 * 1024 * 1024;

export type GooseWindowsModelFrame =
  | Readonly<{
      contractVersion: 1;
      kind: "completion-request";
      requestId: string;
      lease: string;
      sessionId: string;
      invocation: ActestraMainModelInvocation;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "completion-response";
      requestId: string;
      completion: ActestraMainModelCompletion;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "model-error";
      requestId: string;
      code: GooseWindowsModelErrorCode;
    }>
  | Readonly<{
      contractVersion: 1;
      kind: "cancel";
      requestId: string;
      lease: string;
    }>;

export type GooseWindowsCapabilityFrame =
  | GooseWindowsCapabilityListRequest
  | GooseWindowsCapabilityListResponse
  | GooseWindowsCapabilityCallRequest
  | GooseWindowsCapabilityCallResponse
  | GooseWindowsCapabilityCancel
  | GooseWindowsCapabilityError;
```

Before `JSON.parse`, scan JSON tokens with a bounded recursive parser that rejects duplicate object keys, invalid Unicode, excess depth, and trailing tokens. Then run exact-key and semantic validators. Never log raw bytes.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun run test tests/main/gooseAuthenticatedBridgeProtocol.test.ts
bun run format:check
bun run lint
bun run typecheck
git add apps/desktop/src/main/workers/gooseAuthenticatedBridgeProtocol.ts \
  tests/main/gooseAuthenticatedBridgeProtocol.test.ts
git commit -m "feat: define Main Windows bridge protocol"
```

### Task 9: Implement Main model and capability bridge hosts

**Files:**

- Create: `apps/desktop/src/main/workers/gooseWindowsModelBridgeHost.ts`
- Create: `apps/desktop/src/main/workers/gooseWindowsCapabilityBridgeHost.ts`
- Create: `tests/main/gooseWindowsModelBridgeHost.test.ts`
- Create: `tests/main/gooseWindowsCapabilityBridgeHost.test.ts`

- [ ] **Step 1: Write RED host tests with duplex streams**

The model host tests cover success, broker refusal, malformed request, cancellation, unknown response, close, and exact counter semantics. The capability host tests cover exact six-tool list, one real invoker call, cancellation, unsupported tool, wrong session/lease, and idempotent close.

```ts
expect(host.servedInferenceCount).toBe(1);
expect(host.refusedInferenceCount).toBe(0);
expect(host.rejectedRequestCount).toBe(0);
expect(discoveredNames).toEqual([...CODING_TOOL_IDS]);
expect(invokeTool).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run RED**

```bash
bun run test \
  tests/main/gooseWindowsModelBridgeHost.test.ts \
  tests/main/gooseWindowsCapabilityBridgeHost.test.ts
```

Expected: module-not-found failures.

- [ ] **Step 3: Implement the model host around the existing invoker**

Use the existing `GooseLoopbackModelInvoker` type and `assertActestraMainModelCompletion`. Maintain one `AbortController` per request. Classify failures exactly as the loopback server does:

```ts
export interface GooseWindowsModelBridgeHost {
  bindSession(sessionId: string): void;
  readonly servedInferenceCount: number;
  readonly refusedInferenceCount: number;
  readonly rejectedRequestCount: number;
  close(): Promise<void>;
}
```

A parse/contract failure increments rejected; an invoker or completion-contract failure increments refused; only a validated response increments served. Responses contain no Provider credential or raw failure.

- [ ] **Step 4: Implement the capability host around `GooseMcpToolInvoker`**

The list response is built from `CODING_TOOL_IDS` and the existing `codingToolDefinition()` schemas. The call path validates session/lease/name/arguments, calls the existing invoker with an AbortSignal, and serializes only `{isError, content}`. It must not read a workspace directly.

```ts
export interface GooseWindowsCapabilityBridgeHost {
  bindSession(sessionId: string): void;
  waitForToolsList(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}
```

- [ ] **Step 5: Run GREEN and commit**

```bash
bun run test \
  tests/main/gooseAuthenticatedBridgeProtocol.test.ts \
  tests/main/gooseWindowsModelBridgeHost.test.ts \
  tests/main/gooseWindowsCapabilityBridgeHost.test.ts
bun run format:check
bun run lint
bun run typecheck
git add apps/desktop/src/main/workers/gooseWindowsModelBridgeHost.ts \
  apps/desktop/src/main/workers/gooseWindowsCapabilityBridgeHost.ts \
  tests/main/gooseWindowsModelBridgeHost.test.ts \
  tests/main/gooseWindowsCapabilityBridgeHost.test.ts
git commit -m "feat: host Windows Goose bridges in Main"
```

### Task 10: Add explicit transport modes and seven process channels

**Files:**

- Create: `apps/desktop/src/main/workers/gooseSessionTransport.ts`
- Modify: `apps/desktop/src/main/workers/gooseRunnerProcess.ts`
- Modify: `tests/main/gooseRunnerLifecycle.test.ts`
- Modify: `tests/main/gooseRunnerWindowsBridge.test.ts`
- Modify: `tests/main/gooseRunnerEnvironmentIsolation.test.ts`
- Create: `tests/main/gooseSessionTransport.test.ts`
- Create: `tests/main/gooseRunnerWindowsChannelNative.test.ts`

- [ ] **Step 1: Write RED transport-selection and spawn tests**

Lock exact target mapping:

```ts
expect(resolveGooseSessionTransportMode("aarch64-apple-darwin")).toBe(
  "macos-loopback",
);
expect(resolveGooseSessionTransportMode("x86_64-unknown-linux-gnu")).toBe(
  "linux-relay",
);
expect(resolveGooseSessionTransportMode("x86_64-pc-windows-msvc")).toBe(
  "windows-authenticated",
);
```

For Windows assert seven channels in order: stdin, stdout, stderr, control, parent liveness, capability, model. Assert the last two are duplex, not represented in the environment, and attached only to the Main hosts. Re-run the full parent-environment and credential canary sweep.

Add a `process.platform === "win32"` native test which spawns a Node child with
fd 5 and fd 6 set to `"pipe"`. The child opens each numeric fd for both read and
write, receives a different bounded nonce on each channel, and echoes a
channel-tagged digest. The parent must read both exact replies, observe no
cross-channel bytes, and close with no residual child. This test is skipped on
non-Windows hosts but required in the Windows authenticated-runtime CI job. If
either extra fd is not truly duplex on `windows-2025`, stop and revise the
seven-channel specification to separate read/write channels; do not add an
environment, file, socket, or loopback fallback.

- [ ] **Step 2: Run RED**

```bash
bun run test \
  tests/main/gooseSessionTransport.test.ts \
  tests/main/gooseRunnerLifecycle.test.ts \
  tests/main/gooseRunnerWindowsBridge.test.ts \
  tests/main/gooseRunnerEnvironmentIsolation.test.ts \
  tests/main/gooseRunnerWindowsChannelNative.test.ts
```

Expected: failures on absent explicit mode and current five-channel spawn.

- [ ] **Step 3: Implement the transport union**

```ts
export type GooseSessionTransportMode =
  "macos-loopback" | "linux-relay" | "windows-authenticated";

export interface GooseCapabilityBoundary {
  readonly sessionEndpoint?: Readonly<{ url: string; attemptLease: string }>;
  bindSession(sessionId: string): void;
  waitForToolsList(timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export interface GooseModelBoundary {
  readonly runnerBinding?: GooseRunnerModelBinding;
  bindSession(sessionId: string): void;
  readonly servedInferenceCount: number;
  readonly refusedInferenceCount: number;
  readonly rejectedRequestCount: number;
  close(): Promise<void>;
}
```

macOS wraps existing loopback servers. Linux wraps existing socket-relayed loopback servers. Windows wraps the new channel hosts and exposes no URL.

- [ ] **Step 4: Spawn and attach all seven Windows channels**

Use:

```ts
stdio: ["pipe", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"];
```

Write the control frame to fd 3, retain fd 4 as parent liveness, attach fd 5 to the capability host, and attach fd 6 to the model host. `NodeGooseAcpTransport.close()` closes both hosts and all three extra channels, then waits for the Supervisor; failure aggregation must retain both original and cleanup errors.

- [ ] **Step 5: Run GREEN and commit**

```bash
bun run test \
  tests/main/gooseSessionTransport.test.ts \
  tests/main/gooseRunnerLifecycle.test.ts \
  tests/main/gooseRunnerWindowsBridge.test.ts \
  tests/main/gooseRunnerEnvironmentIsolation.test.ts \
  tests/main/gooseRunnerWindowsChannelNative.test.ts
bun run format:check
bun run lint
bun run typecheck
git diff --check
git add apps/desktop/src/main/workers/gooseSessionTransport.ts \
  apps/desktop/src/main/workers/gooseRunnerProcess.ts \
  tests/main/gooseSessionTransport.test.ts \
  tests/main/gooseRunnerLifecycle.test.ts \
  tests/main/gooseRunnerWindowsBridge.test.ts \
  tests/main/gooseRunnerEnvironmentIsolation.test.ts \
  tests/main/gooseRunnerWindowsChannelNative.test.ts
git commit -m "feat: select authenticated Windows Goose transport"
```

### Task 11: Compose an MCP-free Windows ACP session

**Files:**

- Modify: `apps/desktop/src/main/workers/gooseAcpHandshake.ts`
- Modify: `apps/desktop/src/main/workers/gooseMcpSessionComposition.ts`
- Modify: `tests/main/gooseAcpHandshake.test.ts`
- Modify: `tests/main/gooseMcpSessionComposition.test.ts`
- Modify: `tests/main/gooseLoopbackModelServer.test.ts`

- [ ] **Step 1: Write RED cross-mode composition tests**

Use a discriminated session option:

```ts
export type GooseAcpSessionOptions =
  | Readonly<{
      transport: "mcp-http";
      workspaceDirectory: string;
      capabilityProxyUrl: string;
      attemptLease: string;
      timeoutMs?: number;
    }>
  | Readonly<{
      transport: "injected";
      workspaceDirectory: string;
      timeoutMs?: number;
    }>;
```

Assert Windows `session/new.params.mcpServers` is `[]`, no URL or lease enters ACP, exact tool discovery still returns six names, model refused/rejected counters produce the same durable codes, and cancellation closes both in-flight bridge requests. Existing macOS and Linux request snapshots must remain unchanged.

- [ ] **Step 2: Run RED**

```bash
bun run test \
  tests/main/gooseAcpHandshake.test.ts \
  tests/main/gooseMcpSessionComposition.test.ts \
  tests/main/gooseLoopbackModelServer.test.ts
```

Expected: failures on the absent `injected` session path and Windows boundary adapters.

- [ ] **Step 3: Implement platform-neutral composition**

`openGooseMcpSessionComposition()` selects from the artifact target, creates the corresponding capability/model boundaries, passes the Windows host attachment to `openGooseRunnerHandshake()`, binds both boundaries to the returned ACP session ID, waits for exact tool discovery, and exposes the existing public composition shape. Team and coding journey callers receive no new platform argument.

Counter evaluation remains:

```ts
if (
  model.servedInferenceCount === servedBefore &&
  result.stopReason !== "cancelled"
) {
  if (model.refusedInferenceCount > refusedBefore) {
    throw new GooseMcpSessionCompositionError(
      "model-completion-refused",
      message,
    );
  }
  if (model.rejectedRequestCount > rejectedBefore) {
    throw new GooseMcpSessionCompositionError(
      "model-request-rejected",
      message,
    );
  }
}
```

- [ ] **Step 4: Run Batch 3 GREEN and commit**

```bash
bun run test \
  tests/main/gooseAuthenticatedBridgeProtocol.test.ts \
  tests/main/gooseWindowsModelBridgeHost.test.ts \
  tests/main/gooseWindowsCapabilityBridgeHost.test.ts \
  tests/main/gooseSessionTransport.test.ts \
  tests/main/gooseRunnerLifecycle.test.ts \
  tests/main/gooseRunnerWindowsBridge.test.ts \
  tests/main/gooseRunnerEnvironmentIsolation.test.ts \
  tests/main/gooseRunnerWindowsChannelNative.test.ts \
  tests/main/gooseAcpHandshake.test.ts \
  tests/main/gooseMcpSessionComposition.test.ts \
  tests/main/gooseLoopbackModelServer.test.ts \
  tests/main/gooseCodingToolInvoker.test.ts
bun run format:check
bun run lint
bun run typecheck
git diff --check
git add apps/desktop/src/main/workers/gooseAcpHandshake.ts \
  apps/desktop/src/main/workers/gooseMcpSessionComposition.ts \
  tests/main/gooseAcpHandshake.test.ts \
  tests/main/gooseMcpSessionComposition.test.ts \
  tests/main/gooseLoopbackModelServer.test.ts
git commit -m "feat: compose MCP-free Windows Goose session"
```

## Batch 4 — exact Windows integration, CI, and current truth

### Task 12: Add exact-artifact Windows runtime evidence

**Files:**

- Create: `tests/main/gooseRunnerWindowsNative.integration.ts`
- Create: `scripts/gooseWindowsRuntimeEvidence.mjs`
- Create: `scripts/run-goose-runner-windows-runtime.mjs`
- Create: `tests/scripts/gooseWindowsRuntimeEvidence.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write RED evidence admission tests**

The evidence record contains only:

```ts
type GooseWindowsRuntimeEvidence = Readonly<{
  schemaVersion: 1;
  status: "verified";
  targetTriple: "x86_64-pc-windows-msvc";
  sourceCommit: string;
  gooseBaseCommit: string;
  gooseRuntimeCommit: string;
  goosePatchSha256: string;
  manifestSha256: string;
  executableSha256: string;
  containmentEvidenceSha256: string;
  acpInitialized: true;
  mcpFreeSessionCreated: true;
  exactToolCount: 6;
  readToolCompleted: true;
  approvedWriteToolCompleted: true;
  cancellationObserved: true;
  parentDeathCleanupObserved: true;
  credentialCanaryAbsent: true;
  environmentCanaryAbsent: true;
  directNetworkDenied: true;
  originalWorkspaceUnchanged: true;
  residualProcessCount: 0;
}>;
```

Tests reject extra keys, false booleans, wrong digests, nonzero residuals, wrong target, raw paths, PIDs, SIDs, pipe names, prompts, model output, tool arguments/results, API keys, and raw errors.

- [ ] **Step 2: Run RED**

```bash
bun run test tests/scripts/gooseWindowsRuntimeEvidence.test.mjs
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the deterministic native integration**

The test must use the admitted runner artifact, a real isolated Git worktree, the real `GooseCodingToolInvoker`/Tool Gateway path, and a deterministic Main model invoker. The invoker sequence is:

1. request `actestra.coding.file-read` for an existing worktree file;
2. return a short assistant acknowledgement;
3. request `actestra.coding.file-write` for `windows-runtime-acceptance.txt`;
4. wait for the real approval handler to return `approved`;
5. return a final assistant completion;
6. start another prompt, block the invoker, cancel, and observe ACP cancellation.

Assert the isolated worktree contains the exact new bytes while the source checkout HEAD, status, and original file set remain unchanged. Close Main liveness in a second run and assert the entire Job exits. Emit only the bounded evidence fields above.

- [ ] **Step 4: Implement the runner and binder**

Add:

```json
"goose:runner:integration:windows": "node scripts/run-goose-runner-windows-runtime.mjs"
```

The runner re-admits the artifact, reads the trusted manifest digest from an explicit environment variable, requires the exact containment evidence file, invokes only the integration test, validates its result with `gooseWindowsRuntimeEvidence.mjs`, and writes one canonical JSON record to stdout.

- [ ] **Step 5: Run portable GREEN and commit**

```bash
bun run test tests/scripts/gooseWindowsRuntimeEvidence.test.mjs
bun run format:check
bun run lint
bun run typecheck
git diff --check
git add tests/main/gooseRunnerWindowsNative.integration.ts \
  scripts/gooseWindowsRuntimeEvidence.mjs \
  scripts/run-goose-runner-windows-runtime.mjs \
  tests/scripts/gooseWindowsRuntimeEvidence.test.mjs package.json
git commit -m "test: bind Windows Goose runtime evidence"
```

### Task 13: Add the exact-head Windows CI gate

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `tests/scripts/p8NativeBuildWiring.test.mjs`
- Modify: `scripts/check-p8-platform-matrix.mjs`
- Modify: `tests/scripts/p8PlatformMatrix.test.mjs`

- [ ] **Step 1: Write RED workflow-contract tests**

Require a `windows-2025` job that, in order, installs the pinned toolchain, runs native tests, builds, freezes the lock, admits the artifact, runs containment, runs authenticated runtime composition against the same artifact, re-admits it, and uploads evidence only on success.

- [ ] **Step 2: Run RED**

```bash
bun run test \
  tests/scripts/p8NativeBuildWiring.test.mjs \
  tests/scripts/p8PlatformMatrix.test.mjs
```

Expected: failure because the authenticated-runtime job is absent.

- [ ] **Step 3: Add the Windows runtime job**

Add a separate job named `P8.2 Windows x64 Goose authenticated runtime`. It must build once and bind both containment and runtime evidence to that exact artifact. The core steps are:

```yaml
- name: Build and admit exact Windows Goose runner
  run: |
    bun run test tests/main/gooseRunnerWindowsChannelNative.test.ts
    bun run goose:runner:build
    git diff --exit-code -- workers/goose-runner/Cargo.lock
    bun run goose:runner:admit-build

- name: Run exact Windows containment acceptance
  shell: pwsh
  run: |
    bun run goose:runner:containment:accept | Tee-Object -FilePath containment-evidence.json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

- name: Run authenticated Windows Goose runtime
  shell: pwsh
  run: |
    $manifest = (Get-FileHash -Algorithm SHA256 .actestra/goose-runner/x86_64-pc-windows-msvc/actestra-goose-runner.manifest.json).Hash.ToLowerInvariant()
    $env:ACTESTRA_GOOSE_RUNNER_MANIFEST_SHA256 = $manifest
    $env:ACTESTRA_GOOSE_CONTAINMENT_EVIDENCE_PATH = "$pwd/containment-evidence.json"
    bun run goose:runner:integration:windows | Tee-Object -FilePath windows-runtime-evidence.json
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

- name: Re-admit exact Windows Goose runner
  run: bun run goose:runner:admit-build
```

Upload `windows-runtime-evidence.json` only under `if: success()` with a three-day retention and no compression. Do not pass any Provider credential.

- [ ] **Step 4: Run local workflow checks and commit**

```bash
bun run test \
  tests/scripts/p8NativeBuildWiring.test.mjs \
  tests/scripts/p8PlatformMatrix.test.mjs
bun run p8:contract:check
bun run docs:check
git diff --check
git add .github/workflows/ci.yml \
  tests/scripts/p8NativeBuildWiring.test.mjs \
  scripts/check-p8-platform-matrix.mjs \
  tests/scripts/p8PlatformMatrix.test.mjs
git commit -m "ci: verify Windows Goose authenticated runtime"
```

### Task 14: Run all gates, update architecture truth, and close only this slice

**Files:**

- Modify: `docs/architecture/decisions/0024-minimal-goose-acp-runner.md`
- Modify: `docs/architecture/SYSTEM_OVERVIEW.md`
- Modify: `docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md`
- Modify: `docs/roadmap/DEVELOPMENT_SEQUENCE.md`
- Modify: `docs/PROJECT_STATUS.md`
- Modify: `docs/README.md` if a new accepted ADR is added instead of amending ADR-0024

- [ ] **Step 1: Update accepted architecture without claiming unrun evidence**

Document the fixed private runtime repository, default-off seam,
Main/Supervisor/Worker ownership, seven channels, two named pipes, MCP-free
Windows session, exact six-tool boundary, failure vocabulary, rollback, and
non-goals. Before Windows CI runs, `PROJECT_STATUS.md` must say implementation
is locally validated but native runtime evidence is pending.

- [ ] **Step 2: Run focused and full local gates**

```bash
cargo fmt --manifest-path workers/goose-runner/Cargo.toml -- --check
cargo test --manifest-path workers/goose-runner/Cargo.toml --locked
cargo check --manifest-path workers/goose-runner/Cargo.toml \
  --target x86_64-pc-windows-msvc --tests --locked
bun run test \
  tests/main/gooseAuthenticatedBridgeProtocol.test.ts \
  tests/main/gooseWindowsModelBridgeHost.test.ts \
  tests/main/gooseWindowsCapabilityBridgeHost.test.ts \
  tests/main/gooseSessionTransport.test.ts \
  tests/main/gooseRunnerLifecycle.test.ts \
  tests/main/gooseRunnerWindowsBridge.test.ts \
  tests/main/gooseRunnerEnvironmentIsolation.test.ts \
  tests/main/gooseRunnerWindowsChannelNative.test.ts \
  tests/main/gooseAcpHandshake.test.ts \
  tests/main/gooseMcpSessionComposition.test.ts \
  tests/scripts/gooseWindowsRuntimeEvidence.test.mjs \
  tests/scripts/p8NativeBuildWiring.test.mjs \
  tests/scripts/p8PlatformMatrix.test.mjs
bun run docs:check
bun run check
git diff --check
```

Expected: every command exits zero. Report the cross-target check as compilation evidence, not Windows execution evidence.

- [ ] **Step 3: Commit documentation and push the exact implementation head**

```bash
git add docs/architecture/decisions/0024-minimal-goose-acp-runner.md \
  docs/architecture/SYSTEM_OVERVIEW.md \
  docs/product/P8_CROSS_PLATFORM_INTERNAL_BETA.md \
  docs/roadmap/DEVELOPMENT_SEQUENCE.md docs/PROJECT_STATUS.md
git commit -m "docs: define Windows authenticated Goose runtime"
implementation_head="$(git rev-parse HEAD)"
git push -u origin codex/p8-2c-windows-runtime-composition
```

- [ ] **Step 4: Open a draft PR and require exact-head CI**

```bash
pr_url="$(gh pr create --draft \
  --base main \
  --head codex/p8-2c-windows-runtime-composition \
  --title "feat: compose authenticated Windows Goose runtime" \
  --body-file docs/superpowers/specs/2026-08-19-windows-authenticated-runtime-composition-design.md)"
gh pr checks "$pr_url" --watch
test "$(gh pr view "$pr_url" --json headRefOid --jq .headRefOid)" = "$implementation_head"
```

Expected: all jobs, including Windows build, containment, and authenticated runtime, pass at the exact head.

- [ ] **Step 5: Inspect and record real Windows evidence**

Use `gh run list --branch codex/p8-2c-windows-runtime-composition` and `gh run
view` to obtain the exact run/job IDs. Download the success-only runtime
Artifact into a temporary directory, validate it with
`gooseWindowsRuntimeEvidence.mjs`, and record the real run ID, job ID, Artifact
name, manifest/executable/source/runtime/diff digests, and observed
deterministic journey in `PROJECT_STATUS.md`.

The allowed claim is exactly:

> The admitted Windows x64 Goose Worker completed the deterministic Actestra model and Tool Gateway composition inside the verified AppContainer and Job boundary, with no direct network or credential authority and with bounded lifecycle cleanup.

The status must also say that Windows Electron package acceptance, overall P8.2, P8.3 candidate integrity/signing, P8.4 clean-machine/real-provider/manual Team acceptance, release, deployment, and user acceptance remain open.

- [ ] **Step 6: Re-run documentation checks, commit evidence, and re-run exact-head CI**

```bash
bun run docs:check
git diff --check
git add docs/PROJECT_STATUS.md
git commit -m "docs: record Windows Goose runtime evidence"
evidence_head="$(git rev-parse HEAD)"
git push
gh pr checks "$pr_url" --watch
test "$(gh pr view "$pr_url" --json headRefOid --jq .headRefOid)" = "$evidence_head"
```

- [ ] **Step 7: Merge only after review and verify independent merged-main CI**

After approval:

```bash
gh pr ready "$pr_url"
gh pr merge "$pr_url" --squash --delete-branch
merged_main="$(git ls-remote origin refs/heads/main | cut -f 1)"
gh run list --branch main --commit "$merged_main" --limit 5
```

Wait for the independent `main` run and require every job to pass. Update `PROJECT_STATUS.md` once more only if the merged commit/run identifiers differ from the PR evidence record, then send that documentation-only update through its own green CI. Do not create a tag, candidate, release, or deployment in this plan.

## Self-review checklist

- [x] **Spec coverage:** Every invariant, private-runtime/provenance requirement,
      seven-channel topology item, model/capability bridge rule, authentication
      rule, lifecycle rule, portable test, Windows-native test, required gate,
      documentation update, exit claim, and non-goal maps to Tasks 1–14.
- [x] **Placeholder scan:** Run the command below and remove any planning placeholder language from executable instructions or committed examples.

```bash
rg -n '\b(T[B]D|T[O]DO|F[I]XME|i[m]plement l[a]ter|f[i]ll in d[e]tails|s[i]milar to)\b' \
  docs/superpowers/plans/2026-08-19-windows-authenticated-runtime-composition.md
```

Expected: no matches.

- [x] **Type/signature consistency:** Confirm the private runtime's
      `AcpRuntimeAdapter`, Rust frame kinds, TypeScript frame kinds, transport union,
      boundary interfaces, evidence keys, tool IDs, and diagnostic codes use the
      same names in every task.
- [x] **No authority widening:** Confirm no planned file under Renderer/preload or `foundation/`, no HTTP fallback on Windows, no credential/environment propagation, no original-workspace path in the Worker/Supervisor, no generic shell substitution, and no second agent framework.
- [x] **Document validation:** Run root formatting, Markdown links, P8 matrix, and `git diff --check` before committing this plan.
