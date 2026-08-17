# P8.2b Ubuntu AppArmor User-Namespace Bootstrap Design

**Status:** Approved for implementation; P8.2b acceptance remains open

**Date:** 2026-08-17

**Baseline:** `codex/p8-2b-runtime-containment@70548236aa83066fc7a338c26f2b473466e37f88`

**Phase:** P8.2b — Goose Linux runtime containment

**Related:** [P8.2b Goose containment design](2026-08-17-p8-2b-goose-cross-platform-containment-design.md), [P8.2b Linux runtime composition design](2026-08-17-p8-2b-linux-runtime-composition-design.md), [P8.2b Linux process/resource equivalence design](2026-08-17-p8-2b-linux-process-resource-equivalence-design.md), [ADR-0024](../../architecture/decisions/0024-minimal-goose-acp-runner.md), [ADR-0028](../../architecture/decisions/0028-p7-worker-resource-and-process-reliability.md), and [ADR-0030](../../architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md)

## Decision context

The exact-head Ubuntu evidence has narrowed the open Linux runtime blocker to
the host's user-namespace admission boundary. Pull-request run
[`32016449172`](https://github.com/Ablankpaper/actestra-desktop/actions/runs/32016449172)
builds and admits the exact `x86_64-unknown-linux-gnu` Goose Artifact, but its
authenticated integration job `95346841490` returns only the public closed
result `integration-runtime-network-failed`. The runner enters
`unshare(CLONE_NEWUSER)` before the Linux mount/network setup can begin. Ubuntu
24.04's AppArmor restricted-unprivileged-userns policy denies an unprofiled,
unprivileged executable in the hosted runner. This is the same class of
failure documented by the
[Ubuntu/AppArmor user-namespace policy](https://gitlab.com/apparmor/apparmor/-/wikis/unprivileged_userns_restriction)
and by [GitHub runner-images issue 10443](https://github.com/actions/runner-images/issues/10443)
for Ubuntu 24.04.

The current implementation intentionally has no root, sudo, setuid helper,
container, host-network fallback, or host bootstrap. It therefore cannot make
the first namespace operation succeed on an Ubuntu host where the restriction
is enabled and no profile grants the exact executable permission. Disabling
the system restriction would make the probe pass by weakening the host rather
than by proving the product boundary, and is not an acceptable repair.

There is a second implementation constraint. Main currently copies the
admitted runner into a user-writable attempt-private directory named
`goose-attempt-*` before launch. An AppArmor rule attached to a stable install
path cannot safely authorize that copy: a wildcard over a user-writable path
would grant user-namespace creation to arbitrary bytes selected by the user.

This document is a narrow successor amendment for that host-authority gap. It
does not replace the accepted AionUi, Main/Core, Tool Gateway, ACP, persistence,
or Goose framework. It changes only the Linux packaged runner identity and its
installation-time user-namespace authority. The existing Darwin path remains
the reference path and remains byte- and semantically stable.

## Amendment scope and precedence

The earlier P8.2b Linux designs reject a privileged runtime helper, root daemon,
setuid runner, container, mutable cgroup bootstrap, and permissive host fallback.
Those decisions remain unchanged. This amendment replaces only their broader
assumption that Ubuntu could establish every prerequisite with no installation-
time system policy. On Ubuntu 24.04, loading a vendor AppArmor profile is a
normal DEB installation responsibility and is required before an ordinary user
can exercise the already-selected rootless namespace composition.

This approved amendment supersedes the earlier no-bootstrap assumption only for
the Ubuntu DEB installation-time AppArmor profile described here. Linux runtime
admission remains disabled until the implementation and its exact native
evidence satisfy the acceptance conditions below. Approval authorizes this
implementation plan; it is not a P8.2b completion claim.

## Goals

1. Allow the exact packaged Actestra Goose runner to create an unprivileged
   user namespace on Ubuntu 24.04 when the host's AppArmor restriction is
   enabled.
2. Keep the runner ordinary-user code at runtime. Installation may use the
   package manager's existing privileged installation phase; no runtime root
   authority is introduced.
3. Bind the permission to one stable, root-owned, exact-digest runner path,
   never to an attempt-generated or user-writable path.
4. Preserve the existing Linux namespace, loopback relay, Landlock, seccomp,
   RLIMIT, parent-death, ACP, cleanup, and redaction contracts.
5. Make a missing profile, changed profile, changed ownership, changed
   executable, wrong path, or wrong runner identity fail closed before a Goose
   attempt is admitted.
6. Let Ubuntu CI reproduce the installed-user context with the same checked-in
   profile and a root-owned installation path, while using sudo only for the
   ephemeral CI bootstrap and teardown.

## Non-goals and hard boundaries

- No modification under `foundation/`.
- No runtime `sudo`, setuid runner, root daemon, privileged helper, container,
  Docker/Podman dependency, or host-network fallback.
- No global sysctl change. CI must leave
  `kernel.apparmor_restrict_unprivileged_userns=1` enabled while testing.
- No AppArmor permission for arbitrary network, mount, capability, ptrace,
  file, shell, or executable access. The profile grants only the user-namespace
  operation; Landlock, seccomp, namespace setup, and Main-owned relays remain
  the effective runtime boundary.
- No renderer, preload, provider, credential, persistence, or UI authority.
- No Windows implementation, P8.3 candidate/signing work, P8.4 clean-machine
  acceptance, or real-provider acceptance in this slice.
- No production Linux admission from an unpacked development directory or an
  environment-selected arbitrary runner. Such launches remain unavailable.

## Chosen installation topology

The only Linux runtime target in this amendment is the accepted Ubuntu DEB
target. Electron-builder installs the application below its normal fixed
prefix, so the package-owned Goose Artifact has this exact layout:

```text
/opt/Actestra/
├── Actestra
└── resources/
    ├── app.asar
    ├── apparmor-profile
    ├── actestra-goose-runner-admission.json
    └── actestra-goose-runner/
        ├── actestra-goose-runner
        ├── actestra-goose-runner.manifest.json
        ├── actestra-goose-runner.cdx.json
        ├── actestra-goose-runner.audit.json
        ├── Cargo.lock
        └── GOOSE-APACHE-2.0.txt
```

The runner directory and every path component from `/opt` through the
executable are regular, canonical, root-owned package paths. Group and other
write bits are forbidden. The six files in the runner directory continue to
obey the existing Artifact admission contract; the sibling admission record is
not placed inside that directory, so it cannot change the exact six-entry
contract.

The stable executable path is:

```text
/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner
```

It is the only path named by the AppArmor profile. Main executes this exact
file on the Linux packaged path instead of copying it into `goose-attempt-*`.
The attempt-private root still owns configuration, data, home-like state,
temporary files, bridge sockets, and the working directory. No runner bytes are
written into that root on Linux. Darwin and Windows retain their existing
private-root staging behavior until their platform-specific contracts change.

## AppArmor profile and package lifecycle

Actestra ships one checked-in profile template through the existing downstream
overlay. It contains two narrowly scoped profile entries so the mature
Electron Chromium user-namespace behavior is preserved alongside the new
Goose entry:

```text
abi <abi/4.0>,
include <tunables/global>

profile "Actestra" "/opt/Actestra/Actestra" flags=(unconfined) {
  userns,
}

profile "Actestra-Goose-Runner" "/opt/Actestra/resources/actestra-goose-runner/actestra-goose-runner" flags=(unconfined) {
  userns,
}
```

The profile has no wildcard runner path, user-home path, `goose-attempt-*`
pattern, `capability`, network, mount, file, shell, or `include` rule beyond
the fixed tunables include. `flags=(unconfined)` matches the mature
electron-builder Ubuntu profile shape; the explicit `userns` rule is the only
new permission. It is not presented as the Goose sandbox. The actual Goose
containment remains the existing rootless namespace, Landlock, seccomp, RLIMIT,
Main relay, process-group, and cleanup composition.

The downstream builder patch and one Actestra-owned Linux package wrapper will:

1. copy the checked-in profile template and builder configuration into the
   materialized AionUi tree;
2. stage the already built and admitted exact runner Artifact plus its generated
   admission record into generated package resources, never into `foundation/`;
3. set the native electron-builder `deb.appArmorProfile` option to the checked-
   in template; and
4. add the runner Artifact and admission record as explicit `extraResources`.

Electron-builder 26.15.2 already owns the DEB `after-install` and
`after-remove` lifecycle. Its install script validates and loads the profile
as `/etc/apparmor.d/Actestra`; its remove script unloads and removes that file.
Actestra does not add a second package-script framework. If AppArmor is absent,
too old, or rejects the profile, package installation may remain compatible
with older distributions, but Main must report Linux Goose unavailable and
must not launch the runner. A package install is never evidence of runtime
admission by itself.

The package builder emits `actestra-goose-runner-admission.json` from the exact
admitted Artifact and profile bytes. Its closed fields are:

| Field | Required value/source |
| --- | --- |
| `contractVersion` | Fixed integer `1` |
| `targetTriple` | `x86_64-unknown-linux-gnu` |
| `runnerManifestSha256` | SHA-256 of the sibling runner manifest |
| `executableSha256` | SHA-256 repeated from the admitted manifest |
| `profileSha256` | SHA-256 of the exact checked-in/rendered profile |
| `profileName` | `Actestra-Goose-Runner` |
| `executablePath` | The fixed `/opt/Actestra/...` path above |

The record is generated, not user-editable configuration. Main checks its exact
keys, bounded values, root ownership, and cross-field equality before calling
the existing `admitGooseRunnerArtifact`. The outer package trust and future
candidate signatures remain P8.3 responsibilities; this record does not become
a self-authorizing replacement for the existing external Artifact trust
checks.

## Main admission and runner identity

Linux package admission gains a dedicated preflight with the following order:

1. Resolve the package resources directory from Electron's own
   `process.resourcesPath`; do not read a renderer value or an arbitrary Linux
   Artifact environment override.
2. Resolve the fixed runner directory, admission record, profile resource, and
   executable path. Require canonical non-symlink paths and root ownership for
   every directory component and file. Reject group/other-writable bytes.
3. Verify the admission record's profile, target, manifest digest, executable
   digest, and fixed path. Verify the profile file's exact SHA-256 and the
   existing runner manifest/executable digest, lock, SBOM, license, audit, and
   source bindings through `admitGooseRunnerArtifact`.
4. Run the same admitted runner in a bounded bootstrap-check mode before
   `mkdtemp` or bridge creation. This mode does not start Tokio, ACP, a
   namespace, a relay, or a provider request. It checks that its canonical
   `/proc/self/exe` is the fixed packaged path, that
   `/proc/self/attr/current` names exactly `Actestra-Goose-Runner` with the
   expected unconfined mode, that AppArmor is enabled, and that
   `kernel.apparmor_restrict_unprivileged_userns` is `1`. It returns only one
   fixed success/failure marker.
5. Only after the bootstrap check succeeds may Main create the attempt-private
   root, bridge sockets, and the existing Linux Goose launch contract.

The runner repeats the executable/profile identity check immediately before
`unshare(CLONE_NEWUSER)`. This closes the preflight-to-launch race: a profile
removed or changed after Main's check cannot turn into a permissive launch.
Any mismatch exits before untrusted ACP code, Tokio worker threads, relay
listeners, or provider/model traffic starts. Main maps the fixed native marker
to the existing public `network-policy-unavailable` result; the bounded native
evidence layer may distinguish `linux-apparmor-profile-unavailable` from other
Linux setup stages without exposing paths, errno, or process output.

The Linux transport contract becomes an explicit stable-path variant. It keeps
the current `privateRoot`, `workingDirectory`, workspace, lease, socket, port,
resource, parent-liveness, and loopback checks. Only the executable-path rule
changes from “inside the private root” to “the exact admitted root-owned DEB
path.” `close()` still terminates the process group, closes both relay sockets,
and removes the private root exactly once. A Linux launch that is not the
packaged stable-path variant remains fail closed.

## CI installation simulation

The Ubuntu containment job will keep its existing exact build, lock, and
Artifact admission steps. Before authenticated integration, one bounded CI
bootstrap step will:

1. create `/opt/Actestra/resources/actestra-goose-runner` with `sudo`;
2. install the exact six Artifact files, admission record, and profile using
   explicit root ownership and non-writable modes;
3. load `/etc/apparmor.d/Actestra` with the same profile bytes using
   `apparmor_parser`;
4. assert AppArmor is enabled and the userns restriction remains enabled;
5. drop back to the ordinary GitHub runner user and run the authenticated
   integration and native containment commands; and
6. unload the profile and remove the temporary `/opt/Actestra` tree in a
   bounded `finally`/trap path.

The CI `sudo` calls are installation simulation only. No production script or
runner path may invoke them. The job must assert that the Goose process UID is
not zero, that no root-owned process remains after cleanup, and that no
profile, socket, private root, or staging residue survives. It uploads only
the existing success-only bounded containment record. Failure output remains a
closed stage code.

The package-level test must also inspect the generated DEB's resource layout
and maintainer scripts, proving that the checked-in profile is the one passed to
electron-builder and that install/remove hooks refer to the fixed profile
destination. A full packaged Electron smoke remains a separate P8.2 package
gate; this bootstrap does not turn an unpacked directory or a CI fixture into
packaged-user acceptance.

## Error and privacy contract

Internal native stages are closed to the following additions for this slice:

- `linux-apparmor-profile-unavailable`;
- `linux-runner-install-path-unavailable`;
- `linux-runner-ownership-invalid`; and
- `linux-bootstrap-check-failed`.

They all map to the existing public `network-policy-unavailable` launch
outcome unless an existing durable mapper already has a more specific accepted
resource/cleanup code. The integration wrapper may map them to a bounded
`integration-runtime-bootstrap-failed` class so a host-policy failure is not
misreported as ACP or model failure. Unknown failures collapse to the existing
generic closed stage.

No stage may return or persist an absolute path, UID, GID, profile text, sysctl
contents beyond the allowed boolean, errno, PID, environment value, command
line, stdout/stderr, prompt, model completion, lease, socket name, or provider
credential. Evidence retains only target identity, exact digests where required,
closed codes, booleans, bounded counters, and sanitized termination shapes.

## Test-first implementation boundaries

The implementation plan will keep changes to these Actestra-owned surfaces:

- `apps/desktop/resources/` and `apps/desktop/src/shared/` for the fixed
  profile and Linux package contract;
- `apps/desktop/src/main/workers/` for package admission, ownership/profile
  preflight, and the stable-path Linux launcher;
- `workers/goose-runner/` for bootstrap identity checks and fixed markers;
- `downstream/aionui-v2.1.41/patches/` and `overlay.json` for materialized
  builder/resource wiring;
- `scripts/` for exact Artifact staging and CI-only installation simulation;
- `tests/main/`, `tests/scripts/`, and native Rust tests for regressions;
- `.github/workflows/ci.yml` for the one Ubuntu bootstrap/integration job; and
- source-of-truth status/architecture documents after native evidence exists.

The first RED tests must prove the current behavior is insufficient: a
user-writable staged runner cannot satisfy the stable profile path, a missing
profile is rejected before private-root creation, and the current Ubuntu CI
bootstrap fails at `unshare`. The GREEN implementation must then prove the
exact root-owned path, profile identity, stable Linux launch, and ordinary-user
execution. Darwin tests must remain unchanged and green. No test may make a
fixture profile, mutable environment variable, or generated cache a production
trust root.

## Acceptance and rollback

This amendment is implemented only when all of the following are evidenced:

1. The profile source has exact two-entry syntax, only the fixed paths, and no
   widened permission or wildcard.
2. The materialized DEB builder uses the profile and packages the exact runner
   plus external admission record under `/opt/Actestra`.
3. Main rejects missing/changed/unowned profile or runner bytes before private
   root creation; the Linux stable-path launcher rejects all other paths.
4. The runner bootstrap check observes the exact AppArmor profile and enabled
   userns restriction before namespace setup, and the actual runner repeats the
   check before `unshare`.
5. Ubuntu native CI runs the exact Artifact as an ordinary user with the
   checked-in profile, without disabling sysctls or using runtime privilege.
6. The same exact Artifact then proves filesystem, network, process/resource,
   parent-death, authenticated ACP, cancellation/crash, and cleanup evidence;
   only after all fields pass may the existing containment record be bound and
   Linux runtime admission be considered for the next reviewed gate.
7. `bun run check`, Rust format/tests, downstream/foundation/boundary checks,
   package/profile inspection, and `git diff --check` pass. No foundation or
   unrelated product authority changes.

If AppArmor, user namespaces, the required kernel features, or root-owned DEB
installation cannot be established, rollback removes only Linux runtime
admission and the package bootstrap wiring. The existing Darwin runtime and
the pre-root non-Darwin `network-policy-unavailable` stop remain intact. No
schema migration, user-data rewrite, or renderer fallback is needed.

This amendment does not close P8.2 overall, P8.3, or P8.4. Windows Job Object
and restricted-identity work, candidate integrity/signing/update evidence, and
clean-machine/install/real-provider acceptance remain separate gates.

## Self-review

- The only privileged operation is the package manager/ephemeral CI installation
  phase; the runtime runner is ordinary-user and has no helper.
- The profile is path-specific and root-owned; no random attempt path is
  authorized.
- Electron's existing main-app profile is retained in the same profile file.
- Main, not Renderer or Goose, owns Artifact, profile, lease, workspace, and
  admission decisions.
- The public failure vocabulary, redaction rules, `complete=false` behavior,
  and Darwin-only runtime non-claim remain explicit.
- The design is limited to the Ubuntu AppArmor bootstrap blocker and has no
  placeholder, host-network, sysctl-disable, or foundation-edit escape hatch.
