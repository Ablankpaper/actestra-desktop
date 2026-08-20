# Goose runner patch set

The admitted Goose compatibility target remains upstream `v1.45.0` at exact
commit `4dc0420f5704a92806c6628c8f0a3497d7a88759`. For the P8.2c Windows
authenticated-runtime work, Actestra resolves the `goose` and
`goose-providers` crates from the standalone private repository
`Ablankpaper/actestra-goose-runtime` at immutable commit
`e246f395592b01995cd34faf5e3ce1ed5444a41a`. That repository is not a GitHub
Fork and has no automatic upstream synchronization.

The runtime commit descends from the exact upstream commit and changes only:

- `crates/goose/src/acp/server.rs`;
- `crates/goose/src/acp/server_factory.rs`; and
- `crates/goose/src/acp/server/new_session.rs`.

The binary, full-index Git diff for those three files has SHA-256
`a5f2df85313dbbd1ac20bef3fafba4e40e32e2ffa0c76ad5a5d62414d1eae1f4`.
The patch adds a default-off ACP runtime-adapter seam that fixes one Provider,
model, and MCP client for one active session. The ordinary upstream entry point
remains the default. The Actestra source contract rejects a different base,
runtime commit, repository, changed-path set, patch digest, or non-empty Goose
feature set.

Goose remains Apache-2.0 and the upstream root contains no `NOTICE`. The exact
license payload is retained in `licenses/GOOSE-APACHE-2.0.txt` and copied beside
generated runner evidence.

Dependency resolution remains Actestra-owned through the committed runner
`Cargo.lock`. It resolves `event-listener` `5.4.2` and `lru` `0.18.2` to remove
the reviewed unsound versions without widening the empty Goose feature set.

On 2026-08-20, crates.io yanked `arrayref` `0.3.9`, the version selected by
`blake3` `1.8.5`, and published `0.3.10` with an unreviewed dependency change.
The runner therefore pins the pre-yank `arrayref` source at immutable commit
`f8d0299d863922db6c409d08098941e833b70d69` through Cargo's crates.io patch
mechanism. This keeps the audit fail-closed without accepting the newly
published package; the pin is removable once a reviewed non-yanked registry
release is available.

Rollback restores both Cargo dependencies and the source contract to canonical
upstream commit `4dc0420f5704a92806c6628c8f0a3497d7a88759`, restores the empty-patch
digest, and keeps Windows production runtime admission disabled. This record
does not prove adapted Goose execution on Windows, an Electron package,
candidate integrity, P8.2c completion, or overall P8 completion.
