# Change log

## [2.1.2] - 2026-07-01

Track the latest releases of both dependencies; no API or runtime changes.

- Upgrade `@potentia/util` to 4.3.1 and `@potentia/mongodb7` to 2.0.1.

## [2.1.1] - 2026-07-01

### Fixed

- `Locks.lock()` releases the lock and returns as soon as the `exec` callback
  settles. Previously its heartbeat left the `finally` blocked in a sleep for up
  to `ttl / 2` after `exec` finished, delaying both the unlock and the result.

### Changed

- Require Node.js >= 24 (was >= 22), matching the build/test toolchain.
- Document that `bson` >= 7.3.0 crashes on import under Bun (a Bun limitation);
  Bun users should pin `bson` below 7.3.0 in their own `package.json`. Node.js
  and Deno are unaffected.

## [2.1.0] - 2026-06-17

Upgrade @potentia/util to 4.3.0

- toBigInt/toNumber accept numeric wrapper objects and integral decimal
  strings; empty-string/array inputs now throw.

## [2.0.0] - 2026-06-12

Cross-runtime release (Node.js >= 22, Bun, Deno >= 2), upgraded to
`@potentia/util@^4.2.0` and `@potentia/mongodb7@^2.0.0`.

### Breaking changes

- Upgrade to `@potentia/util@^4.2.0` and `@potentia/mongodb7@^2.0.0`. `mongodb`
  (`^7.0.0`) is now a **peer dependency** you must provide; `util`/`mongodb7` are
  dependencies pinned to exact GitHub tags. Errors and ids are re-exported, so
  catch via `@potentia/model7/error` and use the package's `Uuid`/`ObjectId`.
- `Models.updateOne()` and `deleteOne()` take a query (`Q`) as the first argument
  instead of an id — consistent with `findOne()`. Target by primary key with
  `updateOne({ id }, values)` / `deleteOne({ id })`.
- Duration-valued arguments (`Locks.lock()` `ttl`, `UpstreamPool` init `ttl`,
  `Upstream` `interval`, `RateLimiter.reserve()`) accept a `Duration`. A bare
  **number now means milliseconds, not seconds** (silent — a number is a valid
  `Duration`); migrate `ttl: 3` → `'3s'`, `interval: 0.2` → `'200ms'`.
  `Upstream.interval` is stored as seconds in the DB but read back as
  milliseconds (no data migration needed).
- Remove the deprecated `Pool`; use `UpstreamPool` from
  `@potentia/model7/upstream/pool`.
- Mint ids with `new Uuid()` (mongodb7 2.x made `toUuid()` strict — it no longer
  generates a value for nullish input).
- Correct `OBJECTID_DOC_SCHEMA`'s `_id` bsonType from `binData` to `objectId`.
- Require Node.js >= 22 (was >= 24).

### Added

- Bun and Deno support, verified by a framework-free `smoke.mjs` (a live-MongoDB
  round trip on each runtime) and a node/bun/deno CI matrix. Bun is covered by
  the smoke since it cannot run `node:test` (oven-sh/bun#5090); Deno runs the
  `node:test` suites plus the smoke.
- A pluggable rate limiter at `@potentia/model7/upstream/rate-limiter`: the
  `RateLimiter` interface plus a default in-process `LocalRateLimiter` whose
  `workers` count partitions a global budget across a fleet and can be adjusted
  at runtime. README recipes show shared-store limiters (MongoDB token-lease and
  Redis).
- Declare `types` for every `exports` entry point.

### Fixed

- Apply the documented `minWeight` floor when decaying upstream weights (it was
  stored but never enforced).
- Stop leaking the rate limiter's per-upstream `weights` state when an upstream
  is removed on resync.
- Keep the model-level `$now`/`$max` control fields out of the options passed to
  the MongoDB driver.
- Point `package.json` `main` at `./model.js` (was a nonexistent `./index.js`).

### Internal

- Replace jest with the built-in `node:test` runner (drops `jest`, `@types/jest`,
  `jest-extended` and `eslint-plugin-jest`), with a small predicate-aware
  `test/assert.ts` helper. Coverage is lines 99.4% / branch 95.0% / funcs 98.1%.

## [1.1.0] - 2026-03-13

- Add `Model.$paginate()` and `Options.$max` to configure pagination limits
  (defaults to `Infinity`).
- Update `Cursor` to inherit from `ExplainableCursor` (previously `FindCursor`)
  to enable `AggregationSort` support.

## [1.0.0] - 2025-11-18

The first release
