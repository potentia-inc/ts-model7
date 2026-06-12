import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { setImmediate } from 'node:timers/promises'
import { LockError, RelockError, UnlockError } from '../src/error/lock.js'
import { LOCK_SCHEMA, Locks } from '../src/lock.js'
import { Connection } from '../src/mongo.js'
import { isNullish } from '../src/type.js'
import { sleep } from '../src/util.js'
import { date, match } from './assert.js'

const { MONGO_URI } = process.env
assert(!isNullish(MONGO_URI))
const CONNECTION = new Connection(MONGO_URI)

before(async () => {
  await CONNECTION.connect()
  await CONNECTION.migrate(LOCK_SCHEMA)
})

after(async () => {
  await CONNECTION.disconnect()
})

describe('lock', () => {
  const LOCKS = new Locks({ connection: CONNECTION })

  test('lock', async () => {
    const id = randStr()
    const promise = LOCKS.lock(
      id,
      async () => {
        await sleep(10000)
        return true
      },
      { ttl: '3s' },
    )
    await setImmediate()

    const exec = () => Promise.resolve(true)
    await assert.rejects(LOCKS.lock(id, exec), LockError)
    await sleep(5000)
    await assert.rejects(LOCKS.lock(id, exec), LockError)
    await sleep(4000)
    await assert.rejects(LOCKS.lock(id, exec), LockError)
    await sleep(4000)
    assert.equal(await LOCKS.lock(id, exec), true)
    assert.equal(await promise, true)

    const lock = await LOCKS.insertOne({
      id: randStr(),
      expiresAt: new Date(Date.now() + 10000),
    })
    match(await LOCKS.findOne({ id: lock.id }), {
      id: lock.id,
      expiresAt: date(lock.expiresAt),
      createdAt: date(),
    })

    assert.equal((await LOCKS.findMany()).length, 1)
    assert.equal(
      (await LOCKS.findMany({}, { sort: { createdAt: 'asc' } })).length,
      1,
    )
    assert.equal(
      (await LOCKS.findMany({}, { sort: { expiresAt: 'asc' } })).length,
      1,
    )
  })

  test('user exception', async () => {
    const id = randStr()
    await assert.rejects(
      LOCKS.lock(id, () => {
        throw new Error('foobar')
      }),
      /foobar/,
    )
  })

  test('LockError', async () => {
    const id = randStr()
    const promise = LOCKS.lock(id, () => sleep(1000))
    await setImmediate()
    await assert.rejects(
      LOCKS.lock(id, async () => true),
      LockError,
    )
    await promise
  })

  test('RelockError', async () => {
    const id = randStr()
    const timeout = new Promise((resolve, reject) =>
      setTimeout(
        () => LOCKS.deleteOne({ id }).then(resolve).catch(reject),
        2000,
      ),
    )
    let called = 0
    const onError = (err: unknown) => {
      ++called
      assert.ok(err instanceof RelockError)
    }
    assert.equal(
      await LOCKS.lock(
        id,
        async (signal) => {
          for (let i = 0; i < 10; ++i) {
            if (signal.aborted) return false
            await sleep(1000)
          }
          return true
        },
        { ttl: '2s', retries: 1, onError },
      ),
      false,
    )
    await timeout
    assert.equal(called, 1)
  })

  test('UnlockError', async () => {
    const id = randStr()
    const timeout = new Promise((resolve, reject) =>
      setTimeout(
        () => LOCKS.deleteOne({ id }).then(resolve).catch(reject),
        3500,
      ),
    )
    let called = 0
    const onError = (err: unknown) => {
      ++called
      assert.ok(err instanceof UnlockError)
    }
    assert.equal(
      await LOCKS.lock(
        id,
        async (signal) => {
          await sleep(3000)
          return !signal.aborted
        },
        { ttl: '4s', onError },
      ),
      true,
    )
    await timeout
    assert.equal(called, 1)
  })
})

function randStr(length = 8): string {
  assert(Number.isInteger(length) && length > 0)
  return randomBytes(length / 2)
    .toString('base64')
    .substring(0, length)
}
