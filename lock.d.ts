import { Filter, InsertionOf, Model, ModelOrId, Models, Options, StringDoc, UpdateFilter } from './model.js';
import { TypeOrNil } from './type.js';
export declare const LOCK_NAME = "locks";
export type LockOrId = ModelOrId<Lock>;
export type LockOrNil = TypeOrNil<Lock>;
export type LockDoc = StringDoc & {
    expires_at: Date;
};
export declare class Lock extends Model<LockDoc> {
    expiresAt: Date;
    constructor(doc: LockDoc);
}
export type LockId = Lock['id'];
export declare const LOCK_SCHEMA: {
    name: string;
    validator: {
        $jsonSchema: {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                expires_at: {
                    bsonType: string;
                };
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
        };
    };
    indexes: {
        lock_index: {
            keys: {
                _id: number;
                expires_at: number;
            };
        };
        expiration_index: {
            keys: {
                expires_at: number;
            };
            options: {
                expireAfterSeconds: number;
            };
        };
    };
};
export type LockQuery = {
    id?: LockOrId;
    expiresAt?: Date;
};
export type LockInsert = {
    id: string;
    expiresAt: Date;
};
export type LockUpdate = {
    expiresAt: Date;
};
export type LockSort = {
    createdAt?: 'asc' | 'desc';
    expiresAt?: 'asc' | 'desc';
};
export declare class Locks extends Models<LockDoc, Lock, LockQuery, LockInsert, LockUpdate, LockSort> {
    get name(): string;
    $model(doc: LockDoc): Lock;
    $query(query: LockQuery): Filter<LockDoc>;
    $insert(values: LockInsert): InsertionOf<LockDoc>;
    $set(values: LockUpdate): UpdateFilter<LockDoc>;
    $sort(sort?: LockSort): {
        [x: string]: NonNullable<"asc" | "desc">;
    } | undefined;
    trylock(values: LockInsert, options?: Options): Promise<LockOrNil>;
    relock(lock: Lock, values: LockUpdate, options?: Options): Promise<Lock>;
    lock<T>(key: string, exec: (signal: AbortSignal) => Promise<T>, options?: {
        ttl?: number;
        retries?: number;
        onError?: (err: Error) => void;
    }): Promise<T>;
}
