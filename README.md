# @potentia/model7

Model utility based on
[@potentia/util](https://github.com/potentia-inc/ts-util) and
[@potentia/mongodb7](https://github.com/potentia-inc/ts-mongodb7)

## Model

Refer to the tests for additional details.

  - `test/foo.ts`: example for a UUID-key model
  - `test/bar.ts`: example for a composite-key model

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

    // The lock will be active for `ttl` seconds and will automatically extend
    // approximately every `ttl / 2` seconds. The default is `3` seconds.
    ttl: 3,

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
  await locks.deleteOne(lock) // release the lock
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

  // The minimum interval (in seconds) between consecutive requests. Default: 0.01.
  interval: 0.2,

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
      // TTL (in seconds) for the upstream cache.
      // Default: 60 (load upstreams every 60 seconds).
      ttl: 60,

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
