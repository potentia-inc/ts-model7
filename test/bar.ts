import {
  Filter,
  InsertionOf,
  Model,
  ModelOrId,
  Models,
  Timestamp,
  TIMESTAMP_SCHEMA,
  UpdateFilter,
  pickIdOrNil,
  toUnsetOrNil,
  toRangeOrNil,
} from '../src/model.js'
import { Uuid } from '../src/type.js'
import { option } from '../src/util.js'

export const BAR_NAME = 'bars'

export type BarDoc = Timestamp & {
  _id: {
    foo: Uuid
    bar: string
  }
  foo: string
  bar?: number
}

export class Bar extends Model<BarDoc> {
  foo: string
  bar?: number

  constructor(doc: BarDoc) {
    super(doc)

    this.foo = doc.foo
    this.bar = doc.bar
  }
}

export type BarId = Bar['id']
export type BarOrId = ModelOrId<Bar>

export const BAR_SCHEMA = {
  name: BAR_NAME,
  validator: {
    $jsonSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['_id', 'foo', 'created_at'],
      properties: {
        _id: {
          type: 'object',
          additionalProperties: false,
          required: ['foo', 'bar'],
          properties: {
            foo: { bsonType: 'binData' },
            bar: { type: 'string' },
          },
        },
        foo: { type: 'string' },
        bar: { type: 'number' },
        ...TIMESTAMP_SCHEMA,
      },
    },
  },
  indexes: {
    create_index: { keys: { created_at: 1 } },
    foo_unique: { keys: { foo: 1 }, options: { unique: true } },
  },
}

export type BarQuery = {
  id?: BarOrId
  foo?: string
  bar?: number
  createdIn?: {
    begin?: Date
    end?: Date
  }
}
export type BarInsert = {
  id: BarId
  foo: string
  bar?: number
}
export type BarUpdate = {
  foo?: string
  bar?: number
}
export type BarSort = {
  createdAt?: 'asc' | 'desc'
}

export class Bars extends Models<
  BarDoc,
  Bar,
  BarQuery,
  BarInsert,
  BarUpdate,
  BarSort
> {
  get name(): string {
    return BAR_NAME
  }

  $model(doc: BarDoc): Bar {
    return new Bar(doc)
  }

  $query(query: BarQuery): Filter<BarDoc> {
    return {
      _id: pickIdOrNil(query.id),
      foo: query.foo,
      bar: query.bar,
      created_at: toRangeOrNil(query.createdIn, true),
    }
  }

  $insert(values: BarInsert): InsertionOf<BarDoc> {
    return { _id: values.id, foo: values.foo, bar: values.bar }
  }

  $set(values: BarUpdate): UpdateFilter<BarDoc> {
    return { foo: values.foo, bar: values.bar }
  }

  $unset(values: BarUpdate): UpdateFilter<BarDoc> {
    return { bar: toUnsetOrNil(values, 'bar') }
  }

  $sort(sort: BarSort) {
    return { ...option('created_at', sort.createdAt) }
  }
}
