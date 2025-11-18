import assert from 'node:assert'
import { debug } from 'node:util'
import { NoUpstreamError } from './error/upstream.js'
import {
  Filter,
  InsertionOf,
  Model,
  ModelOrId,
  Models,
  UUID_DOC_SCHEMA,
  UpdateFilter,
  UuidDoc,
  pickId,
  pickIdOrNil,
  toUnsetOrNil,
} from './model.js'
import { Nil, TypeOrNil, toUuid, isNullish } from './type.js'
import { msleep, option } from './util.js'

const DEBUG = debug('potentia:model:upstream')
const DEBUG_VERBOSE = debug('potentia:model:upstream:verbose')

export const UPSTREAM_NAME = 'upstreams'

export type UpstreamOrId = ModelOrId<Upstream>
export type UpstreamOrNil = TypeOrNil<Upstream>

export type UpstreamDoc = UuidDoc & {
  type: string
  host: string
  path?: string
  headers?: Record<string, string>
  searchs?: Record<string, string>
  auth?: Record<string, string>
  interval?: number
  weight?: number
}

type UpstreamOptions = {
  path?: string
  searchs?: Record<string, string>
}

export class Upstream extends Model<UpstreamDoc> {
  type: string
  host: string
  path?: string
  headers: Record<string, string>
  searchs: Record<string, string>
  auth: Record<string, string>
  interval: number
  weight: number

  url(options: UpstreamOptions = {}): URL {
    const url = new URL(this.host)
    const path = options.path ?? this.path
    if (!isNullish(path)) {
      if (!url.pathname.endsWith('/')) url.pathname += '/'
      url.pathname += path
    }
    for (const [k, v] of new URLSearchParams({
      ...this.searchs,
      ...options.searchs,
    })) {
      url.searchParams.append(k, v)
    }
    return url
  }

  link(options: UpstreamOptions = {}): string {
    return this.url(options).toString()
  }

  constructor(doc: UpstreamDoc) {
    super(doc)

    this.type = doc.type
    this.host = doc.host
    this.path = doc.path
    this.headers = doc.headers ?? {}
    this.searchs = doc.searchs ?? {}
    this.auth = doc.auth ?? {}
    this.interval = doc.interval ?? 0.001
    this.weight = doc.weight ?? 0
  }
}

export type UpstreamId = Upstream['id']

export const UPSTREAM_SCHEMA = {
  name: UPSTREAM_NAME,
  validator: {
    $jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['_id', 'type', 'host', 'created_at'],
      properties: {
        ...UUID_DOC_SCHEMA,
        type: { type: 'string' },
        host: { type: 'string' },
        path: { type: 'string' },
        headers: { type: 'object' },
        searchs: { type: 'object' },
        auth: { type: 'object' },
        interval: { type: 'number' },
        weight: { type: 'number' },
      },
    },
  },
  indexes: {
    create_index: { keys: { created_at: 1 } },
    type_index: {
      keys: { type: 1, weight: 1 },
    },
  },
}

export type UpstreamQuery = {
  id?: UpstreamOrId
  type?: string
  gteWeight?: number
  gtWeight?: number
}
export type UpstreamInsert = {
  id?: UpstreamId
  type: string
  path?: string
  host: string
  headers?: Record<string, string>
  searchs?: Record<string, string>
  auth?: Record<string, string>
  interval?: number
  weight?: number
}
export type UpstreamUpdate = {
  type?: string
  host?: string
  path?: string
  headers?: Record<string, string>
  searchs?: Record<string, string>
  auth?: Record<string, string>
  interval?: number
  weight?: number
}

export type UpstreamSort = {
  createdAt: 'asc' | 'desc'
}

export class Upstreams extends Models<
  UpstreamDoc,
  Upstream,
  UpstreamQuery,
  UpstreamInsert,
  UpstreamUpdate,
  UpstreamSort
> {
  get name(): string {
    return UPSTREAM_NAME
  }

  $model(doc: UpstreamDoc): Upstream {
    return new Upstream(doc)
  }

  $sort(sort?: UpstreamSort) {
    return isNullish(sort) ? Nil : { ...option('created_at', sort.createdAt) }
  }

  $query(query: UpstreamQuery): Filter<UpstreamDoc> {
    const { gtWeight, gteWeight } = query
    return {
      _id: pickIdOrNil(query.id),
      type: pickIdOrNil(query.type),
      weight:
        isNullish(gtWeight) && isNullish(gteWeight)
          ? Nil
          : {
              $gt: gtWeight,
              $gte: gteWeight,
            },
    }
  }

  $insert(values: UpstreamInsert): InsertionOf<UpstreamDoc> {
    const { type, host, path, headers, searchs, auth, interval, weight } =
      values
    assertInterval(interval)
    assertWeight(weight)
    const _id = values.id ?? toUuid()
    return { _id, type, host, path, headers, searchs, auth, interval, weight }
  }

  $set(values: UpstreamUpdate): UpdateFilter<UpstreamDoc> {
    const { type, host, path, headers, searchs, auth, interval, weight } =
      values
    assertInterval(interval)
    assertWeight(weight)
    return { type, host, path, headers, searchs, auth, interval, weight }
  }

  $unset(values: UpstreamUpdate): UpdateFilter<UpstreamDoc> {
    return {
      path: toUnsetOrNil(values, 'path'),
      headers: toUnsetOrNil(values, 'headers'),
      searchs: toUnsetOrNil(values, 'searchs'),
      auth: toUnsetOrNil(values, 'auth'),
      interval: toUnsetOrNil(values, 'interval'),
      weight: toUnsetOrNil(values, 'weight'),
    }
  }
}

function assertInterval(x?: number) {
  if (!isNullish(x)) assert(x >= 0.001)
}

function assertWeight(x?: number) {
  if (!isNullish(x)) assert(x >= 0)
}

type Hint = {
  type: 'same' | 'diff'
  upstream: UpstreamOrId
}

type PoolOptions = {
  ttl: number
  minFailures: number
  minWeight: number
  decay: number
}

/*
 * @deprecated Use UpstreamPool instead
 */
export class Pool {
  #upstreams: Upstreams
  #type: string
  #options: PoolOptions

  #caches: Upstream[] = []
  #failures: Map<string, number> = new Map()
  #times: Map<string, number> = new Map()
  #weights: Map<string, number> = new Map()
  #expiresAt: number = 0

  constructor(
    upstreams: Upstreams,
    type: string,
    options: Partial<PoolOptions> = {},
  ) {
    this.#upstreams = upstreams
    this.#type = type
    this.#options = {
      ttl: options.ttl ?? 60,
      minFailures: options.minFailures ?? 0,
      minWeight: options.minWeight ?? 0.01,
      decay: options.decay ?? 0.8,
    }
    assert(
      this.#options.ttl >= 1 &&
        this.#options.minFailures >= 0 &&
        this.#options.minWeight >= 0 &&
        this.#options.decay > 0 &&
        this.#options.decay < 1,
    )
  }

  async sample(hint?: Hint): Promise<Upstream> {
    await this.#sync()

    // collect the candidates
    const candidates = (() => {
      const id = pickIdOrNil(hint?.upstream)
      const filtered = this.#caches.filter((x) => {
        if (isNullish(hint)) return true
        const eq = id?.equals(x.id)
        return (hint?.type === 'diff' && !eq) || (hint?.type === 'same' && eq)
      })
      return isNullish(hint) || filtered.length > 0 ? filtered : this.#caches
    })()
    if (candidates.length === 0) throw new NoUpstreamError()

    // weighted sample a upstream
    const upstream = (() => {
      const sum = candidates.reduce(
        (s, x) => s + this.#weight(this.#key(x), x.weight),
        0,
      )
      let rand = Math.random() * sum
      for (const x of candidates)
        if ((rand -= this.#weight(this.#key(x), x.weight)) <= 0) return x
      throw new NoUpstreamError() // should not reach here!
    })()

    // wait a while if necessary
    const key = this.#key(upstream)
    const duration = this.#time(key) + upstream.interval * 1000 - Date.now()
    if (duration > 0) await msleep(duration)
    this.#times.set(key, Date.now())
    DEBUG(`sample: ${candidates.length} ${key}`)
    return upstream
  }

  succeed(id: UpstreamOrId) {
    const upstream =
      id instanceof Upstream ? id : this.#caches.find((x) => x.id.equals(id))
    assert(!isNullish(upstream))
    const key = this.#key(upstream)
    DEBUG(`succeed:${key}`)
    this.#failures.set(key, 0)
    this.#weights.set(key, upstream.weight)
  }

  fail(id: UpstreamOrId) {
    const upstream =
      id instanceof Upstream ? id : this.#caches.find((x) => x.id.equals(id))
    assert(!isNullish(upstream))
    const key = this.#key(upstream)
    const failure = this.#failure(key) + 1
    this.#failures.set(key, failure)
    if (failure >= this.#options.minFailures) {
      const weight = this.#weight(key, upstream.weight) * this.#options.decay
      DEBUG(`fail:${key}: ${failure} ${weight}`)
      this.#weights.set(key, weight)
    } else {
      DEBUG(`fail:${key}: ${failure} ${this.#weight(key, upstream.weight)}`)
    }
  }

  async #sync() {
    const now = Date.now()
    if (this.#expiresAt > now) {
      DEBUG(`sync: ignored`)
      return
    }

    const upstreams = await this.#upstreams.findMany({
      type: this.#type,
      gtWeight: 0,
    })
    const keys = new Set<string>()
    upstreams.forEach((x) => {
      keys.add(this.#key(x))
    })

    // remove upstreams
    for (const x of this.#caches) {
      const key = this.#key(x)
      if (!keys.has(key)) {
        this.#times.delete(key)
        this.#failures.delete(key)
      }
    }
    this.#caches.splice(0, this.#caches.length, ...upstreams)
    this.#expiresAt = now + this.#options.ttl * 1000
    DEBUG(`sync: ${this.#caches.length} ${this.#expiresAt}`)
    DEBUG_VERBOSE(
      JSON.stringify(
        this.#caches.map((x) => {
          const key = this.#key(x)
          return {
            key,
            failure: this.#failure(key),
            time: this.#time(key),
            weight: this.#weight(key, x.weight),
          }
        }),
      ),
    )
  }

  #key(upstream: UpstreamOrId): string {
    return String(pickId(upstream))
  }

  #failure(key: string): number {
    return this.#failures.get(key) ?? 0
  }

  #time(key: string): number {
    return this.#times.get(key) ?? 0
  }

  #weight(key: string, weight: number): number {
    return this.#weights.get(key) ?? weight
  }
}
