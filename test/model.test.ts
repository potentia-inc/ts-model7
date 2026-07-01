import { strict as assert } from 'node:assert'
import { randomBytes } from 'node:crypto'
import { after, before, describe, test } from 'node:test'
import { ConflictError, NotFoundError } from '../src/error.js'
import type { StringDoc } from '../src/model.js'
import {
  Model,
  Models,
  getSortKey,
  toExistsOrNil,
  toUnsetOrNil,
  toValueOrAbsent,
  toValueOrAbsentOrNil,
  toValueOrInOrNil,
  toRangeOrNil,
} from '../src/model.js'
import { Connection } from '../src/mongo.js'
import { Nil, Uuid, isNullish } from '../src/type.js'
import { FOO_SCHEMA, Foos } from './foo.js'
import { BAR_SCHEMA, Bars } from './bar.js'
import { date, match, string, uuid } from './assert.js'

const { MONGO_URI } = process.env
assert(!isNullish(MONGO_URI))
const CONNECTION = new Connection(MONGO_URI)

before(async () => {
  await CONNECTION.connect()

  await CONNECTION.migrate(FOO_SCHEMA)
  await CONNECTION.migrate(BAR_SCHEMA)
})

after(async () => {
  await CONNECTION.disconnect()
})

describe('model', () => {
  test('CRUD for Foo', async () => {
    const FOOS = new Foos({ connection: CONNECTION })

    const foo = randStr()
    const foo2 = randStr()

    // insertOne and insertMany
    const test = await FOOS.insertOne({ foo })
    match(test, { id: uuid(), foo, createdAt: date() })
    await assert.rejects(
      FOOS.insertOne({ id: test.id, foo: foo2 }),
      ConflictError,
    )
    await assert.rejects(FOOS.insertOne({ foo }), ConflictError)
    match(await FOOS.insertMany([{ foo: foo2 }]), [
      { id: uuid(), foo: foo2, createdAt: date() },
    ])
    await assert.rejects(FOOS.insertMany([{ foo: foo2 }]), ConflictError)

    // find, findOne, findMany
    match(await FOOS.find(test), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    match(await FOOS.find(test.id), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    await assert.rejects(FOOS.find(new Uuid()), NotFoundError)
    match(await FOOS.findOne({ id: test }), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    match(await FOOS.findOne({ id: test.id }), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    const pagination = {
      offest: 0,
      limit: 100,
      sort: { createdAt: 'asc' },
    } as const
    match(await FOOS.findMany({}, pagination), [
      { id: uuid(), foo: string, createdAt: date() },
      { id: uuid(), foo: string, createdAt: date() },
    ])

    // count, iterate, paginate
    assert.equal(await FOOS.count({}), 2)
    for await (const x of FOOS.iterate({}, pagination)) {
      match(x, { id: uuid(), foo: string, createdAt: date() })
    }

    // findManyToMapBy
    const map = await FOOS.findManyToMapBy((x) => String(x.id), {}, pagination)
    assert.equal(map.size, 2)
    match(map.get(String(test.id)), test)

    match(
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
      [
        { sort: { createdAt: 'asc' }, offset: 0, limit: 100, count: 1 },
        [{ id: uuid(), foo: string, createdAt: date() }],
      ],
    )
    match(
      await FOOS.paginate(
        { createdIn: { end: test.createdAt } },
        {
          sort: { createdAt: 'asc' },
          offset: 0,
          limit: 100,
        },
      ),
      [{ sort: { createdAt: 'asc' }, offset: 0, limit: 100, count: 0 }, []],
    )

    // updateOne, updateMany
    await assert.rejects(
      FOOS.updateOne({ id: new Uuid() }, { bar: 123 }),
      NotFoundError,
    )
    match(await FOOS.updateOne({ id: test }, { bar: 123 }), {
      id: test.id,
      foo: test.foo,
      bar: 123,
      createdAt: date(test.createdAt),
      updatedAt: date(),
    })
    match(await FOOS.updateOne({ id: test }, { bar: Nil }), {
      id: test.id,
      foo: test.foo,
      bar: Nil,
      createdAt: date(test.createdAt),
      updatedAt: date(),
    })
    assert.equal(await FOOS.updateMany({ foo: foo2 }, { bar: 456 }), 1)
    assert.equal(await FOOS.updateMany({ foo: randStr() }, { bar: 789 }), 0)

    // deleteOne, deleteMany
    await assert.rejects(FOOS.deleteOne({ id: new Uuid() }), NotFoundError)
    await FOOS.deleteOne({ id: test })
    assert.equal(await FOOS.findOne({ id: test }), Nil)
    await assert.rejects(FOOS.deleteOne({ id: test }), NotFoundError)
    assert.equal(await FOOS.deleteMany({}), 1)
    assert.equal(await FOOS.deleteMany({}), 0)
  })

  test('CRUD for Bar', async () => {
    const BARS = new Bars({ connection: CONNECTION })
    const foo = randStr()
    const foo2 = randStr()

    // insertOne and insertMany
    const test = await BARS.insertOne({
      id: { foo: new Uuid(), bar: randStr() },
      foo,
    })
    match(test, {
      id: { foo: uuid(), bar: string },
      foo,
      createdAt: date(),
    })
    await assert.rejects(
      BARS.insertOne({ id: test.id, foo: foo2 }),
      ConflictError,
    )
    await assert.rejects(
      BARS.insertOne({ id: { foo: new Uuid(), bar: randStr() }, foo }),
      ConflictError,
    )
    match(
      await BARS.insertMany([
        { id: { foo: new Uuid(), bar: randStr() }, foo: foo2 },
      ]),
      [{ id: { foo: uuid(), bar: string }, foo: foo2, createdAt: date() }],
    )
    await assert.rejects(
      BARS.insertMany([{ id: { foo: new Uuid(), bar: randStr() }, foo: foo2 }]),
      ConflictError,
    )

    // find, findOne, findMany
    match(await BARS.find(test), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    match(await BARS.find(test.id), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    await assert.rejects(
      BARS.find({ foo: new Uuid(), bar: randStr() }),
      NotFoundError,
    )
    match(await BARS.findOne({ id: test }), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    match(await BARS.findOne({ id: test.id }), {
      id: test.id,
      foo: test.foo,
      createdAt: date(test.createdAt),
    })
    const pagination = {
      offest: 0,
      limit: 100,
      sort: { createdAt: 'asc' },
    } as const
    match(await BARS.findMany({}, pagination), [
      { id: { foo: uuid(), bar: string }, foo: string, createdAt: date() },
      { id: { foo: uuid(), bar: string }, foo: string, createdAt: date() },
    ])

    // count, iterate, paginate
    assert.equal(await BARS.count({}), 2)
    for await (const x of BARS.iterate({}, pagination)) {
      match(x, {
        id: { foo: uuid(), bar: string },
        foo: string,
        createdAt: date(),
      })
    }

    // findManyToMapBy
    const map = await BARS.findManyToMapBy(
      (x) => `${String(x.id.foo)}:${x.id.bar}`,
      {},
      pagination,
    )
    assert.equal(map.size, 2)
    match(map.get(`${String(test.id.foo)}:${test.id.bar}`), test)

    match(
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
      [
        { sort: { createdAt: 'asc' }, offset: 0, limit: 100, count: 1 },
        [
          {
            id: { foo: uuid(), bar: string },
            foo: string,
            createdAt: date(),
          },
        ],
      ],
    )
    match(
      await BARS.paginate(
        { createdIn: { end: test.createdAt } },
        {
          sort: { createdAt: 'asc' },
          offset: 0,
          limit: 100,
        },
      ),
      [
        { sort: { createdAt: 'asc' }, offset: 0, limit: 100, count: 1 },
        [
          {
            id: { foo: uuid(), bar: string },
            foo: string,
            createdAt: date(),
          },
        ],
      ],
    )

    // updateOne, updateMany
    await assert.rejects(
      BARS.updateOne({ id: { foo: new Uuid(), bar: randStr() } }, { bar: 123 }),
      NotFoundError,
    )
    match(await BARS.updateOne({ id: test }, { bar: 123 }), {
      id: test.id,
      foo: test.foo,
      bar: 123,
      createdAt: date(test.createdAt),
      updatedAt: date(),
    })
    match(await BARS.updateOne({ id: test }, { bar: Nil }), {
      id: test.id,
      foo: test.foo,
      bar: Nil,
      createdAt: date(test.createdAt),
      updatedAt: date(),
    })
    assert.equal(await BARS.updateMany({ foo: foo2 }, { bar: 456 }), 1)
    assert.equal(await BARS.updateMany({ foo: randStr() }, { bar: 789 }), 0)

    // deleteOne, deleteMany
    await assert.rejects(
      BARS.deleteOne({ id: { foo: new Uuid(), bar: randStr() } }),
      NotFoundError,
    )
    await BARS.deleteOne({ id: test })
    assert.equal(await BARS.findOne({ id: test }), Nil)
    await assert.rejects(BARS.deleteOne({ id: test }), NotFoundError)
    assert.equal(await BARS.deleteMany({}), 1)
    assert.equal(await BARS.deleteMany({}), 0)
  })

  test('getSortKey()', () => {
    assert.equal(getSortKey(Nil), Nil)
    assert.equal(getSortKey('foo'), 'foo')
    assert.equal(getSortKey(['foo']), 'foo')
    assert.equal(getSortKey([['foo', 1]]), 'foo')
    assert.equal(getSortKey({ foo: 1 }), 'foo')
    const map = new Map()
    map.set('foo', 1)
    assert.equal(getSortKey(map), 'foo')
  })

  test('query builders', () => {
    match(toValueOrAbsent(Nil), { $exists: false })
    match(toValueOrAbsent(null), { $exists: false })
    assert.equal(toValueOrAbsent(true), true)
    assert.equal(toValueOrAbsent(false), false)
    assert.equal(toValueOrAbsent(123), 123)
    assert.equal(toValueOrAbsent('foo'), 'foo')
    match(toValueOrAbsent([0, 1]), [0, 1])
    match(toValueOrAbsent({ foo: 'bar' }), { foo: 'bar' })

    match(toValueOrAbsentOrNil({ foo: Nil }, 'foo'), { $exists: false })
    assert.equal(toValueOrAbsentOrNil({} as { foo?: string }, 'foo'), Nil)
    assert.equal(toValueOrAbsentOrNil({ foo: 'bar' }, 'foo'), 'bar')
    assert.equal(
      toValueOrAbsentOrNil({ foo: 'bar' }, 'foo', (x) => x?.length),
      3,
    )

    assert.equal(toExistsOrNil(Nil), Nil)
    assert.equal(toExistsOrNil(null), Nil)
    match(toExistsOrNil(true), { $exists: true })
    match(toExistsOrNil(false), { $exists: false })

    assert.equal(toUnsetOrNil<{ foo?: unknown }>({}, 'foo'), Nil)
    assert.equal(toUnsetOrNil({ foo: 'bar' }, 'foo'), Nil)
    assert.equal(toUnsetOrNil({ foo: Nil }, 'foo'), true)
    assert.equal(toUnsetOrNil({ foo: null }, 'foo'), true)

    assert.equal(toValueOrInOrNil(Nil), Nil)
    assert.equal(toValueOrInOrNil(null), Nil)
    assert.equal(toValueOrInOrNil('foo'), 'foo')
    match(toValueOrInOrNil(['foo', 'bar']), { $in: ['foo', 'bar'] })
    const arr = ['foo', 'bar'] as const
    match(toValueOrInOrNil(arr), { $in: ['foo', 'bar'] })
    match(
      toValueOrInOrNil(['foo', 'bar'], (x) => x.length),
      { $in: [3, 3] },
    )
    match(
      toValueOrInOrNil(['foo', 'bar'] as const, (x) => x.length),
      { $in: [3, 3] },
    )

    const begin = new Date()
    const end = new Date()
    assert.equal(toRangeOrNil(), Nil)
    assert.equal(toRangeOrNil({}), Nil)
    assert.equal(toRangeOrNil({}, true), Nil)
    match(toRangeOrNil({ begin }), { $gte: date(begin) })
    match(toRangeOrNil({ begin }, true), { $gte: date(begin) })
    match(toRangeOrNil({ begin, end }), { $gte: date(begin), $lt: date(end) })
    match(toRangeOrNil({ begin, end }, true), {
      $gte: date(begin),
      $lte: date(end),
    })
    match(toRangeOrNil({ end }), { $lt: date(end) })
    match(toRangeOrNil({ end }, true), { $lte: date(end) })
  })

  test('base Models defaults', async () => {
    // a model that overrides only the required hooks, exercising the base
    // $query / $set / $unset / $sort defaults ({} / {} / {} / Nil)
    class Baz extends Model<StringDoc> {}
    class Bazs extends Models<
      StringDoc,
      Baz,
      object,
      { id: string },
      object,
      object
    > {
      get name(): string {
        return 'bazs'
      }
      $model(doc: StringDoc): Baz {
        return new Baz(doc)
      }
      $insert(values: { id: string }) {
        return { _id: values.id }
      }
    }

    await CONNECTION.migrate({ name: 'bazs' })
    const BAZS = new Bazs({ connection: CONNECTION })
    await BAZS.deleteMany({})

    const baz = await BAZS.insertOne({ id: randStr() })
    // base $query returns {} -> matches everything
    match(await BAZS.findOne({}), {
      id: baz.id,
      createdAt: date(baz.createdAt),
    })
    // base $sort returns Nil
    assert.equal((await BAZS.findMany({}, { sort: {} })).length, 1)
    // base $inc/$set/$unset return {} -> the update only bumps updated_at
    match(await BAZS.updateOne({}, {}), {
      id: baz.id,
      createdAt: date(baz.createdAt),
      updatedAt: date(),
    })

    await BAZS.deleteMany({})
  })
})

function randStr(length = 8): string {
  assert(Number.isInteger(length) && length > 0)
  return randomBytes(length / 2)
    .toString('base64')
    .substring(0, length)
}
