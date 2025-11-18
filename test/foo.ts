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
  toUnsetOrNil,
  toRangeOrNil,
} from '../src/model.js'
import { toUuid } from '../src/type.js'
import { option } from '../src/util.js'

export const FOO_NAME = 'foos'

type FooDoc = UuidDoc & {
  foo: string
  bar?: number
}

export class Foo extends Model<FooDoc> {
  foo: string
  bar?: number

  constructor(doc: FooDoc) {
    super(doc)

    this.foo = doc.foo
    this.bar = doc.bar
  }
}

export type FooId = Foo['id']
export type FooOrId = ModelOrId<Foo>

export const FOO_SCHEMA = {
  name: FOO_NAME,
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
  indexes: {
    create_index: { keys: { created_at: 1 } },
    foo_unique: { keys: { foo: 1 }, options: { unique: true } },
  },
}

export type FooQuery = {
  id?: FooOrId
  foo?: string
  bar?: number
  createdIn?: {
    begin?: Date
    end?: Date
  }
}
export type FooInsert = {
  id?: FooId
  foo: string
  bar?: number
}
export type FooUpdate = {
  foo?: string
  bar?: number
}
export type FooSort = {
  createdAt?: 'asc' | 'desc'
}

export class Foos extends Models<
  FooDoc,
  Foo,
  FooQuery,
  FooInsert,
  FooUpdate,
  FooSort
> {
  get name(): string {
    return FOO_NAME
  }

  $model(doc: FooDoc): Foo {
    return new Foo(doc)
  }

  $query(query: FooQuery): Filter<FooDoc> {
    return {
      _id: pickIdOrNil(query.id),
      foo: query.foo,
      bar: query.bar,
      created_at: toRangeOrNil(query.createdIn),
    }
  }

  $insert(values: FooInsert): InsertionOf<FooDoc> {
    const _id = values.id ?? toUuid()
    return { _id, foo: values.foo, bar: values.bar }
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
