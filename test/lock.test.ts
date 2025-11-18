import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { setImmediate } from 'node:timers/promises'
import { LockError, RelockError, UnlockError } from '../src/error/lock.js'
import { LOCK_SCHEMA, Locks } from '../src/lock.js'
import { Connection } from '../src/mongo.js'
import { isNullish } from '../src/type.js'
import { sleep } from '../src/util.js'

const { MONGO_URI } = process.env
assert(!isNullish(MONGO_URI))
export const CONNECTION = new Connection(MONGO_URI)

beforeAll(async () => {
  await CONNECTION.connect()
  await CONNECTION.migrate(LOCK_SCHEMA)
})

afterAll(async () => {
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
      { ttl: 3 },
    )
    await setImmediate()

    const exec = () => Promise.resolve(true)
    await expect(() => LOCKS.lock(id, exec)).rejects.toThrow(LockError)
    await sleep(5000)
    await expect(() => LOCKS.lock(id, exec)).rejects.toThrow(LockError)
    await sleep(4000)
    await expect(() => LOCKS.lock(id, exec)).rejects.toThrow(LockError)
    await sleep(4000)
    expect(await LOCKS.lock(id, exec)).toBe(true)
    expect(await promise).toBe(true)

    const lock = await LOCKS.insertOne({
      id: randStr(),
      expiresAt: new Date(Date.now() + 10000),
    })
    expect(await LOCKS.findOne({ id: lock.id })).toMatchObject({
      id: lock.id,
      expiresAt: expect.toEqualDate(lock.expiresAt),
      createdAt: expect.toBeDate(),
    })

    expect(await LOCKS.findMany()).toHaveLength(1)
    expect(
      await LOCKS.findMany({}, { sort: { createdAt: 'asc' } }),
    ).toHaveLength(1)
    expect(
      await LOCKS.findMany({}, { sort: { expiresAt: 'asc' } }),
    ).toHaveLength(1)
  })

  test('user exception', async () => {
    const id = randStr()
    await expect(() =>
      LOCKS.lock(id, () => {
        throw new Error('foobar')
      }),
    ).rejects.toThrow(/foobar/)
  })

  test('LockError', async () => {
    const id = randStr()
    const promise = LOCKS.lock(id, () => sleep(1000))
    await setImmediate()
    await expect(() => LOCKS.lock(id, async () => true)).rejects.toThrow(
      LockError,
    )
    await promise
  })

  test('RelockError', async () => {
    const id = randStr()
    const timeout = new Promise((resolve, reject) =>
      setTimeout(() => LOCKS.deleteOne(id).then(resolve).catch(reject), 2000),
    )
    let called = 0
    const onError = (err: unknown) => {
      ++called
      expect(err).toBeInstanceOf(RelockError)
    }
    expect(
      await LOCKS.lock(
        id,
        async (signal) => {
          for (let i = 0; i < 10; ++i) {
            if (signal.aborted) return false
            await sleep(1000)
          }
          return true
        },
        { ttl: 2, retries: 1, onError },
      ),
    ).toBe(false)
    await timeout
    expect(called).toBe(1)
  })

  test('UnlockError', async () => {
    const id = randStr()
    const timeout = new Promise((resolve, reject) =>
      setTimeout(() => LOCKS.deleteOne(id).then(resolve).catch(reject), 3500),
    )
    let called = 0
    const onError = (err: unknown) => {
      ++called
      expect(err).toBeInstanceOf(UnlockError)
    }
    expect(
      await LOCKS.lock(
        id,
        async (signal) => {
          await sleep(3000)
          return !signal.aborted
        },
        { ttl: 4, onError },
      ),
    ).toBe(true)
    await timeout
    expect(called).toBe(1)
  })
})

function randStr(length = 8): string {
  assert(Number.isInteger(length) && length > 0)
  return randomBytes(length / 2)
    .toString('base64')
    .substring(0, length)
}
