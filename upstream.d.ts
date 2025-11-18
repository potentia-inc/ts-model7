import { Filter, InsertionOf, Model, ModelOrId, Models, UpdateFilter, UuidDoc } from './model.js';
import { TypeOrNil } from './type.js';
export declare const UPSTREAM_NAME = "upstreams";
export type UpstreamOrId = ModelOrId<Upstream>;
export type UpstreamOrNil = TypeOrNil<Upstream>;
export type UpstreamDoc = UuidDoc & {
    type: string;
    host: string;
    path?: string;
    headers?: Record<string, string>;
    searchs?: Record<string, string>;
    auth?: Record<string, string>;
    interval?: number;
    weight?: number;
};
type UpstreamOptions = {
    path?: string;
    searchs?: Record<string, string>;
};
export declare class Upstream extends Model<UpstreamDoc> {
    type: string;
    host: string;
    path?: string;
    headers: Record<string, string>;
    searchs: Record<string, string>;
    auth: Record<string, string>;
    interval: number;
    weight: number;
    url(options?: UpstreamOptions): URL;
    link(options?: UpstreamOptions): string;
    constructor(doc: UpstreamDoc);
}
export type UpstreamId = Upstream['id'];
export declare const UPSTREAM_SCHEMA: {
    name: string;
    validator: {
        $jsonSchema: {
            type: string;
            additionalProperties: boolean;
            required: string[];
            properties: {
                type: {
                    type: string;
                };
                host: {
                    type: string;
                };
                path: {
                    type: string;
                };
                headers: {
                    type: string;
                };
                searchs: {
                    type: string;
                };
                auth: {
                    type: string;
                };
                interval: {
                    type: string;
                };
                weight: {
                    type: string;
                };
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
        };
    };
    indexes: {
        create_index: {
            keys: {
                created_at: number;
            };
        };
        type_index: {
            keys: {
                type: number;
                weight: number;
            };
        };
    };
};
export type UpstreamQuery = {
    id?: UpstreamOrId;
    type?: string;
    gteWeight?: number;
    gtWeight?: number;
};
export type UpstreamInsert = {
    id?: UpstreamId;
    type: string;
    path?: string;
    host: string;
    headers?: Record<string, string>;
    searchs?: Record<string, string>;
    auth?: Record<string, string>;
    interval?: number;
    weight?: number;
};
export type UpstreamUpdate = {
    type?: string;
    host?: string;
    path?: string;
    headers?: Record<string, string>;
    searchs?: Record<string, string>;
    auth?: Record<string, string>;
    interval?: number;
    weight?: number;
};
export type UpstreamSort = {
    createdAt: 'asc' | 'desc';
};
export declare class Upstreams extends Models<UpstreamDoc, Upstream, UpstreamQuery, UpstreamInsert, UpstreamUpdate, UpstreamSort> {
    get name(): string;
    $model(doc: UpstreamDoc): Upstream;
    $sort(sort?: UpstreamSort): {
        [x: string]: NonNullable<"asc" | "desc">;
    } | undefined;
    $query(query: UpstreamQuery): Filter<UpstreamDoc>;
    $insert(values: UpstreamInsert): InsertionOf<UpstreamDoc>;
    $set(values: UpstreamUpdate): UpdateFilter<UpstreamDoc>;
    $unset(values: UpstreamUpdate): UpdateFilter<UpstreamDoc>;
}
type Hint = {
    type: 'same' | 'diff';
    upstream: UpstreamOrId;
};
type PoolOptions = {
    ttl: number;
    minFailures: number;
    minWeight: number;
    decay: number;
};
export declare class Pool {
    #private;
    constructor(upstreams: Upstreams, type: string, options?: Partial<PoolOptions>);
    sample(hint?: Hint): Promise<Upstream>;
    succeed(id: UpstreamOrId): void;
    fail(id: UpstreamOrId): void;
}
export {};
