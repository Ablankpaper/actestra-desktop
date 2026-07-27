# AionUi v2.1.41 Baseline

- Evaluation window: 2026-07-27 to 2026-07-28
- Evidence platform: macOS 26.5.2 (25F84), Apple silicon
- Actestra branch: `upstream/aionui-v2-1-41`
- Result: P1 baseline reproduced locally; no upstream source imported

## Decision

AionUi `v2.1.41` is the immutable starting revision for Actestra's P2 product
shell work. This pin accepts the revision for controlled evaluation and later
selective adoption; it does not approve the upstream application, identifiers,
data paths, telemetry, update service, bundled agents, entitlements, or package
as an Actestra release candidate.

The baseline was repeated from two independent shallow clones. Both checkouts
remained detached at the exact tag and had clean tracked working trees after
installation, launch, tests, compilation, and packaging.

## Immutable inputs

| Component | Version | Exact revision or checksum | Role |
| --- | --- | --- | --- |
| AionUi | `v2.1.41` | `2d8925fc67a97a20996fadcd2a0862b778b572ba` | Desktop foundation under evaluation |
| AionCore | `v0.1.52` | `76f5554286ba0b6d33fb74d5c2bb2b3b0b83100d` | Backend bundled by AionUi |
| aionrs | `v0.2.7` | `445a18e1625cc68ded3a647ee99332195fbe8508` | AionCore Git dependency from `Cargo.lock` |
| Electron | `37.10.3` | ZIP SHA-256 `24529be1f2f87c587d06c7474607f1b57d1184b3f45d916cac33791de3a70014` | Desktop runtime |
| AionCore binary | `0.1.52`, arm64 | SHA-256 `29dea30561b1457ac784c5fa48a58a63c6580b0e8cee8d7471ed079e0e50908c` | Locally built backend used in both packages |
| `better_sqlite3.node` | `12.8.0`, arm64 | SHA-256 `d8294fe84c856b0e2e7c94f76f89885b913f798cb8ca6365a955d0987a7650ae` | Electron native database module |

The AionUi tag resolves to a GitHub-verified commit. The checksums above are
local evidence for the evaluated inputs, not published Actestra artifacts.

## Toolchain

| Tool | Verified version |
| --- | --- |
| Xcode | 26.6 (17F113) |
| Architecture | `arm64` |
| Node.js | `v24.13.0` |
| npm | `11.6.2` |
| Bun | `1.3.9` |
| Python used by the shell | `3.9.6` |
| Rust | `rustc 1.95.0` |
| Cargo | `cargo 1.95.0` |
| Electron ABI | Node `22.21.1`, module ABI `136` |

AionUi declares Node `>=22 <25`. The evaluated Node 24 version satisfies that
range. Bun is not pinned by upstream metadata, so P2 must add an Actestra-owned
toolchain policy before application source is adopted.

## Reproduction procedure

Keep upstream checkouts outside the Actestra repository. Replace the example
directory variables with disposable locations.

### Clone and verify the pins

```bash
git clone --branch v2.1.41 --depth 1 \
  https://github.com/iOfficeAI/AionUi.git "$AIONUI_CHECKOUT"
git -C "$AIONUI_CHECKOUT" rev-parse HEAD
git -C "$AIONUI_CHECKOUT" describe --tags --exact-match
git -C "$AIONUI_CHECKOUT" status --short --branch

git clone --branch v0.1.52 --depth 1 \
  https://github.com/iOfficeAI/AionCore.git "$AIONCORE_CHECKOUT"
git -C "$AIONCORE_CHECKOUT" rev-parse HEAD
git -C "$AIONCORE_CHECKOUT" describe --tags --exact-match
git -C "$AIONCORE_CHECKOUT" status --short --branch
```

Expected AionUi and AionCore revisions are the full SHAs in
[Immutable inputs](#immutable-inputs).

### Build AionCore

```bash
cd "$AIONCORE_CHECKOUT"
cargo install --locked --force --path crates/aionui-app
aioncore --version
aioncore --help
```

The build succeeded and produced an arm64 `aioncore 0.1.52`. Cargo warned that
locked dependency `spin 0.9.8` is yanked; the locked build still completed.

### Install and check AionUi

```bash
cd "$AIONUI_CHECKOUT"
bun install --frozen-lockfile --network-concurrency=8
bun run format:check
bunx tsc --noEmit
bun run lint
bun run test
bun run test:coverage
bun run package
```

The concurrency limit avoids a first-run install stall observed with Bun's
default network concurrency. If the Electron child postinstall is interrupted,
the checkout is incomplete and must not be treated as installed.

### Launch the development application

```bash
cd "$AIONUI_CHECKOUT"
env -u SENTRY_DSN bun run start:multi
```

Wait for `Window ready-to-show`, `Renderer did-finish-load`, and the AionCore
listening message. Request `http://127.0.0.1:<port>/health`, then stop with
SIGINT and confirm that Electron and AionCore exit.

`start:multi` uses the upstream `AionUi-Dev-2`, `.aionui-dev-2`, and
`.aionui-config-dev-2` names. They are isolated from release-mode names but are
still upstream-owned global paths.

### Produce the controlled unsigned package

The default package command reaches moving or network-dependent inputs. The P1
package therefore uses:

- a complete AionCore `v0.1.52` bundle prepared from the verified local binary;
- an explicitly empty Hub fallback instead of moving tag `dist-latest`;
- the Electron distribution already installed by the frozen Bun install;
- no Sentry DSN, publishing, Apple credentials, or certificate discovery.

On the first checkout, prepare the AionCore bundle with the verified binary:

```bash
cd "$AIONUI_CHECKOUT"
mkdir -p resources/hub

env -u SENTRY_DSN -u appleId -u appleIdPassword -u teamId \
  AIONUI_HUB_SKIP=1 \
  AIONUI_BACKEND_LOCAL_BINARY="$(command -v aioncore)" \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  node scripts/build-with-builder.js arm64 --mac --arm64 \
  --config.electronDist="$AIONUI_CHECKOUT/node_modules/electron/dist"
```

Preserve the resulting `resources/bundled-aioncore/darwin-arm64` directory
outside the checkout. On the second checkout, use that directory as
`AIONCORE_BUNDLE`:

```bash
cd "$AIONUI_CHECKOUT"
mkdir -p resources/hub

env -u SENTRY_DSN -u appleId -u appleIdPassword -u teamId \
  AIONUI_HUB_SKIP=1 \
  AIONUI_BACKEND_LOCAL_BUNDLE_DIR="$AIONCORE_BUNDLE" \
  CSC_IDENTITY_AUTO_DISCOVERY=false \
  node scripts/build-with-builder.js arm64 --mac --arm64 \
  --config.electronDist="$AIONUI_CHECKOUT/node_modules/electron/dist"
```

The same command may use `--skip-vite` only after `bun run package` has already
produced a source-matching `out/` tree and the build hash is current.

## Validation results

| Check | First checkout | Second checkout |
| --- | --- | --- |
| Exact tag and SHA | Pass | Pass |
| Tracked working tree clean | Pass | Pass |
| Frozen Bun install | Pass after limiting concurrency | Pass in 17.26 seconds |
| Electron arm64 | Pass | Pass |
| Electron-compatible `better-sqlite3` | SQLite 3.51.3 | SQLite 3.51.3 |
| Format | 1,759 files pass | 1,759 files pass |
| Type check | Pass | Pass |
| Lint | Exit 0; 846 warnings, 0 errors | Exit 0; 846 warnings, 0 errors |
| Vitest | 321 files pass, 1 skipped; 2,576 tests pass, 5 skipped | Same result |
| Coverage | 43.81% statements, 38.54% branches, 40.34% functions, 44.63% lines | Not repeated |
| Electron/Vite compilation | Pass; about 27 MB | Pass; about 27 MB |
| Development launch | Window, renderer, WebSocket, health, graceful exit pass | Same result |
| Full macOS package generation | DMG and ZIP produced | DMG and ZIP produced |
| Valid signature or Gatekeeper acceptance | Fail, expected to block release | Fail, expected to block release |

Vitest emitted a `MaxListenersExceededWarning`. The renderer build also reported
dynamic/static import overlap, circular chunks, and chunks larger than 1,500
kB. Lint's successful exit is not a zero-warning result. Provider-dependent
Playwright E2E suites were not executed during this foundation evaluation.

## Runtime evidence

The two development launches started AionCore on random loopback ports. The
health endpoint returned:

```json
{"status":"ok","version":"0.1.52","build_time":"1785169409"}
```

Both launches reached a visible window, loaded the renderer, established the
backend WebSocket, and shut down without leaving processes. Observed baseline
warnings included:

- `/api/channel/settings/wecom` returning HTTP 400 for an invalid platform;
- a Sentry startup-report error after correctly skipping upload with no DSN;
- a managed Node 24.11.0 download on first runtime preparation;
- development CDP listening on port 9230;
- the update client configuring the AionUi feed, then skipping the check because
  the application was unpackaged.

An unsigned packaged-app smoke also reached the window, renderer, AionCore
health, WebSocket, and bundled Node activation. The E2E directory override kept
the actual data in a temporary directory, but the app created release-named
home-directory symlinks pointing to that directory. Those test-created links
were moved out of the home directory after shutdown. P2 must replace this
symlink behavior with Actestra-owned paths and cleanup semantics.

## Package evidence

The local artifacts are intentionally excluded from Git.

| Run | Artifact | Bytes | SHA-256 |
| --- | --- | --- | --- |
| First checkout, partial moving Hub input | `AionUi-2.1.41-mac-arm64.dmg` | 470,257,450 | `2b915ab97d031fbc490696403f4e8d928c913ed3f7c5bc962fa58270ae49022c` |
| First checkout, partial moving Hub input | `AionUi-2.1.41-mac-arm64.zip` | 473,902,594 | `a25b1148694318c540fc474a9926575221e50ed5e976201f7884ad61de374703` |
| Second checkout, controlled empty Hub | `AionUi-2.1.41-mac-arm64.dmg` | 470,361,459 | `91fa10db885ba25f8466b66e31b44712e3de431295681d8c73ae89cf0ba29ca8` |
| Second checkout, controlled empty Hub | `AionUi-2.1.41-mac-arm64.zip` | 473,961,145 | `1a71b194e3d8a62b9ec92a3c8a4a45d8bb6abc49d7516f1ee804ece665daf01b` |

Both app bundles were about 1.4 GB and contained the identical evaluated
AionCore binary checksum. Package generation is repeatable, but byte-for-byte
artifact reproducibility is not established: Hub contents and generated
timestamps differ.

The upstream `afterSign` hook tried to add a deep ad-hoc signature after
certificate discovery was disabled. It failed with `resource fork, Finder
information, or similar detritus not allowed`. `codesign --verify --deep
--strict` failed and `spctl` rejected both apps. These are unsigned local
baseline packages, not installable candidates.

## Inventory

### Repository and dependencies

- AionUi has 99 direct runtime dependencies and 51 direct development
  dependencies.
- Tracked worktree files total about 469.5 MiB, dominated by demonstration
  media.
- Tracked assets include 47 PNG, 46 SVG, 18 GIF, 3 JPG, 2 MP4, 1 ICNS, and 1
  ICO file.
- The largest tracked GIF is about 63 MB.
- A full dependency-license inventory and SBOM have not been generated.

### Bundled runtime

The evaluated arm64 application contains:

| Component | Version |
| --- | --- |
| AionCore | `0.1.52` |
| Managed Node.js | `24.11.0` |
| Claude CLI | `2.1.215` |
| Codex CLI | `0.144.6` |

The AionCore preparation code checks bundle structure but does not provide an
Actestra-owned checksum or signature policy before extracting every downloaded
release input. P2 must make runtime provenance explicit.

### Licensing

- AionUi has a root Apache-2.0 `LICENSE` and no root `NOTICE`.
- AionCore has a root Apache-2.0 `LICENSE` and no root `NOTICE`.
- AionCore's workspace `Cargo.toml` declares `license = "MIT"`, which conflicts
  with its root license file and requires upstream clarification before
  distribution.
- Individual dependencies, assets, bundled CLIs, Hub extensions, fonts, and
  services require separate review before adoption.

No evaluated code, asset, binary, or package has been committed to Actestra, so
this report records provenance without asserting that distribution obligations
have begun.

### Network, telemetry, and update surfaces

Observed or source-declared endpoints and behaviors include:

- `https://static.aionui.com/releases` for desktop updates;
- GitHub publishing configured for `iOfficeAI/AionUi`;
- AionCore release downloads from `iOfficeAI/AionCore`;
- moving AionHub tag `dist-latest` from GitHub raw content and jsDelivr;
- managed Node downloads from `nodejs.org`;
- Sentry initialization only when `SENTRY_DSN` is supplied;
- a persistent anonymous analytics identifier and delayed compressed-log upload
  path when Sentry reporting is configured.

All upstream update, publishing, telemetry, and log-upload behavior must be
disabled or replaced before an Actestra-branded build.

### Identity, storage, and privileges

The evaluated package declares:

- bundle identifier `com.aionui.app`;
- product and executable name `AionUi`;
- deep-link scheme `aionui`;
- release data links `~/.aionui` and `~/.aionui-config`;
- development variants using `AionUi-Dev` and `AionUi-Dev-2`;
- microphone access plus JIT, unsigned executable memory, disabled executable
  page protection, dynamic-loader environment variables, and disabled library
  validation entitlements.

P2 must replace the identity and paths. P7 must justify or remove each
high-privilege entitlement.

## Upstream reproducibility defects

1. `bun install` can stall at default network concurrency.
2. Electron's child postinstall can remain incomplete after an interrupted
   install.
3. The default Hub input is a moving tag, extension download failures are
   non-fatal, and the process retained open HTTPS handles after reporting only
   4 of 13 extensions downloaded.
4. Electron and AionCore downloads can stall or fail even when related local
   caches exist.
5. The unsigned macOS after-sign fallback fails on extended attributes but does
   not fail the overall package command.
6. DMG/ZIP output is not byte-for-byte reproducible.
7. Upstream lint is warning-heavy, and the full Playwright matrix remains
   unverified locally.

## P1 conclusion

The P1 source-evaluation gate is satisfied locally:

- exact revisions are pinned;
- two clean checkouts repeated frozen install, development launch, Vitest, Vite
  compilation, and full DMG/ZIP generation;
- the primary license, asset, runtime, data, network, telemetry, update,
  entitlement, and packaging surfaces are inventoried;
- no Actestra feature work or upstream source import was mixed into the proof.

P1 is not CI validation, a candidate, a release, distribution, or user
acceptance. Review and merge of this evidence is required before P2 begins.
Any distributed build additionally requires deterministic inputs, complete
third-party notices, an SBOM, valid signing/notarization, clean-profile
installation, and acceptance evidence.
