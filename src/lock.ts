import assert from 'node:assert'
import { getMessage } from './error.js'
import { LockError, RelockError, UnlockError } from './error/lock.js'
import {
  Filter,
  InsertionOf,
  Model,
  ModelOrId,
  Models,
  Options,
  pickIdOrNil,
  StringDoc,
  STRING_DOC_SCHEMA,
  UpdateFilter,
  isDuplicationError,
} from './model.js'
import { Nil, TypeOrNil, isNullish } from './type.js'
import { msleep, option } from './util.js'

export const LOCK_NAME = 'locks'
export type LockOrId = ModelOrId<Lock>
export type LockOrNil = TypeOrNil<Lock>

export type LockDoc = StringDoc & {
  expires_at: Date
}

export class Lock extends Model<LockDoc> {
  expiresAt: Date

  constructor(doc: LockDoc) {
    super(doc)

    this.expiresAt = doc.expires_at
  }
}

export type LockId = Lock['id']

export const LOCK_SCHEMA = {
  name: LOCK_NAME,
  validator: {
    $jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['_id', 'expires_at', 'created_at'],
      properties: {
        ...STRING_DOC_SCHEMA,
        expires_at: { bsonType: 'date' },
      },
    },
  },
  indexes: {
    lock_index: { keys: { _id: 1, expires_at: 1 } },
    expiration_index: {
      keys: { expires_at: 1 },
      options: { expireAfterSeconds: 0 },
    },
  },
}

export type LockQuery = {
  id?: LockOrId
  expiresAt?: Date
}
export type LockInsert = {
  id: string
  expiresAt: Date
}
export type LockUpdate = {
  expiresAt: Date
}
export type LockSort = {
  createdAt?: 'asc' | 'desc'
  expiresAt?: 'asc' | 'desc'
}

export class Locks extends Models<
  LockDoc,
  Lock,
  LockQuery,
  LockInsert,
  LockUpdate,
  LockSort
> {
  get name(): string {
    return LOCK_NAME
  }

  $model(doc: LockDoc): Lock {
    return new Lock(doc)
  }

  $query(query: LockQuery): Filter<LockDoc> {
    return { _id: pickIdOrNil(query.id), expires_at: query.expiresAt }
  }

  $insert(values: LockInsert): InsertionOf<LockDoc> {
    return { _id: values.id, expires_at: values.expiresAt }
  }

  $set(values: LockUpdate): UpdateFilter<LockDoc> {
    return { expires_at: values.expiresAt }
  }

  $sort(sort?: LockSort) {
    if (isNullish(sort)) return Nil
    return {
      ...option('created_at', sort.createdAt),
      ...option('expires_at', sort.expiresAt),
    }
  }

  async trylock(values: LockInsert, options: Options = {}): Promise<LockOrNil> {
    const $now = options.$now ?? new Date()
    try {
      const locked = await this.collection.findOneAndUpdate(
        { _id: values.id, expires_at: { $lt: $now } },
        {
          $set: { ...this.$set(values), updated_at: $now },
          $setOnInsert: { _id: values.id, created_at: $now },
        },
        { returnDocument: 'after', upsert: true, ...options },
      )
      return isNullish(locked) ? Nil : this.$model(locked)
    } catch (err) {
      if (isDuplicationError(err)) return Nil
      throw err
    }
  }

  async relock(
    lock: Lock,
    values: LockUpdate,
    options: Options = {},
  ): Promise<Lock> {
    const $now = options.$now ?? new Date()
    const relocked = await this.collection.findOneAndUpdate(
      { _id: lock.id, expires_at: lock.expiresAt },
      { $set: { ...this.$set(values), updated_at: $now } },
      { returnDocument: 'after', ...options },
    )
    if (isNullish(relocked)) throw new RelockError()
    return this.$model(relocked)
  }

  async lock<T>(
    key: string,
    exec: (signal: AbortSignal) => Promise<T>,
    options: {
      ttl?: number // in second
      retries?: number
      onError?: (err: Error) => void
    } = {},
  ): Promise<T> {
    const ttl = (options.ttl ?? 3) * 1000 // to ms
    const retries = options.retries ?? 0 // no retry by default
    assert(ttl >= 1)
    assert(Number.isInteger(retries) && retries >= 0)

    const timeout = Math.ceil(ttl / 2)
    const until = () => new Date(Date.now() + ttl)

    const state = {
      retries: 0,
      heartbeating: true,
      lock: await this.trylock({ id: key, expiresAt: until() }),
    }
    if (isNullish(state.lock)) throw new LockError()

    const abortController = new AbortController()
    const heartbeat = (async () => {
      await msleep(timeout)
      while (state.heartbeating && !isNullish(state.lock)) {
        try {
          state.lock = await this.relock(state.lock, { expiresAt: until() })
          state.retries = 0
        } catch (err) {
          if (state.retries === retries) {
            state.lock = Nil
            options.onError?.(new RelockError(getMessage(err)))
            abortController.abort()
            break
          }
          ++state.retries
        }
        await msleep(state.retries > 0 ? Math.min(10, timeout) : timeout)
      }
    })()

    try {
      return await exec(abortController.signal)
    } finally {
      state.heartbeating = false
      await heartbeat
      if (!isNullish(state.lock)) {
        const lock = state.lock
        state.lock = Nil
        await this.deleteOne(lock).catch((err) => {
          options.onError?.(new UnlockError(getMessage(err)))
        })
      }
    }
  }
}
