# @potentia/model7

A small, typed MongoDB modeling layer built on
[@potentia/util](https://github.com/potentia-inc/ts-util) and
[@potentia/mongodb7](https://github.com/potentia-inc/ts-mongodb7). It maps
snake_case Mongo documents to camelCase model instances and adds typed CRUD,
pagination, distributed locks and weighted upstream selection.

- [connection](#connection): create the `Connection` your models share
- [model](#model): the `Model`/`Models` base classes — typed CRUD, queries and
  pagination over a collection
- [lock](#lock): distributed, auto-extending locks (`Locks`)
- [upstream](#upstream): the `Upstream` model — a request target with headers,
  query and a rate-limit interval
- [upstream pool](#upstreampool): weighted upstream selection with failure decay
- [rate limiting](#rate-limiting): a pluggable `RateLimiter` (in-process, or a
  shared store)

Re-export entry points: `@potentia/model7/mongo` (`Connection` + the `mongodb`
types), `@potentia/model7/type` (`Uuid`, `ObjectId`, `Nil`, coercions),
`@potentia/model7/util` (`Duration`, `sleep`, …) and `@potentia/model7/error`
(`NotFoundError`, `ConflictError`, …).

## Runtime support

Works on **Node.js (>= 22)**, **Bun** and **Deno (>= 2)**. The published package
ships compiled JavaScript plus type declarations. `@potentia/util` and
`@potentia/mongodb7` are bundled as **dependencies**; the `mongodb` driver is a
**peer dependency** you provide, so its BSON types (`UUID`, `ObjectId`) keep a
single identity across your app. A framework-free `smoke.mjs` exercises a
live-MongoDB round trip on Node, Bun and Deno; the `node:test` suites run on Node
and Deno (Bun cannot run `node:test` yet —
[oven-sh/bun#5090](https://github.com/oven-sh/bun/issues/5090)).

```sh
npm install @potentia/model7 mongodb   # or: bun add / deno add
```

## Connection

Everything takes a `Connection` (re-exported from `@potentia/mongodb7`). Create
one, connect, run `migrate()` to create each collection with its validator and
indexes, and pass it to your models:

```typescript
import { Connection } from '@potentia/model7/mongo'
import { FOO_SCHEMA, Foos } from './foo.js'

const connection = new Connection(process.env.MONGO_URI)
await connection.connect()
await connection.migrate(FOO_SCHEMA) // create/upgrade the collection + indexes

const foos = new Foos({ connection })
// ... use the model ...

await connection.disconnect()
```

## Model

`Models<D, M, Q, I, U, S>` is the base class for a collection. It maps a
snake_case document `D` to a camelCase model `M`, parameterised by the shapes of
a query `Q`, an insert `I`, an update `U` and a sort `S`. You subclass it and
implement a few small hooks that translate those shapes into Mongo
filters/updates; `created_at`/`updated_at` are managed for you.

```typescript
import {
  Filter,
  InsertionOf,
  Model,
  ModelOrId,
  Models,
  UUID_DOC_SCHEMA,
  UpdateFilter,
  UuidDoc,
  pickIdOrNil,
  toRangeOrNil,
  toUnsetOrNil,
} from '@potentia/model7'
import { Uuid } from '@potentia/model7/type'
import { option } from '@potentia/model7/util'

// 1. the document (at rest, snake_case) and the model (camelCase)
type FooDoc = UuidDoc & { foo: string; bar?: number }

class Foo extends Model<FooDoc> {
  foo: string
  bar?: number
  constructor(doc: FooDoc) {
    super(doc) // sets id, createdAt, updatedAt
    this.foo = doc.foo
    this.bar = doc.bar
  }
}

// 2. the collection schema (name + JSON-schema validator + indexes)
export const FOO_SCHEMA = {
  name: 'foos',
  validator: {
    $jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['_id', 'foo', 'created_at'],
      properties: {
        ...UUID_DOC_SCHEMA,
        foo: { type: 'string' },
        bar: { type: 'number' },
      },
    },
  },
  indexes: { foo_unique: { keys: { foo: 1 }, options: { unique: true } } },
}

// 3. the API shapes (query / insert / update / sort)
type FooQuery = {
  id?: ModelOrId<Foo>
  foo?: string
  createdIn?: { begin?: Date; end?: Date }
}
type FooInsert = { id?: Uuid; foo: string; bar?: number }
type FooUpdate = { foo?: string; bar?: number }
type FooSort = { createdAt?: 'asc' | 'desc' }

// 4. the collection — implement the hooks
export class Foos extends Models<
  FooDoc,
  Foo,
  FooQuery,
  FooInsert,
  FooUpdate,
  FooSort
> {
  get name() {
    return 'foos'
  }
  $model(doc: FooDoc) {
    return new Foo(doc)
  }
  $insert(values: FooInsert): InsertionOf<FooDoc> {
    return { _id: values.id ?? new Uuid(), foo: values.foo, bar: values.bar }
  }
  $query(query: FooQuery): Filter<FooDoc> {
    return {
      _id: pickIdOrNil(query.id),
      foo: query.foo,
      created_at: toRangeOrNil(query.createdIn),
    }
  }
  $set(values: FooUpdate): UpdateFilter<FooDoc> {
    return { foo: values.foo, bar: values.bar }
  }
  $unset(values: FooUpdate): UpdateFilter<FooDoc> {
    return { bar: toUnsetOrNil(values, 'bar') }
  }
  $sort(sort: FooSort) {
    return { ...option('created_at', sort.createdAt) }
  }
}
```

`test/foo.ts` (UUID key) and `test/bar.ts` (composite key) are complete, runnable
versions.

### Hooks

Only `name`, `$model` and `$insert` are required; the rest default to an empty
filter/update (so an un-overridden model matches everything and an update only
bumps `updated_at`). Because the collection runs with `ignoreUndefined`, any
`undefined` field a hook returns is simply omitted.

| hook                          | maps to                                       |
| ----------------------------- | --------------------------------------------- |
| `get name`                    | the collection name                           |
| `$model(doc)`                 | a model instance from a document              |
| `$insert(values)`             | a document to insert (without `created_at`)   |
| `$query(query)`               | a Mongo `Filter`                              |
| `$set` / `$unset` / `$inc`    | the `$set` / `$unset` / `$inc` of an update   |
| `$sort(sort)`                 | a Mongo `Sort`                                |

### API

```typescript
await foos.insertOne({ foo: 'a' }) // -> Foo (ConflictError on a duplicate key)
await foos.insertMany([{ foo: 'b' }]) // -> Foo[]

await foos.find(id) // by primary key; throws NotFoundError
await foos.findOne({ foo: 'a' }) // the first match, or Nil
await foos.findMany({}, { sort: { createdAt: 'asc' }, offset: 0, limit: 100 })
await foos.count({ foo: 'a' })
await foos.paginate(query, pagination) // -> [pagination & { count }, Foo[]]
for await (const foo of foos.iterate(query, pagination)) {
  // stream large result sets
}
await foos.findManyToMapBy((x) => String(x.id), query) // -> Map<string, Foo>

await foos.updateOne({ id }, { bar: 1 }) // the first match; throws NotFoundError
await foos.updateMany({ foo: 'a' }, { bar: 1 }) // -> modified count
await foos.deleteOne({ id }) // throws NotFoundError if nothing was deleted
await foos.deleteMany({ foo: 'a' }) // -> deleted count
```

`updateOne`/`deleteOne` take a **query** — the singular form of
`updateMany`/`deleteMany`; target a single document by primary key with `{ id }`.
Pagination is `{ sort?, offset, limit }` plus a returned `count`; cap `limit` per
call with the `$max` option. Errors (`NotFoundError`, `ConflictError`,
`UnacknowledgedError`) come from `@potentia/model7/error`.

### Helpers

For building hook results: `pickId`/`pickIdOrNil` (a model-or-id to its id),
`toRangeOrNil` (`{ begin, end }` → `{ $gte, $lt }`), `toValueOrInOrNil` (a value
or array → the value or `{ $in }`), `toValueOrAbsent`/`toValueOrAbsentOrNil` (a
value or `{ $exists: false }`), `toExistsOrNil`, `toUnsetOrNil`, `getSortKey` and
`option`. Document/schema building blocks: `Timestamp` + `TIMESTAMP_SCHEMA`, and
`UuidDoc`/`StringDoc`/`NumberDoc`/`ObjectIdDoc` with matching `*_DOC_SCHEMA`.

## Lock

```typescript
import { Locks } from '@potentia/model7/lock'
import {
  LockingError, // Base class for all locking-related errors
  LockError,    // Thrown when acquiring a lock fails
  RelockError,  // Thrown when extending a lock fails
  UnlockError,  // Thrown when releasing a lock fails
} from '@potentia/model7/error/lock'

const locks = new Locks({ connection: ... })

await locks.lock(
  'foobar', // A unique key to acquire the lock
  async (signal: AbortSignal) => {
    // You can abort if the lock extension fails,
    // or choose to ignore it and continue processing the tasks
    // (at your own risk, as the process may proceed without the lock).
    while (!signal.aborted) {
      await ... // Some sub-tasks within a long-running process
    }
  },
  {
    // All the following options are optional

    // The lock stays active for `ttl` and auto-extends about every `ttl / 2`.
    // `ttl` is a Duration: a number is milliseconds, or a string like '3s' /
    // '500ms'. The default is '3s'.
    ttl: '3s',

    // Retry up to `retries` times if the lock extension fails.
    // The default is `0` (no retry).
    retries: 2,

    // Callback for handling errors when failing to extend or release the lock.
    // The default is `undefined` (no error handling).
    onError: (err) => console.error(err)
  },
)

// You can also use the low-level methods to handle the locking manually.
// Refer to the `Locks.lock<T>()` implementation for examples and additional
// details.

// aquire the lock
const lock = await Locks.trylock({ id: 'foobar', expiresAt: ... })
if (lock !== undefined) {
  await locks.relock(lock, { expiresAt: ... }) // extend the lock
  await locks.deleteOne({ id: lock }) // release the lock
}
```

## Upstream

```typescript
import { Upstreams } from '@potentia/model7/upstream'
import {
  UpstreamError, // Base class for all upstream-related errors
  NoUpstreamError, // Thrown when no upstream is available
} from '@potentia/model7/error/upstream'

const upstreams = new Upstreams({ connection: ... })
const upstream = await upstreams.insertOne({
  type: 'foobar',
  host: 'https://foobar.com/api',
  path: 'foo',
  headers: { ... },
  searchs: { a: 'foo', b: 'bar' },

  // The minimum spacing between consecutive requests, as a Duration (a number
  // is milliseconds, or a string like '200ms' / '0.2s'). Stored as seconds in
  // the DB but read back as milliseconds on `upstream.interval`. Default: '1ms'.
  interval: '200ms',

  // The weight of this upstream. Set to a positive number to enable it. Default: 0.
  weight: 0.5,
})

upstream.url() // URL object
upstream.url().toString() // https://foobar.com/api/foo?a=foo&b=bar
upstream.link() // the same as u.url().toString()
upstream.link({
  path: 'bar',
  searchs: { c: 'foobar' },
}) // https://foobar.com/api/bar?a=foo&b=bar&c=foobar
```

## UpstreamPool

```typescript
import { Upstreams } from '@potentia/model7/upstream'
import { UpstreamPool } from '@potentia/model7/upstream/pool'

const upstreams = new Upstreams({ connection: ... })
const pool = new UpstreamPool({
  // the function to load the upstreams is required
  load: (type: string) => upstreams.findMany({ type, gtWeight: 0 }),

  // the function to set the pool parameters is optional
  init: (type: string) => {
    // set pool parameters for a specific type
    if (type === '...') return { ... }

    // or set pool parameters for all types
    return {
      // TTL for the upstream cache, as a Duration (a number is milliseconds,
      // or a string like '60s'). Default: '60s'.
      ttl: '60s',

      /*
      Weight decay logic:
        if success:
          reset weight to its original value
        if failure:
          if failure count >= minFailures:
            weight = weight * decay
      */

      // Enables weight decay when the failure count reaches minFailures.
      // Default: 0.
      minFailures: 0,

      // Mimimum weight after decay. Default: 0.01.
      minWeight: 0.1,

      // Decay factor applied to weight. Default: 0.8.
      decay: 0.5,
    }
  }
})

// Select an upstream randomly, weighted by upstream.weight.
const upstream = await pool.sample(type)

// Pick the given upstream if available.
await pool.sample(type, { type: 'same', upstream })

// Pick a different upstream if possible.
await pool.sample(type, { type: 'diff', upstream })

// Marks `upstream` as successful (resets the failure count to 0).
pool.succeed(upstream)

// Marks `upstream` as failed (increments the failure count).
pool.fail(upstream)
```

## Rate limiting

Each upstream has an `interval` — the minimum spacing between consecutive
requests to it. `UpstreamPool` enforces this through a pluggable `RateLimiter`,
whose `interval` is a [Duration](https://github.com/potentia-inc/ts-util) (a
number is milliseconds):

```typescript
import { Duration } from '@potentia/util'

interface RateLimiter {
  // Block until a request for `key` may proceed, enforcing >= `interval` spacing.
  reserve(key: string, interval: Duration): Promise<void>
  // Optional: drop any state held for a removed upstream.
  forget?(key: string): void
}
```

The default is `LocalRateLimiter`, which spaces requests **per process**. That is
enough for a single worker, but N workers each running their own pool would issue
up to N× the intended rate. For a fixed fleet, tell each worker how many share
the budget — every worker then spaces locally at `interval × workers`, keeping
the aggregate within the global limit with no shared state:

```typescript
import { UpstreamPool } from '@potentia/model7/upstream/pool'
import { LocalRateLimiter } from '@potentia/model7/upstream/rate-limiter'

const pool = new UpstreamPool({
  load: (type) => upstreams.findMany({ type, gtWeight: 0 }),
  rateLimiter: new LocalRateLimiter({ workers: 4 }), // a 4-worker fleet
})
```

For a fleet that scales at runtime, adjust the divisor live — the new value
applies to subsequent requests:

```typescript
const limiter = new LocalRateLimiter({ workers: 4 })
// ... later, when the fleet scales:
limiter.workers = 6
```

This is a ceiling, not a scheduler: under-counting `workers` breaks the global
limit, while over-counting just under-utilizes it (an idle worker's share is
wasted). When scaling down, lower `workers` only once the workers have actually
stopped. For an autoscaling fleet where the worker count can't be bounded,
implement `RateLimiter` against a shared store. Two recipes follow — copy and
adapt them; they are intentionally not shipped, so you own the collection,
failure policy and dependencies.

### MongoDB recipe (token lease)

Coordinate globally by advancing a per-key `next_at` atomically and **server-side**
(via `$$NOW`, so it is free of cross-worker clock skew). Reserve a batch of
`lease` slots per round-trip to keep DB load at `rate / lease` on hot upstreams —
the answer to "small intervals hammer the DB". You own the collection and its
TTL index:

```typescript
import { Connection } from '@potentia/model7/mongo'
import { RateLimiter } from '@potentia/model7/upstream/rate-limiter'
import { Duration, msleep, toMs } from '@potentia/model7/util'

// db.upstream_rate.createIndex({ next_at: 1 }, { expireAfterSeconds: 86400 })

class MongoRateLimiter implements RateLimiter {
  #credits = new Map<string, { at: number; left: number }>()

  constructor(
    private connection: Connection,
    private lease = 1, // slots reserved per DB round-trip
    private name = 'upstream_rate',
  ) {}

  async reserve(key: string, interval: Duration): Promise<void> {
    const intervalMs = toMs(interval)
    let credit = this.#credits.get(key)
    if (credit === undefined || credit.left <= 0) {
      const span = intervalMs * this.lease
      const doc = await this.connection.db
        .collection(this.name)
        .findOneAndUpdate(
          { _id: key },
          [
            {
              $set: {
                next_at: {
                  $add: [
                    { $max: [{ $ifNull: ['$next_at', '$$NOW'] }, '$$NOW'] },
                    span,
                  ],
                },
              },
            },
          ],
          { upsert: true, returnDocument: 'after' },
        )
      const end = (doc!.next_at as Date).getTime() // reserved window end (server clock)
      credit = { at: end - span, left: this.lease }
      this.#credits.set(key, credit)
    }
    const wait = credit.at - Date.now() // local clock (assumes NTP-level sync)
    credit.at += intervalMs
    credit.left -= 1
    if (wait > 0) await msleep(wait)
  }

  forget(key: string): void {
    this.#credits.delete(key)
  }
}
```

As written this is **fail-closed**: a DB error rejects `reserve()`, so the
request is blocked and the limit is never breached. Wrap the `findOneAndUpdate`
in a `try/catch` that returns instead to fail open (keep traffic flowing during a
DB outage, at the risk of exceeding the limit).

### Redis recipe

Redis is the better fit for high request rates — a single hot Mongo document
serializes on its write lock, whereas Redis is built for atomic counters. A Lua
script advances the per-key "next allowed" time and returns how long to wait:

```typescript
import { createClient } from 'redis'
import { RateLimiter } from '@potentia/model7/upstream/rate-limiter'
import { Duration, msleep, toMs } from '@potentia/model7/util'

// KEYS[1]=key, ARGV[1]=intervalMs, ARGV[2]=now(ms) -> ms to wait
const SCRIPT = `
  local next = tonumber(redis.call('GET', KEYS[1]) or '0')
  local now = tonumber(ARGV[2])
  local at = math.max(now, next)
  redis.call('SET', KEYS[1], at + tonumber(ARGV[1]), 'PX', 86400000)
  return at - now
`

class RedisRateLimiter implements RateLimiter {
  constructor(private redis: ReturnType<typeof createClient>) {}

  async reserve(key: string, interval: Duration): Promise<void> {
    const wait = (await this.redis.eval(SCRIPT, {
      keys: [`rate:${key}`],
      arguments: [String(toMs(interval)), String(Date.now())],
    })) as number
    if (wait > 0) await msleep(wait)
  }
}
```
