import assert from 'node:assert'
import { ConflictError, NotFoundError, UnacknowledgedError } from './error.js'
import {
  Collection,
  CommandOperationOptions,
  Connection,
  Filter,
  FindCursor,
  isDuplicationError,
  OptionalUnlessRequiredId,
  Sort,
  UpdateFilter,
  WithId,
} from './mongo.js'
import { ObjectId, Uuid, Nil, TypeOrNil, isNullish } from './type.js'

export { Filter, WithId, UpdateFilter, isDuplicationError } from './mongo.js'

export type Timestamp = {
  created_at: Date
  updated_at?: Date
}

export const TIMESTAMP_SCHEMA = {
  created_at: { bsonType: 'date' },
  updated_at: { bsonType: 'date' },
}

type Doc<Id> = { _id: Id } & Timestamp

export type NumberDoc = { _id: number } & Timestamp
export const NUMBER_DOC_SCHEMA = {
  _id: { type: 'number' },
  ...TIMESTAMP_SCHEMA,
}

export type StringDoc = { _id: string } & Timestamp
export const STRING_DOC_SCHEMA = {
  _id: { type: 'string' },
  ...TIMESTAMP_SCHEMA,
}

export type UuidDoc = { _id: Uuid } & Timestamp
export const UUID_DOC_SCHEMA = {
  _id: { bsonType: 'binData' },
  ...TIMESTAMP_SCHEMA,
}

export type ObjectIdDoc = { _id: ObjectId } & Timestamp
export const OBJECTID_DOC_SCHEMA = {
  _id: { bsonType: 'binData' },
  ...TIMESTAMP_SCHEMA,
}

export class Model<D extends Doc<unknown>> {
  id: D['_id']
  createdAt: Date
  updatedAt?: Date

  constructor(doc: D) {
    this.id = doc._id
    this.createdAt = doc.created_at
    this.updatedAt = doc.updated_at
  }
}

type ModelLike<Id> = {
  id: Id
  createdAt: Date
  updatedAt?: Date
}
export type ModelOrId<
  M extends {
    id: unknown
    createdAt: Date
    updatedAt?: Date
  },
> = M | M['id']

function isModelLike<Id>(x: unknown): x is ModelLike<Id> {
  return (
    typeof x === 'object' &&
    x !== null &&
    'id' in x &&
    'createdAt' in x &&
    x.createdAt instanceof Date &&
    'updatedAt' in x &&
    (x.updatedAt === Nil || x.updatedAt instanceof Date)
  )
}

export function pickId<Id>(x: ModelLike<Id> | Id): Id {
  return isModelLike(x) ? x.id : x
}

export function pickIdOrNil<Id>(x?: ModelLike<Id> | Id | null): Id | Nil {
  return isNullish(x) ? Nil : pickId<Id>(x)
}

export type Options = CommandOperationOptions & { $now?: Date }

export abstract class Models<
  D extends Doc<unknown>,
  M extends Model<D>,
  Q,
  I,
  U,
  S,
> {
  readonly connection: Connection

  constructor(options: { connection: Connection }) {
    this.connection = options.connection
  }

  get collection(): Collection<D> {
    return this.connection.db.collection<D>(this.name, {
      ignoreUndefined: true,
    })
  }

  abstract get name(): string
  abstract $model(
    doc: D | WithId<D> | OptionalUnlessRequiredId<D>,
    options?: Options,
  ): M
  abstract $insert(values: I, options?: Options): Omit<D, 'created_at'>
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $query(query: Q, options?: Options): Filter<D> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $inc(values: U, options?: Options): UpdateFilter<D> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $set(values: U, options?: Options): UpdateFilter<D> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $unset(values: U, options?: Options): UpdateFilter<D> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  $sort(sort?: S): TypeOrNil<Sort> {
    return Nil
  }

  async find(id: ModelOrId<M>, options: Options = {}): Promise<M> {
    const _id = pickId(id)
    if (_id !== id) return id as M
    const found = await this.collection.findOne({ _id } as Filter<D>, options)
    if (isNullish(found)) throw new NotFoundError(`Not Found: ${this.name}`)
    return this.$model(found, options)
  }

  async findOne(
    query: Q = {} as Q,
    options: Options = {},
  ): Promise<TypeOrNil<M>> {
    const found = await this.collection.findOne(
      this.$query(query, options),
      options,
    )
    return isNullish(found) ? Nil : this.$model(found, options)
  }

  async findMany(
    query: Q = {} as Q,
    pagination: Partial<Pagination<S>> = {},
    options: Options = {},
  ): Promise<M[]> {
    return await this.iterate(query, pagination, options).toArray(options)
  }

  async findManyToMapBy<T>(
    by: (x: M) => T,
    query: Q = {} as Q,
    pagination: Partial<Pagination<S>> = {},
    options: Options = {},
  ) {
    const map = new Map<T, M>()
    const cursor = this.iterate(query, pagination, options)
    for await (const x of cursor) map.set(by(x), x)
    return map
  }

  iterate(
    query: Q = {} as Q,
    pagination: Partial<Pagination<S>> = {},
    options: Options = {},
  ): Cursor<D, M> {
    const cursor = this.collection.find(this.$query(query, options), options)
    const { offset, limit } = pagination
    const sort = this.$sort(pagination.sort)
    if (!isNullish(sort)) cursor.sort(sort)
    if (!isNullish(offset)) cursor.skip(offset)
    if (!isNullish(limit)) cursor.limit(limit)
    return new Cursor<D, M>((x) => this.$model(x, options), cursor)
  }

  async paginate(
    query: Q = {} as Q,
    pagination: Partial<Pagination<S>> = {},
    options: Options = {},
  ): Promise<[Pagination<S>, M[]]> {
    const max = 1000
    const { offset = 0 } = pagination
    const limit = Math.min(pagination.limit ?? max, max)
    assert(offset >= 0 && Number.isInteger(offset))
    assert(limit >= 0 && limit <= max && Number.isInteger(limit))
    const filter = this.$query(query)
    const count = await this.collection.countDocuments(filter, options)
    const cursor = this.collection.find(filter, options)
    const sort = this.$sort(pagination.sort)
    if (!isNullish(sort)) cursor.sort(sort)
    const docs = await cursor.skip(offset).limit(limit).toArray()
    return [
      { sort: pagination.sort, offset, limit, count },
      docs.map((x) => this.$model(x, options)),
    ]
  }

  async count(query: Q = {} as Q, options: Options = {}): Promise<number> {
    return await this.collection.countDocuments(
      this.$query(query, options),
      options,
    )
  }

  async insertOne(values: I, options: Options = {}): Promise<M> {
    try {
      const $options = { ...options, $now: options.$now ?? new Date() }
      const inserted = {
        created_at: $options.$now,
        ...this.$insert(values, $options),
      } as OptionalUnlessRequiredId<D>
      const { acknowledged } = await this.collection.insertOne(
        inserted,
        $options,
      )
      if (acknowledged) return this.$model(inserted, $options)
    } catch (err) {
      throw isDuplicationError(err)
        ? new ConflictError(`Conflict: ${this.name}`)
        : err
    }
    throw new UnacknowledgedError()
  }

  async insertMany(values: I[], options: Options = {}): Promise<M[]> {
    if (values.length === 0) return []
    try {
      const $options = { ...options, $now: options.$now ?? new Date() }
      const inserted = values.map((x) => ({
        created_at: $options.$now,
        ...this.$insert(x, $options),
      })) as OptionalUnlessRequiredId<D>[]
      const { acknowledged } = await this.collection.insertMany(
        inserted,
        $options,
      )
      if (acknowledged) return inserted.map((x) => this.$model(x, $options))
    } catch (err) {
      throw isDuplicationError(err)
        ? new ConflictError(`Conflict: ${this.name}`)
        : err
    }
    throw new UnacknowledgedError()
  }

  async updateOne(
    id: ModelOrId<M>,
    values: U,
    options: Options = {},
  ): Promise<M> {
    const $options = { ...options, $now: options.$now ?? new Date() }
    const updated = await this.collection.findOneAndUpdate(
      { _id: pickId(id) } as Filter<D>,
      {
        $inc: this.$inc(values, $options),
        $set: { updated_at: $options.$now, ...this.$set(values, $options) },
        $unset: this.$unset(values, $options),
      } as UpdateFilter<D>,
      { returnDocument: 'after', ...$options },
    )
    if (isNullish(updated)) throw new NotFoundError(`Not Found: ${this.name}`)
    return this.$model(updated, $options)
  }

  async updateMany(
    query: Q,
    values: U,
    options: Options = {},
  ): Promise<number> {
    const $options = { ...options, $now: options.$now ?? new Date() }
    const { modifiedCount } = await this.collection.updateMany(
      this.$query(query, $options),
      {
        $inc: this.$inc(values, $options),
        $set: { updated_at: $options.$now, ...this.$set(values, $options) },
        $unset: this.$unset(values, $options),
      } as UpdateFilter<D>,
      $options,
    )
    return modifiedCount
  }

  async deleteOne(id: ModelOrId<M>, options: Options = {}): Promise<void> {
    const { deletedCount } = await this.collection.deleteOne(
      { _id: pickId(id) } as Filter<D>,
      options,
    )
    if (deletedCount !== 1) throw new NotFoundError(`Not Found: ${this.name}`)
  }

  async deleteMany(query: Q = {} as Q, options: Options = {}): Promise<number> {
    const { deletedCount } = await this.collection.deleteMany(
      this.$query(query, options),
      options,
    )
    return deletedCount
  }
}

export class Cursor<D extends Doc<unknown>, M extends Model<D>> {
  #model: (d: D | WithId<D>, options?: Options) => M
  #cursor: FindCursor<WithId<D>>

  constructor(
    model: (d: D | WithId<D>, options?: Options) => M,
    cursor: FindCursor<WithId<D>>,
  ) {
    this.#model = model
    this.#cursor = cursor
  }

  async *[Symbol.asyncIterator]() {
    try {
      for await (const x of this.#cursor) {
        yield this.#model(x)
      }
    } finally {
      await this.#cursor.close()
    }
  }

  async toArray(options?: Options) {
    return (await this.#cursor.toArray()).map((x) => this.#model(x, options))
  }
}

export type Pagination<S> = {
  sort?: S
  offset: number
  limit: number
  count: number
}

export function getSortKey(sort?: Sort) {
  if (typeof sort === 'string') return sort

  if (Array.isArray(sort)) {
    if (sort.length === 0) return Nil

    // [string, SortDirection][]
    if (Array.isArray(sort[0])) {
      return (sort[0] as [string, unknown])[0]
    }

    // string[]
    return sort[0] as string
  }

  if (sort instanceof Map) {
    const first = sort.keys().next()
    return first.done ? Nil : first.value
  }

  if (typeof sort === 'object' && !isNullish(sort)) {
    return Object.keys(sort)[0]
  }

  return Nil
}

export type InsertionOf<T> = Omit<T, 'created_at'>

export function toValueOrAbsent<T>(value?: T | null): T | { $exists: false } {
  return isNullish(value) ? { $exists: false } : value
}

export function toValueOrAbsentOrNil<
  T extends object,
  K extends keyof T,
  S = T[K],
>(
  values: T,
  key: K,
  map: (x?: T[K] | null) => S | Nil = (x?: T[K] | null) =>
    isNullish(x) ? Nil : (x as unknown as S),
): S | { $exists: false } | Nil {
  return key in values ? toValueOrAbsent(map(values[key])) : Nil
}

export function toExistsOrNil(
  $exists?: boolean | null,
): { $exists: boolean } | Nil {
  return isNullish($exists) ? Nil : { $exists }
}

export function toUnsetOrNil<T extends object>(
  values: T,
  key: keyof T,
): true | Nil {
  return key in values && isNullish(values[key]) ? true : Nil
}

export function toValueOrInOrNil<S, T = S>(
  x: Nil | null | S | readonly S[],
  map: (x: S) => T = (x: S) => x as unknown as T,
): T | { $in: T[] } | Nil {
  if (isNullish(x)) return Nil
  if (Array.isArray(x)) return { $in: x.map(map) }
  return map(x as S)
}

export function toRangeOrNil<B, E>(
  {
    begin,
    end,
  }: {
    begin?: B
    end?: E
  } = {},
  inclusiveEnd = false,
) {
  return isNullish(begin) && isNullish(end)
    ? Nil
    : { $gte: begin, [inclusiveEnd ? '$lte' : '$lt']: end }
}
