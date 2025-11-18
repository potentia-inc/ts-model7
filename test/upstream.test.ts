import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { NoUpstreamError } from '../src/error/upstream.js'
import { Connection } from '../src/mongo.js'
import { Nil, isNullish, toUuid } from '../src/type.js'
import {
  Pool, // deprecated
  UPSTREAM_SCHEMA,
  UpstreamInsert,
  UpstreamQuery,
  Upstreams,
} from '../src/upstream.js'
import { UpstreamPool } from '../src/upstream-pool.js'
import { sleep } from '../src/util.js'

const { MONGO_URI } = process.env
assert(!isNullish(MONGO_URI))
const CONNECTION = new Connection(MONGO_URI)
const UPSTREAMS = new Upstreams({ connection: CONNECTION })

beforeAll(async () => {
  await CONNECTION.connect()
  await CONNECTION.migrate(UPSTREAM_SCHEMA)
})

afterAll(async () => {
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

    expect(upstream.link()).toBe(
      `${upstream.host}/${upstream.path}?c=${upstream.searchs?.c}&d=${upstream.searchs?.d}`,
    )
    expect(upstream.link({ path: 'foobar', searchs: { e: 'foobar' } })).toBe(
      `${upstream.host}/foobar?c=${upstream.searchs?.c}&d=${upstream.searchs?.d}&e=foobar`,
    )

    // find
    expect(await UPSTREAMS.findOne({ type: upstream.type })).toMatchObject(
      upstream,
    )
    expect(
      await UPSTREAMS.findOne({ type: upstream.type, gteWeight: 0.5 }),
    ).toMatchObject(upstream)
    expect(
      await UPSTREAMS.findOne({ type: upstream.type, gtWeight: 0.5 }),
    ).toBeUndefined()
    expect(
      await UPSTREAMS.findOne({ type: upstream.type, gteWeight: 1 }),
    ).toBeUndefined()
    expect(await UPSTREAMS.findMany()).toMatchObject([upstream])
    expect(
      await UPSTREAMS.findMany({}, { sort: { createdAt: 'asc' } }),
    ).toMatchObject([upstream])

    // update
    const updated = await UPSTREAMS.updateOne(upstream, {
      host: `${randHost()}/${randPath()}/`,
      path: randPath(),
      headers: Nil,
      searchs: Nil,
      auth: Nil,
      interval: 1.5,
      weight: Nil,
    })

    expect(updated.url().toString()).toBe(`${updated.host}${updated.path}`)
    expect(updated.link()).toBe(`${updated.host}${updated.path}`)

    expect(updated).toMatchObject({
      id: expect.toEqualUuid(upstream.id),
      host: expect.any(String),
      path: expect.any(String),
      headers: expect.toBeEmpty(),
      searchs: expect.toBeEmpty(),
      auth: expect.toBeEmpty(),
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

    expect(await pool.sample(type)).not.toBeUndefined()
    // no upstream for other type
    await expect(() => pool.sample(randStr())).rejects.toThrow(NoUpstreamError)

    await deleteUpstreams({ type })
    expect(await pool.sample(type)).not.toBeUndefined() // not sync yet

    await sleep(4000)
    await expect(() => pool.sample(type)).rejects.toThrow(NoUpstreamError)
  })

  test('NoUpstreamError', async () => {
    const pool = new UpstreamPool({
      load: (type) => UPSTREAMS.findMany({ type, gtWeight: 0 }),
      init: () => ({ ttl: 3 }),
    })

    const type = randStr()
    await insertUpstreams({ type, host: randStr() }) // no weight
    await expect(() => pool.sample(type)).rejects.toThrow(NoUpstreamError)
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
      expect(sampled.id).toEqualUuid(upstream.id)
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
    const id = toUuid()
    for (let i = 0; i < 20; ++i) {
      const upstream = await pool.sample(type, { type: 'same', upstream: id })
      expect(upstream.id).not.toEqualUuid(id)
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
      expect(sampled.id).not.toEqualUuid(upstream.id)
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
      expect(sampled.id).toEqualUuid(upstream.id)
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
    expect(rate >= 0.01 && rate <= 0.1).toBeTruthy()

    pool.succeed(upstream) // reset to 1
    hit = 0
    for (let i = 0; i < total; ++i) {
      const x = await pool.sample(type)
      if (x.id.equals(upstream.id)) ++hit
    }
    rate = hit / total
    expect(rate >= 0.4 && rate <= 0.6).toBeTruthy() // hit rate ~ 50%
  })
})

describe('pool (deprecated)', () => {
  test('sync', async () => {
    const type = randStr()
    const pool = new Pool(UPSTREAMS, type, { ttl: 3 })
    await insertUpstreams({ type, host: randStr(), weight: 1 })
    expect(await pool.sample()).not.toBeUndefined()
    await deleteUpstreams({ type })
    expect(await pool.sample()).not.toBeUndefined() // not sync yet
    await sleep(4000)
    await expect(() => pool.sample()).rejects.toThrow(NoUpstreamError)
  })

  test('NoUpstreamError', async () => {
    const type = randStr()
    const pool = new Pool(UPSTREAMS, type, { ttl: 3 })
    await insertUpstreams({ type, host: randStr() }) // no weight
    await expect(() => pool.sample()).rejects.toThrow(NoUpstreamError)
  })

  test('same', async () => {
    const type = randStr()
    const pool = new Pool(UPSTREAMS, type, { ttl: 10 })
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 10)
    const upstream = await pool.sample()
    for (let i = 0; i < 20; ++i) {
      const sampled = await pool.sample({ type: 'same', upstream })
      expect(sampled.id).toEqualUuid(upstream.id)
    }
    await deleteUpstreams({ type })
  })

  test('same but get different upstream', async () => {
    const type = randStr()
    const pool = new Pool(UPSTREAMS, type, { ttl: 10 })
    await insertUpstreams({ type, host: randStr(), weight: 1 })
    const id = toUuid()
    for (let i = 0; i < 20; ++i) {
      const upstream = await pool.sample({ type: 'same', upstream: id })
      expect(upstream.id).not.toEqualUuid(id)
    }
    await deleteUpstreams({ type })
  })

  test('diff', async () => {
    const type = randStr()
    const pool = new Pool(UPSTREAMS, type, { ttl: 10 })
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 2)
    const upstream = await pool.sample()
    for (let i = 0; i < 20; ++i) {
      const sampled = await pool.sample({ type: 'diff', upstream })
      expect(sampled.id).not.toEqualUuid(upstream.id)
    }
    await deleteUpstreams({ type })
  })

  test('diff but get same upstream', async () => {
    const type = randStr()
    const pool = new Pool(UPSTREAMS, type, { ttl: 10 })
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 1)
    const upstream = await pool.sample()
    for (let i = 0; i < 20; ++i) {
      const sampled = await pool.sample({ type: 'diff', upstream })
      expect(sampled.id).toEqualUuid(upstream.id)
    }
    await deleteUpstreams({ type })
  })

  test('weight decay', async () => {
    const type = randStr()
    const pool = new Pool(UPSTREAMS, type, {
      ttl: 10,
      minFailures: 2,
      decay: 0.5,
    })
    await insertUpstreams({ type, host: randStr(), weight: 1 }, 2)

    const upstream = await pool.sample()
    pool.fail(upstream) // failure: 1, weight: 1
    pool.fail(upstream) // failure: 2, weight: 1 -> 0.5
    pool.fail(upstream) // failure: 3, weight: 0.5 -> 0.25
    pool.fail(upstream) // failure: 4, weight: 0.25 -> 0.125
    pool.fail(upstream) // failure: 5, weight: 0.125 -> 0.0625

    const total = 100
    let hit = 0
    for (let i = 0; i < total; ++i) {
      const x = await pool.sample()
      if (x.id.equals(upstream.id)) ++hit
    }

    // hit rate ~ 0.0625 / (1 + 0.0625) ~ 5.88%
    let rate = hit / total
    expect(rate >= 0.01 && rate <= 0.1).toBeTruthy()

    pool.succeed(upstream) // reset to 1
    hit = 0
    for (let i = 0; i < total; ++i) {
      const x = await pool.sample()
      if (x.id.equals(upstream.id)) ++hit
    }
    rate = hit / total
    expect(rate >= 0.4 && rate <= 0.6).toBeTruthy() // hit rate ~ 50%
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
