import { Collection, CommandOperationOptions, Connection, ExplainableCursor, Filter, OptionalUnlessRequiredId, Sort, UpdateFilter, WithId } from './mongo.js';
import { ObjectId, Uuid, Nil, TypeOrNil } from './type.js';
export { Filter, WithId, UpdateFilter, isDuplicationError } from './mongo.js';
export type Timestamp = {
    created_at: Date;
    updated_at?: Date;
};
export declare const TIMESTAMP_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
};
type Doc<Id> = {
    _id: Id;
} & Timestamp;
export type NumberDoc = {
    _id: number;
} & Timestamp;
export declare const NUMBER_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        type: string;
    };
};
export type StringDoc = {
    _id: string;
} & Timestamp;
export declare const STRING_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        type: string;
    };
};
export type UuidDoc = {
    _id: Uuid;
} & Timestamp;
export declare const UUID_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        bsonType: string;
    };
};
export type ObjectIdDoc = {
    _id: ObjectId;
} & Timestamp;
export declare const OBJECTID_DOC_SCHEMA: {
    created_at: {
        bsonType: string;
    };
    updated_at: {
        bsonType: string;
    };
    _id: {
        bsonType: string;
    };
};
export declare class Model<D extends Doc<unknown>> {
    id: D['_id'];
    createdAt: Date;
    updatedAt?: Date;
    constructor(doc: D);
}
type ModelLike<Id> = {
    id: Id;
    createdAt: Date;
    updatedAt?: Date;
};
export type ModelOrId<M extends {
    id: unknown;
    createdAt: Date;
    updatedAt?: Date;
}> = M | M['id'];
export declare function pickId<Id>(x: ModelLike<Id> | Id): Id;
export declare function pickIdOrNil<Id>(x?: ModelLike<Id> | Id | null): Id | Nil;
export type Options = CommandOperationOptions & {
    $now?: Date;
    $max?: number;
};
export declare abstract class Models<D extends Doc<unknown>, M extends Model<D>, Q, I, U, S> {
    readonly connection: Connection;
    constructor(options: {
        connection: Connection;
    });
    get collection(): Collection<D>;
    abstract get name(): string;
    abstract $model(doc: D | WithId<D> | OptionalUnlessRequiredId<D>, options?: Options): M;
    abstract $insert(values: I, options?: Options): Omit<D, 'created_at'>;
    $query(query: Q, options?: Options): Filter<D>;
    $inc(values: U, options?: Options): UpdateFilter<D>;
    $set(values: U, options?: Options): UpdateFilter<D>;
    $unset(values: U, options?: Options): UpdateFilter<D>;
    $sort(sort?: S): TypeOrNil<Sort>;
    $paginate(pagination?: Partial<Pagination<S>>, options?: {
        $max?: number;
    }): {
        sort: TypeOrNil<Sort>;
        offset: number;
        limit: number;
    };
    find(id: ModelOrId<M>, options?: Options): Promise<M>;
    findOne(query?: Q, options?: Options): Promise<TypeOrNil<M>>;
    findMany(query?: Q, pagination?: Partial<Pagination<S>>, options?: Options): Promise<M[]>;
    findManyToMapBy<T>(by: (x: M) => T, query?: Q, pagination?: Partial<Pagination<S>>, options?: Options): Promise<Map<T, M>>;
    iterate(query?: Q, pagination?: Partial<Pagination<S>>, options?: Options): Cursor<D, M>;
    paginate(query?: Q, pagination?: Partial<Pagination<S>>, options?: Options): Promise<[Pagination<S>, M[]]>;
    count(query?: Q, options?: Options): Promise<number>;
    insertOne(values: I, options?: Options): Promise<M>;
    insertMany(values: I[], options?: Options): Promise<M[]>;
    updateOne(id: ModelOrId<M>, values: U, options?: Options): Promise<M>;
    updateMany(query: Q, values: U, options?: Options): Promise<number>;
    deleteOne(id: ModelOrId<M>, options?: Options): Promise<void>;
    deleteMany(query?: Q, options?: Options): Promise<number>;
}
export declare class Cursor<D extends Doc<unknown>, M extends Model<D>> {
    #private;
    constructor(model: (d: D | WithId<D>, options?: Options) => M, cursor: ExplainableCursor<D>);
    [Symbol.asyncIterator](): AsyncGenerator<M, void, unknown>;
    toArray(options?: Options): Promise<M[]>;
}
export type Pagination<S> = {
    sort?: S;
    offset: number;
    limit: number;
    count: number;
};
export declare function getSortKey(sort?: Sort): any;
export type InsertionOf<T> = Omit<T, 'created_at'>;
export declare function toValueOrAbsent<T>(value?: T | null): T | {
    $exists: false;
};
export declare function toValueOrAbsentOrNil<T extends object, K extends keyof T, S = T[K]>(values: T, key: K, map?: (x?: T[K] | null) => S | Nil): S | {
    $exists: false;
} | Nil;
export declare function toExistsOrNil($exists?: boolean | null): {
    $exists: boolean;
} | Nil;
export declare function toUnsetOrNil<T extends object>(values: T, key: keyof T): true | Nil;
export declare function toValueOrInOrNil<S, T = S>(x: Nil | null | S | readonly S[], map?: (x: S) => T): T | {
    $in: T[];
} | Nil;
export declare function toRangeOrNil<B, E>({ begin, end, }?: {
    begin?: B;
    end?: E;
}, inclusiveEnd?: boolean): {
    [x: string]: B | E | undefined;
    $gte: B | undefined;
} | undefined;
