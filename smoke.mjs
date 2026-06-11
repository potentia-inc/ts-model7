// Framework-free cross-runtime smoke test. Uses only node:assert and top-level
// await (no describe/test), so it runs identically on Node, Bun and Deno —
// unlike the node:test suite, which Bun cannot run (oven-sh/bun#5090).
//
// Exercises the built artifact (dist): the runtime-agnostic helpers and the
// LocalRateLimiter, and — when MONGO_URI is set — a full Locks/Upstreams round
// trip against a live MongoDB through @potentia/mongodb7.
//
//   node smoke.mjs   |   bun smoke.mjs   |   deno run -A smoke.mjs
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Connection } from './dist/src/mongo.js'
import { getSortKey, toRangeOrNil } from './dist/src/model.js'
import { LOCK_SCHEMA, Locks } from './dist/src/lock.js'
import { UPSTREAM_SCHEMA, Upstreams } from './dist/src/upstream.js'
import { UpstreamPool } from './dist/src/upstream-pool.js'
import { LocalRateLimiter } from './dist/src/upstream-rate-limiter.js'

const runtime =
  typeof globalThis.Bun !== 'undefined'
    ? 'bun'
    : typeof globalThis.Deno !== 'undefined'
      ? 'deno'
      : 'node'

// --- runtime-agnostic bits (no DB needed) ---

// query builders
assert.equal(toRangeOrNil(), undefined)
const range = toRangeOrNil({ begin: new Date(0) })
assert.ok(range?.$gte instanceof Date)
assert.equal(getSortKey({ created_at: 1 }), 'created_at')

// LocalRateLimiter: per-key spacing + runtime-adjustable worker count
const limiter = new LocalRateLimiter()
const started = Date.now()
await limiter.reserve('k', 30)
await limiter.reserve('k', 30) // waits ~30ms
assert.ok(Date.now() - started >= 20)
limiter.workers = 2
assert.equal(limiter.workers, 2)

// --- DB round trip (only when a live MongoDB is reachable) ---
const { MONGO_URI } = globalThis.process?.env ?? {}
if (MONGO_URI) {
  const connection = new Connection(MONGO_URI)
  await connection.connect()
  try {
    await connection.migrate(LOCK_SCHEMA)
    await connection.migrate(UPSTREAM_SCHEMA)

    // Locks: a full lock() round trip with a unique key
    const locks = new Locks({ connection })
    const key = `smoke_${runtime}_${randomUUID()}`
    assert.equal(await locks.lock(key, async () => 42, { ttl: 3 }), 42)
    assert.equal(await locks.findOne({ id: key }), undefined) // released

    // Upstreams: insert + url/link + find, then sample through a pool
    const upstreams = new Upstreams({ connection })
    const type = `smoke_${runtime}_${randomUUID()}`
    const upstream = await upstreams.insertOne({
      type,
      host: 'https://example.com/api',
      path: 'foo',
      searchs: { a: '1' },
      weight: 1,
    })
    assert.equal(upstream.link(), 'https://example.com/api/foo?a=1')
    assert.notEqual(await upstreams.findOne({ id: upstream }), undefined)

    const pool = new UpstreamPool({
      load: (t) => upstreams.findMany({ type: t, gtWeight: 0 }),
      rateLimiter: new LocalRateLimiter(),
    })
    const sampled = await pool.sample(type)
    assert.ok(sampled.id.equals(upstream.id))
    pool.fail(sampled)
    pool.succeed(sampled)

    await upstreams.deleteMany({ type }) // cleanup (locks self-release)
    console.log(`SMOKE OK (${runtime}, with MongoDB)`)
  } finally {
    await connection.disconnect()
  }
} else {
  console.log(`SMOKE OK (${runtime}, no MONGO_URI — DB round trip skipped)`)
}
