import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { NoUpstreamError } from '../src/error/upstream.js'
import { Connection } from '../src/mongo.js'
import { Nil, Uuid, isNullish } from '../src/type.js'
import {
  UPSTREAM_SCHEMA,
  UpstreamInsert,
  UpstreamQuery,
  Upstreams,
} from '../src/upstream.js'
import { UpstreamPool } from '../src/upstream-pool.js'
import { sleep } from '../src/util.js'
import { empty, match, string, uuid } from './assert.js'

const { MONGO_URI } = process.env
assert(!isNullish(MONGO_URI))
const CONNECTION = new Connection(MONGO_URI)
const UPSTREAMS = new Upstreams({ connection: CONNECTION })

before(async () => {
  await CONNECTION.connect()
  await CONNECTION.migrate(UPSTREAM_SCHEMA)
})

after(async () => {
  await CONNECTION.disconnect()
})

describe('upstream', () => {
  test('upstream', async () => {
    // insert
    const upstream = await UPSTREAMS.insertOne({
      type: randStr(),
      host: `${randHost()}/${randPath()}`,
      path: randPath(),
      headers: { a: randStr(), b: randStr() },
      searchs: { c: randStr(), d: randStr() },
      auth: { token: randStr(), key: randStr() },
      weight: 0.5,
    })

    assert.equal(
      upstream.link(),
      `${upstream.host}/${upstream.path}?c=${upstream.searchs?.c}&d=${upstream.searchs?.d}`,
    )
    assert.equal(
      upstream.link({ path: 'foobar', searchs: { e: 'foobar' } }),
      `${upstream.host}/foobar?c=${upstream.searchs?.c}&d=${upstream.searchs?.d}&e=foobar`,
    )

    // find
    match(await UPSTREAMS.findOne({ type: upstream.type }), upstream)
    match(
      await UPSTREAMS.findOne({ type: upstream.type, gteWeight: 0.5 }),
      upstream,
    )
    assert.equal(
      await UPSTREAMS.findOne({ type: upstream.type, gtWeight: 0.5 }),
      undefined,
    )
    assert.equal(
      await UPSTREAMS.findOne({ type: upstream.type, gteWeight: 1 }),
      undefined,
    )
    match(await UPSTREAMS.findMany(), [upstream])
    match(await UPSTREAMS.findMany({}, { sort: { createdAt: 'asc' } }), [
      upstream,
    ])

    // update
    const updated = await UPSTREAMS.updateOne(
      { id: upstream },
      {
        host: `${randHost()}/${randPath()}/`,
        path: randPath(),
        headers: Nil,
        searchs: Nil,
        auth: Nil,
        interval: 1.5,
        weight: Nil,
      },
    )

    assert.equal(updated.url().toString(), `${updated.host}${updated.path}`)
    assert.equal(updated.link(), `${updated.host}${updated.path}`)

    match(updated, {
      id: uuid(upstream.id),
      host: string,
      path: string,
      headers: empty,
      searchs: empty,
      auth: empty,
      interval: 1.5,
      weight: 0,
    })
  })
})

describe('upstream-pool', () => {
  test('sync', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 3 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr(), weight: 1 })

    assert.notEqual(await pool.sample(type), undefined)
    // no upstream for other type
    await assert.rejects(pool.sample(randStr()), NoUpstreamError)

    await deleteUpstreams({ type })
    assert.notEqual(await pool.sample(type), undefined) // not sync yet

    await sleep(4000)
    await assert.rejects(pool.sample(type), NoUpstreamError)
  })

  test('NoUpstreamError', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 3 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr() }) // no weight
    await assert.rejects(pool.sample(type), NoUpstreamError)
  })

  test('same', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 10 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 10)
    const upstream = await pool.sample(type)
    for (let i = 0; i < 20; ++i) {
      const sampled = await pool.sample(type, { type: 'same', upstream })
      assert.ok(sampled.id.equals(upstream.id))
    }
    await deleteUpstreams({ type })
  })

  test('same but get different upstream', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 10 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr(), weight: 1 })
    const id = new Uuid()
    for (let i = 0; i < 20; ++i) {
      const upstream = await pool.sample(type, { type: 'same', upstream: id })
      assert.ok(!upstream.id.equals(id))
    }
    await deleteUpstreams({ type })
  })

  test('diff', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 10 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 2)
    const upstream = await pool.sample(type)
    for (let i = 0; i < 20; ++i) {
      const sampled = await pool.sample(type, { type: 'diff', upstream })
      assert.ok(!sampled.id.equals(upstream.id))
    }
    await deleteUpstreams({ type })
  })

  test('diff but get same upstream', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 10 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 1)
    const upstream = await pool.sample(type)
    for (let i = 0; i < 20; ++i) {
      const sampled = await pool.sample(type, { type: 'diff', upstream })
      assert.ok(sampled.id.equals(upstream.id))
    }
    await deleteUpstreams({ type })
  })

  test('weight decay', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 10, minFailures: 2, decay: 0.5 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 2)

    const upstream = await pool.sample(type)
    pool.fail(upstream) // failure: 1, weight: 1
    pool.fail(upstream) // failure: 2, weight: 1 -> 0.5
    pool.fail(upstream) // failure: 3, weight: 0.5 -> 0.25
    pool.fail(upstream) // failure: 4, weight: 0.25 -> 0.125
    pool.fail(upstream) // failure: 5, weight: 0.125 -> 0.0625

    const total = 100
    let hit = 0
    for (let i = 0; i < total; ++i) {
      const x = await pool.sample(type)
      if (x.id.equals(upstream.id)) ++hit
    }

    // hit rate ~ 0.0625 / (1 + 0.0625) ~ 5.88%
    let rate = hit / total
    assert.ok(rate >= 0.01 && rate <= 0.1)

    pool.succeed(upstream) // reset to 1
    hit = 0
    for (let i = 0; i < total; ++i) {
      const x = await pool.sample(type)
      if (x.id.equals(upstream.id)) ++hit
    }
    rate = hit / total
    assert.ok(rate >= 0.4 && rate <= 0.6) // hit rate ~ 50%
  })
})

async function insertUpstreams(values: UpstreamInsert, n = 10) {
  for (let i = 0; i < n; ++i) await UPSTREAMS.insertOne(values)
}

async function deleteUpstreams(query: UpstreamQuery) {
  await UPSTREAMS.deleteMany(query)
}

function randStr(length = 4): string {
  assert(Number.isInteger(length) && length > 0)
  return randomBytes(length / 2)
    .toString('hex')
    .substring(0, length)
}

function randHost(): string {
  return `https://${randStr()}.com`
}

function randPath(): string {
  return `${randStr()}/${randStr()}`
}
