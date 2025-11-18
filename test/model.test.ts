import assert from 'node:assert'
import { randomBytes } from 'node:crypto'
import { ConflictError, NotFoundError } from '../src/error.js'
import {
  getSortKey,
  toExistsOrNil,
  toUnsetOrNil,
  toValueOrAbsent,
  toValueOrAbsentOrNil,
  toValueOrInOrNil,
  toRangeOrNil,
} from '../src/model.js'
import { Connection } from '../src/mongo.js'
import { Nil, isNullish, toUuid } from '../src/type.js'
import { FOO_SCHEMA, Foos } from './foo.js'
import { BAR_SCHEMA, Bars } from './bar.js'

const { MONGO_URI } = process.env
assert(!isNullish(MONGO_URI))
export const CONNECTION = new Connection(MONGO_URI)

beforeAll(async () => {
  await CONNECTION.connect()

  await CONNECTION.migrate(FOO_SCHEMA)
  await CONNECTION.migrate(BAR_SCHEMA)
})

afterAll(async () => {
  await CONNECTION.disconnect()
})

describe('model', () => {
  test('CRUD for Foo', async () => {
    const FOOS = new Foos({ connection: CONNECTION })

    const foo = randStr()
    const foo2 = randStr()

    // insertOne and insertMany
    const test = await FOOS.insertOne({ foo })
    expect(test).toMatchObject({
      id: expect.toBeUuid(),
      foo,
      createdAt: expect.toBeDate(),
    })
    await expect(() =>
      FOOS.insertOne({ id: test.id, foo: foo2 }),
    ).rejects.toThrow(ConflictError)
    await expect(() => FOOS.insertOne({ foo })).rejects.toThrow(ConflictError)
    expect(await FOOS.insertMany([{ foo: foo2 }])).toMatchObject([
      {
        id: expect.toBeUuid(),
        foo: foo2,
        createdAt: expect.toBeDate(),
      },
    ])
    await expect(() => FOOS.insertMany([{ foo: foo2 }])).rejects.toThrow(
      ConflictError,
    )

    // find, findOne, findMany
    expect(await FOOS.find(test)).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    expect(await FOOS.find(test.id)).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    await expect(() => FOOS.find(toUuid())).rejects.toThrow(NotFoundError)
    expect(await FOOS.findOne({ id: test })).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    expect(await FOOS.findOne({ id: test.id })).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    const pagination = {
      offest: 0,
      limit: 100,
      sort: { createdAt: 'asc' },
    } as const
    expect(await FOOS.findMany({}, pagination)).toMatchObject([
      {
        id: expect.toBeUuid(),
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      },
      {
        id: expect.toBeUuid(),
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      },
    ])

    // count, iterate, paginate
    expect(await FOOS.count({})).toBe(2)
    for await (const test of FOOS.iterate({}, pagination)) {
      expect(test).toMatchObject({
        id: expect.toBeUuid(),
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      })
    }

    // findManyToMapBy
    const map = await FOOS.findManyToMapBy((x) => String(x.id), {}, pagination)
    expect(map.size).toBe(2)
    expect(map.get(String(test.id))).toMatchObject(test)

    expect(
      await FOOS.paginate(
        {
          createdIn: {
            begin: new Date(+test.createdAt + 1),
            end: new Date(Date.now() + 86400000),
          },
        },
        {
          sort: { createdAt: 'asc' },
          offset: 0,
          limit: 100,
        },
      ),
    ).toMatchObject([
      {
        sort: { createdAt: 'asc' },
        offset: 0,
        limit: 100,
        count: 1,
      },
      [
        {
          id: expect.toBeUuid(),
          foo: expect.any(String),
          createdAt: expect.toBeDate(),
        },
      ],
    ])
    expect(
      await FOOS.paginate(
        { createdIn: { end: test.createdAt } },
        {
          sort: { createdAt: 'asc' },
          offset: 0,
          limit: 100,
        },
      ),
    ).toMatchObject([
      {
        sort: { createdAt: 'asc' },
        offset: 0,
        limit: 100,
        count: 0,
      },
      [],
    ])

    // updateOne, updateMany
    await expect(() => FOOS.updateOne(toUuid(), { bar: 123 })).rejects.toThrow(
      NotFoundError,
    )
    expect(await FOOS.updateOne(test, { bar: 123 })).toMatchObject({
      id: test.id,
      foo: test.foo,
      bar: 123,
      createdAt: expect.toEqualDate(test.createdAt),
      updatedAt: expect.toBeDate(),
    })
    expect(await FOOS.updateOne(test, { bar: Nil })).toMatchObject({
      id: test.id,
      foo: test.foo,
      bar: Nil,
      createdAt: expect.toEqualDate(test.createdAt),
      updatedAt: expect.toBeDate(),
    })
    expect(await FOOS.updateMany({ foo: foo2 }, { bar: 456 })).toBe(1)
    expect(await FOOS.updateMany({ foo: randStr() }, { bar: 789 })).toBe(0)

    // deleteOne, deleteMany
    await expect(() => FOOS.deleteOne(toUuid())).rejects.toThrow(NotFoundError)
    await FOOS.deleteOne(test)
    expect(await FOOS.findOne({ id: test })).toBeNil()
    await expect(() => FOOS.deleteOne(test)).rejects.toThrow(NotFoundError)
    expect(await FOOS.deleteMany({})).toBe(1)
    expect(await FOOS.deleteMany({})).toBe(0)
  })

  test('CRUD for Bar', async () => {
    const BARS = new Bars({ connection: CONNECTION })
    const foo = randStr()
    const foo2 = randStr()

    // insertOne and insertMany
    const test = await BARS.insertOne({
      id: { foo: toUuid(), bar: randStr() },
      foo,
    })
    expect(test).toMatchObject({
      id: {
        foo: expect.toBeUuid(),
        bar: expect.any(String),
      },
      foo,
      createdAt: expect.toBeDate(),
    })
    await expect(() =>
      BARS.insertOne({ id: test.id, foo: foo2 }),
    ).rejects.toThrow(ConflictError)
    await expect(() =>
      BARS.insertOne({
        id: { foo: toUuid(), bar: randStr() },
        foo,
      }),
    ).rejects.toThrow(ConflictError)
    expect(
      await BARS.insertMany([
        {
          id: { foo: toUuid(), bar: randStr() },
          foo: foo2,
        },
      ]),
    ).toMatchObject([
      {
        id: {
          foo: expect.toBeUuid(),
          bar: expect.any(String),
        },
        foo: foo2,
        createdAt: expect.toBeDate(),
      },
    ])
    await expect(() =>
      BARS.insertMany([
        {
          id: { foo: toUuid(), bar: randStr() },
          foo: foo2,
        },
      ]),
    ).rejects.toThrow(ConflictError)

    // find, findOne, findMany
    expect(await BARS.find(test)).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    expect(await BARS.find(test.id)).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    await expect(() =>
      BARS.find({ foo: toUuid(), bar: randStr() }),
    ).rejects.toThrow(NotFoundError)
    await expect(() =>
      BARS.find({
        foo: toUuid(),
        bar: randStr(),
      }),
    ).rejects.toThrow(NotFoundError)
    expect(await BARS.findOne({ id: test })).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    expect(await BARS.findOne({ id: test.id })).toMatchObject({
      id: test.id,
      foo: test.foo,
      createdAt: expect.toEqualDate(test.createdAt),
    })
    const pagination = {
      offest: 0,
      limit: 100,
      sort: { createdAt: 'asc' },
    } as const
    expect(await BARS.findMany({}, pagination)).toMatchObject([
      {
        id: {
          foo: expect.toBeUuid(),
          bar: expect.any(String),
        },
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      },
      {
        id: {
          foo: expect.toBeUuid(),
          bar: expect.any(String),
        },
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      },
    ])

    // count, iterate, paginate
    expect(await BARS.count({})).toBe(2)
    for await (const test of BARS.iterate({}, pagination)) {
      expect(test).toMatchObject({
        id: {
          foo: expect.toBeUuid(),
          bar: expect.any(String),
        },
        foo: expect.any(String),
        createdAt: expect.toBeDate(),
      })
    }

    // findManyToMapBy
    const map = await BARS.findManyToMapBy(
      (x) => `${String(x.id.foo)}:${x.id.bar}`,
      {},
      pagination,
    )
    expect(map.size).toBe(2)
    expect(map.get(`${String(test.id.foo)}:${test.id.bar}`)).toMatchObject(test)

    expect(
      await BARS.paginate(
        {
          createdIn: {
            begin: new Date(+test.createdAt + 1),
            end: new Date(Date.now() + 86400000),
          },
        },
        {
          sort: { createdAt: 'asc' },
          offset: 0,
          limit: 100,
        },
      ),
    ).toMatchObject([
      {
        sort: { createdAt: 'asc' },
        offset: 0,
        limit: 100,
        count: 1,
      },
      [
        {
          id: {
            foo: expect.toBeUuid(),
            bar: expect.any(String),
          },
          foo: expect.any(String),
          createdAt: expect.toBeDate(),
        },
      ],
    ])
    expect(
      await BARS.paginate(
        { createdIn: { end: test.createdAt } },
        {
          sort: { createdAt: 'asc' },
          offset: 0,
          limit: 100,
        },
      ),
    ).toMatchObject([
      {
        sort: { createdAt: 'asc' },
        offset: 0,
        limit: 100,
        count: 1,
      },
      [
        {
          id: {
            foo: expect.toBeUuid(),
            bar: expect.any(String),
          },
          foo: expect.any(String),
          createdAt: expect.toBeDate(),
        },
      ],
    ])

    // updateOne, updateMany
    await expect(() =>
      BARS.updateOne(
        {
          foo: toUuid(),
          bar: randStr(),
        },
        { bar: 123 },
      ),
    ).rejects.toThrow(NotFoundError)
    expect(await BARS.updateOne(test, { bar: 123 })).toMatchObject({
      id: test.id,
      foo: test.foo,
      bar: 123,
      createdAt: expect.toEqualDate(test.createdAt),
      updatedAt: expect.toBeDate(),
    })
    expect(await BARS.updateOne(test, { bar: Nil })).toMatchObject({
      id: test.id,
      foo: test.foo,
      bar: Nil,
      createdAt: expect.toEqualDate(test.createdAt),
      updatedAt: expect.toBeDate(),
    })
    expect(await BARS.updateMany({ foo: foo2 }, { bar: 456 })).toBe(1)
    expect(await BARS.updateMany({ foo: randStr() }, { bar: 789 })).toBe(0)

    // deleteOne, deleteMany
    await expect(() =>
      BARS.deleteOne({
        foo: toUuid(),
        bar: randStr(),
      }),
    ).rejects.toThrow(NotFoundError)
    await BARS.deleteOne(test)
    expect(await BARS.findOne({ id: test })).toBeNil()
    await expect(() => BARS.deleteOne(test)).rejects.toThrow(NotFoundError)
    expect(await BARS.deleteMany({})).toBe(1)
    expect(await BARS.deleteMany({})).toBe(0)
  })

  test('getSortKey()', () => {
    expect(getSortKey(Nil)).toBeNil()
    expect(getSortKey('foo')).toBe('foo')
    expect(getSortKey(['foo'])).toBe('foo')
    expect(getSortKey([['foo', 1]])).toBe('foo')
    expect(getSortKey({ foo: 1 })).toBe('foo')
    const map = new Map()
    map.set('foo', 1)
    expect(getSortKey(map)).toBe('foo')
  })

  test('query builders', () => {
    expect(toValueOrAbsent(Nil)).toMatchObject({ $exists: false })
    expect(toValueOrAbsent(null)).toMatchObject({ $exists: false })
    expect(toValueOrAbsent(true)).toBe(true)
    expect(toValueOrAbsent(false)).toBe(false)
    expect(toValueOrAbsent(123)).toBe(123)
    expect(toValueOrAbsent('foo')).toBe('foo')
    expect(toValueOrAbsent([0, 1])).toMatchObject([0, 1])
    expect(toValueOrAbsent({ foo: 'bar' })).toMatchObject({ foo: 'bar' })

    expect(toValueOrAbsentOrNil({ foo: Nil }, 'foo')).toMatchObject({
      $exists: false,
    })
    expect(toValueOrAbsentOrNil({} as { foo?: string }, 'foo')).toBeNil()
    expect(toValueOrAbsentOrNil({ foo: 'bar' }, 'foo')).toBe('bar')
    expect(toValueOrAbsentOrNil({ foo: 'bar' }, 'foo', (x) => x?.length)).toBe(
      3,
    )

    expect(toExistsOrNil(Nil)).toBe(Nil)
    expect(toExistsOrNil(null)).toBe(Nil)
    expect(toExistsOrNil(true)).toMatchObject({ $exists: true })
    expect(toExistsOrNil(false)).toMatchObject({ $exists: false })

    expect(toUnsetOrNil<{ foo?: unknown }>({}, 'foo')).toBe(Nil)
    expect(toUnsetOrNil({ foo: 'bar' }, 'foo')).toBe(Nil)
    expect(toUnsetOrNil({ foo: Nil }, 'foo')).toBe(true)
    expect(toUnsetOrNil({ foo: null }, 'foo')).toBe(true)

    expect(toValueOrInOrNil(Nil)).toBe(Nil)
    expect(toValueOrInOrNil(null)).toBe(Nil)
    expect(toValueOrInOrNil('foo')).toBe('foo')
    expect(toValueOrInOrNil(['foo', 'bar'])).toMatchObject({
      $in: ['foo', 'bar'],
    })
    const arr = ['foo', 'bar'] as const
    expect(toValueOrInOrNil(arr)).toMatchObject({
      $in: ['foo', 'bar'],
    })
    expect(toValueOrInOrNil(['foo', 'bar'], (x) => x.length)).toMatchObject({
      $in: [3, 3],
    })
    expect(
      toValueOrInOrNil(['foo', 'bar'] as const, (x) => x.length),
    ).toMatchObject({
      $in: [3, 3],
    })

    const begin = new Date()
    const end = new Date()
    expect(toRangeOrNil()).toBeNil()
    expect(toRangeOrNil({})).toBeNil()
    expect(toRangeOrNil({}, true)).toBeNil()
    expect(toRangeOrNil({ begin })).toMatchObject({
      $gte: expect.toEqualDate(begin),
    })
    expect(toRangeOrNil({ begin }, true)).toMatchObject({
      $gte: expect.toEqualDate(begin),
    })
    expect(toRangeOrNil({ begin, end })).toMatchObject({
      $gte: expect.toEqualDate(begin),
      $lt: expect.toEqualDate(end),
    })
    expect(toRangeOrNil({ begin, end }, true)).toMatchObject({
      $gte: expect.toEqualDate(begin),
      $lte: expect.toEqualDate(end),
    })
    expect(toRangeOrNil({ end })).toMatchObject({
      $lt: expect.toEqualDate(end),
    })
    expect(toRangeOrNil({ end }, true)).toMatchObject({
      $lte: expect.toEqualDate(end),
    })
  })
})

function randStr(length = 8): string {
  assert(Number.isInteger(length) && length > 0)
  return randomBytes(length / 2)
    .toString('base64')
    .substring(0, length)
}
