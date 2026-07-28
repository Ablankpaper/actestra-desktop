# ADR-0005: SQLite Persistence and Forward-Only Migrations

- Status: Accepted
- Date: 2026-07-28

## Context

Actestra now has storage-neutral domain and event contracts, but P3 cannot add a
real worker until product state survives restart and rejects incompatible or
corrupt storage. The selected database must:

- run inside the packaged Electron application on macOS, Windows, and Linux;
- preserve transactions, referential integrity, ordered events, and crash
  recovery;
- avoid giving the renderer filesystem or database authority;
- keep packaging reproducible without an untracked native-addon rebuild;
- support explicit, testable, forward-only migrations.

The exact desktop runtime matters. Electron `37.10.3` embeds Node.js `22.21.1`.
A local `ELECTRON_RUN_AS_NODE=1` probe verified that this runtime provides
`node:sqlite`, SQLite `3.50.4`, strict tables, prepared statements, foreign keys,
and transactional rollback.

There are two material limitations:

- Node.js `22.21.1` documents `node:sqlite` as stability `1.1`, active
  development.
- Electron 37 is end-of-support. Its SQLite `3.50.4` also predates the WAL-reset
  fix documented by SQLite for `3.50.7` and `3.51.3`.

These limitations require a narrow adapter and a conservative journal policy;
they do not justify adding a second native SQLite binary to the package.

## Decision

### Engine and authority

Actestra will use the SQLite library embedded in Electron through
`node:sqlite`. No third-party SQLite package is added in P3.

The SQLite implementation stays behind storage-neutral core persistence ports.
Only a main-owned persistence service or utility process may instantiate it.
The renderer and preload bridge receive no database path, SQL, connection, or
raw file access.

The adapter exposes asynchronous ports even though `DatabaseSync` is
synchronous. P3.3 tests it directly, but it must be hosted outside renderer
execution and moved to a supervised persistence utility process before
user-workload writes are enabled.

### Connection policy

Each Actestra profile owns one database file at
`state/actestra.sqlite3` beneath the Actestra user-data directory. The adapter
uses one writable connection and serializes mutations.

Every connection requires:

- `allowExtension: false`;
- `enableForeignKeyConstraints: true`;
- double-quoted string literals disabled;
- unknown named parameters rejected;
- a bounded busy timeout;
- `PRAGMA trusted_schema = OFF`;
- `PRAGMA journal_mode = DELETE`;
- `PRAGMA synchronous = FULL`.

P3 explicitly does not enable WAL. SQLite `3.50.4` is within the affected range
of the documented WAL-reset race, and Actestra does not yet need concurrent
database writers. WAL may be reconsidered only after the embedded SQLite
revision contains the fix and multi-connection crash/concurrency tests exist.

All runtime values use prepared statements. Schema SQL exists only in the
versioned migration registry.

### Ownership and schema identity

The database header uses:

- `PRAGMA application_id = 1095980114`, the big-endian ASCII value `ASTR`;
- `PRAGMA user_version` as the current Actestra schema version.

A database is fresh only when it has application ID `0`, user version `0`, and
no user tables. A nonzero foreign application ID, an unowned populated
database, an unsupported future version, a missing migration, or inconsistent
migration history fails closed without rewriting the file.

### Migration registry

Migrations are immutable, contiguous, and forward-only:

1. every version has a positive integer, stable name, SQL body, and SHA-256
   checksum;
2. each migration runs inside its own `BEGIN IMMEDIATE` transaction;
3. its history row, application ID, and `user_version` update commit in the same
   transaction;
4. any failure rolls back the entire current migration;
5. successful startup verifies recorded names and checksums, foreign keys, and
   `PRAGMA quick_check`;
6. automatic downgrade and destructive repair are forbidden.

Rollback means restoring a pre-migration backup or shipping a new forward
migration. Application startup never executes a down migration.

### Initial schemas

- Version 1 creates Actestra-owned workspace, task, worker, session, approval,
  artifact, and migration-history tables.
- Version 2 creates the ordered core-event store and its stream index.

The split is intentional so tests prove a real `1 -> 2` forward migration while
preserving version 1 domain data.

Event identity columns are indexed projections, not foreign keys. Appends
validate their workspace, task, session, and worker against the current domain
graph inside the same write transaction, while previously committed events
remain immutable audit history if a later domain snapshot removes those
records. Reads reject any mismatch between indexed columns and the canonical
event envelope as corruption.

## Consequences

### Positive

- No native addon, postinstall build, Electron ABI rebuild, or second SQLite
  binary enters the package.
- SQLite transactions and constraints back the Actestra source of truth.
- The adapter can be replaced without changing domain or event consumers.
- Fresh creation, reopen, forward migration, duplicate event delivery,
  incompatible-future state, corruption, and rollback are directly testable.
- Conservative single-connection rollback journaling avoids the known WAL race
  in the bundled SQLite revision.

### Costs

- `node:sqlite` is still an active-development Node API, so the exact Electron
  runtime needs a compatibility probe in CI.
- `DatabaseSync` must not perform unbounded work on the renderer or UI-critical
  main-process path.
- Rollback-journal mode permits less read/write concurrency than WAL.
- Electron 37 must be upgraded before release support claims.
- Backups, compaction, retention, and at-rest encryption remain later work.

## Rejected alternatives

### `better-sqlite3` or `sqlite3`

Rejected for P3 because they add a native addon that must be rebuilt for
Electron's ABI. The current package deliberately disables npm rebuilds and
removes package scripts, so adding one would expand the packaging and
cross-platform proof surface before it is needed.

### SQLite WASM

Rejected because browser-oriented persistence and full-database serialization
do not improve the main-owned transactional desktop store.

### JSON files

Rejected because they do not provide the required atomic multi-record updates,
foreign keys, ordered uniqueness, integrity checks, or migration transactions.

### WAL on the current runtime

Rejected because the embedded SQLite `3.50.4` is in the documented affected
range for the WAL-reset race, while Actestra currently uses a single writer and
does not need WAL concurrency.

### Worker-native persistence

Rejected by ADR-0002 because external worker sessions cannot become the
authoritative product store.

## Evidence and sources

- [Electron 37.10.3 runtime versions](https://releases.electronjs.org/release/v37.10.3)
- [Node.js 22.21.1 SQLite API](https://nodejs.org/download/release/v22.21.1/docs/api/sqlite.html)
- [SQLite transactions](https://www.sqlite.org/lang_transaction.html)
- [SQLite pragmas](https://www.sqlite.org/pragma.html)
- [SQLite write-ahead logging and WAL-reset issue](https://www.sqlite.org/wal.html)

## Review triggers

Review this decision if:

- Electron upgrades to a supported release with a materially different
  `node:sqlite` contract;
- `node:sqlite` is removed, stabilized with breaking changes, or lacks a target
  platform build;
- the embedded SQLite contains the WAL fix and measured concurrency requires
  multiple connections;
- database work can no longer stay within bounded persistence-service latency;
- at-rest encryption or a portable encrypted database becomes a product
  requirement.
