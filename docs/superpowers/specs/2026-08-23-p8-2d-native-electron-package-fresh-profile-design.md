# P8.2d Native Electron Package and Fresh-Profile Design

**Status:** Approved for implementation by the owner instruction to continue
the documented P8 sequence

**Date:** 2026-08-23

**Phase:** P8.2d — native package and runtime matrix

**Related:** [P8 product contract](../../product/P8_CROSS_PLATFORM_INTERNAL_BETA.md),
[ADR-0030](../../architecture/decisions/0030-p8-cross-platform-internal-beta-acceptance.md),
[ADR-0010](../../architecture/decisions/0010-aionui-first-product-foundation.md),
and [development sequence](../../roadmap/DEVELOPMENT_SEQUENCE.md)

## Purpose

P8.2a proved native Goose compilation and Artifact admission. P8.2b proved
target-native containment, and P8.2c proved the Windows authenticated Goose
runtime composition. None of those results proves that the Electron product is
packaged and can start from a new Actestra profile on every P8 target.

P8.2d supplies that missing, deliberately narrow vertical slice for exactly:

- `macos-15-arm64`, with DMG and ZIP outputs;
- `windows-11-x64`, with an NSIS EXE output; and
- `ubuntu-24.04-x64`, with a DEB output.

The slice starts the application from the package build, not an Electron dev
entry. It verifies Main, Renderer, the Main-owned Provider IPC boundary, the
Actestra profile manifest, SQLite schema 23, the retained AionUI model-settings
empty state, graceful exit, and no residual process.

## Scope boundaries

P8.2d does not exercise or claim the remaining P8.2 General, Goose, Team,
workspace-apply, cancellation, recovery, privacy, or P7 product journeys. It
does not perform clean-machine installation, upgrade, uninstall, a real-
provider run, signing, notarization, SBOM/provenance production, candidate
creation, update trust, release, distribution, or user acceptance. Those
remain separate P8.2, P8.3, and P8.4 obligations.

The frozen `foundation/` tree remains unchanged. The only user-interface
change is a stable test identifier on the existing AionUI no-models empty
state. It adds no text, control, route, authority, or visual layout.

## Considered approaches

### One platform-specific smoke implementation per target

This would make initial CI wiring straightforward but create three evidence
schemas and three cleanup implementations. The behavior would drift, and a
platform could silently pass a weaker contract. Rejected.

### Drive all targets through Playwright Electron

This would provide convenient DOM control, but it would add a second launcher
and test-runtime boundary when Electron Main already owns the target window and
Provider IPC. It also makes installed DEB execution less faithful. Rejected.

### One bounded smoke/evidence contract with thin CI platform adapters

Selected. One root script validates the target, package formats, hashes,
isolated profile, marker, database, and cleanup. A downstream Main-only E2E
hook performs the small DOM and Provider IPC probe and then requests a normal
Electron shutdown. CI remains responsible only for building the native package
and supplying its platform-specific runtime path.

## Runtime design

### Package inputs

The smoke CLI accepts:

```text
--target <closed P8 target ID>
--runtime <packaged executable or .app>
--package <format>=<package path>  (repeatable)
--source-commit <40 lowercase hex commit>
--evidence <output JSON path>
```

The package-format set must exactly match the P8 matrix. Each package file,
the launched executable, and `app.asar` must be a real regular file and is
bound by SHA-256. The macOS runtime is the generated `Actestra.app`, the
Windows runtime is `win-unpacked/Actestra.exe` produced in the same NSIS build,
and the Ubuntu runtime is `/opt/Actestra/Actestra` populated from the exact DEB
payload. This is package-build runtime evidence, not installer lifecycle
evidence.

### Isolated profile

The runner creates one private temporary root with separate `user-data`,
`home`, and `temp` directories. Every directory must remain a canonical,
non-symlink descendant of the root. The app receives the existing E2E
isolation variables plus:

```text
ACTESTRA_P8_FRESH_PROFILE_SMOKE=1
```

That mode skips the unrelated General Worker probe. It does not change normal
production behavior or grant Renderer authority.

### Main-owned UI probe

After `did-finish-load`, Main runs a fixed E2E-only expression in the existing
Renderer:

1. prove a direct Renderer fetch of `/api/providers` is denied;
2. call `window.electronAPI.actestraProviderList`, which is the existing
   Main-owned, redacted Provider IPC path;
3. require the returned Provider list to be exactly empty;
4. navigate to `#/settings/model`;
5. require `model-header` and `actestra-provider-unavailable`;
6. require non-empty visible explanatory text without exporting the text; and
7. return only the bounded marker payload.

Main logs exactly one marker and then calls `app.quit()`:

```text
ACTESTRA_P8_FRESH_PROFILE_READY {"providerCount":0,"providerUiState":"provider-unavailable","providerUiTextPresent":true}
```

Errors emit one closed failure token. No path, Provider record, credential,
Renderer text, exception message, or arbitrary stderr is copied into evidence.

### Durable-state and cleanup proof

After a zero exit, the runner requires:

- `actestra-profile.json` with `product=Actestra` and `layoutVersion=1`;
- `<user-data>/state/actestra.sqlite3` at `PRAGMA user_version=23`;
- the marker's exact empty Provider/UI result; and
- every observed Electron descendant PID to exit within the cleanup bound.

Process enumeration failure is a failure, not an assumed clean result. The
successful evidence always records `residualProcessCount=0`.

## Evidence contract

The successful JSON has exact keys and no open text fields:

```json
{
  "schemaVersion": 1,
  "status": "verified",
  "targetId": "macos-15-arm64",
  "sourceCommit": "0000000000000000000000000000000000000000",
  "packages": [
    { "format": "dmg", "sha256": "0000000000000000000000000000000000000000000000000000000000000000" },
    { "format": "zip", "sha256": "0000000000000000000000000000000000000000000000000000000000000000" }
  ],
  "executableSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "appAsarSha256": "0000000000000000000000000000000000000000000000000000000000000000",
  "packageStructure": true,
  "mainReady": true,
  "rendererReady": true,
  "providerIpc": true,
  "directProviderFetchDenied": true,
  "profileManifest": true,
  "sqliteSchemaVersion": 23,
  "providerCount": 0,
  "providerUiState": "provider-unavailable",
  "providerUiTextPresent": true,
  "gracefulExit": true,
  "residualProcessCount": 0
}
```

The validator requires exact keys, exact target/package-format bindings,
lowercase digests, the exact source commit, and every success invariant. A
failed run writes only a separate bounded failure record with `schemaVersion`,
`status`, `targetId`, `sourceCommit`, and one token from the closed failure
vocabulary. Failed records never validate as acceptance evidence.

The initial failure vocabulary covers invalid arguments/target, package
structure or binding, profile isolation, spawn/early exit/timeout, malformed or
missing marker, non-empty Provider projection, missing UI state, invalid
manifest/schema, non-graceful exit, process-probe failure, and residual
processes.

## Downstream classification and rollback

Patch `0022-actestra-p8-fresh-profile-smoke.mjs` is R1 because it exercises the
Actestra-owned Provider IPC and Main lifecycle behind the retained AionUI model
settings page. It adds a test identifier and an E2E-only Main probe. Renderer
still has no filesystem, database, shell, process, credential, or unrestricted
network authority.

Rollback regenerates the downstream tree without patch 0022 and removes the
P8.2d CI/smoke scripts. No profile migration is introduced, and existing
profiles, schema 23 data, routes, UI text, Provider records, and frozen-source
bytes remain unchanged.

## CI design

- macOS extends the existing native job to emit DMG and ZIP, launches the
  generated `.app`, and uploads one bounded evidence JSON.
- Windows adds the missing native Electron job, emits NSIS plus
  `win-unpacked`, launches `Actestra.exe`, and uploads one bounded evidence
  JSON.
- Ubuntu reuses the exact DEB already built by the containment job, materializes
  its complete `/opt/Actestra` payload under the loaded AppArmor profile,
  launches through `xvfb-run`, and uploads one bounded evidence JSON.

Each artifact name includes the target and exact GitHub SHA. Failed jobs may
upload a bounded failure record, but only three independently validated
`verified` records close P8.2d.

## Acceptance and non-claims

P8.2d closes only when focused tests, downstream materialization and typecheck,
the complete local project gate, and one exact-head CI run are green, and all
three uploaded records independently validate against their target, source
commit, package formats, and digests. `PROJECT_STATUS.md` is updated only after
that evidence exists.

P8.2d closure does not close P8.2 overall and does not create a candidate,
release, deployment, distribution, clean-machine result, real-provider result,
or user acceptance.
