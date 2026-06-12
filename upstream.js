import assert from 'node:assert';
import { Model, Models, UUID_DOC_SCHEMA, pickIdOrNil, toUnsetOrNil, } from './model.js';
import { Nil, Uuid, isNullish } from './type.js';
import { option, toMs } from './util.js';
export const UPSTREAM_NAME = 'upstreams';
export class Upstream extends Model {
    type;
    host;
    path;
    headers;
    searchs;
    auth;
    interval; // milliseconds (code convention)
    weight;
    url(options = {}) {
        const url = new URL(this.host);
        const path = options.path ?? this.path;
        if (!isNullish(path)) {
            if (!url.pathname.endsWith('/'))
                url.pathname += '/';
            url.pathname += path;
        }
        for (const [k, v] of new URLSearchParams({
            ...this.searchs,
            ...options.searchs,
        })) {
            url.searchParams.append(k, v);
        }
        return url;
    }
    link(options = {}) {
        return this.url(options).toString();
    }
    constructor(doc) {
        super(doc);
        this.type = doc.type;
        this.host = doc.host;
        this.path = doc.path;
        this.headers = doc.headers ?? {};
        this.searchs = doc.searchs ?? {};
        this.auth = doc.auth ?? {};
        this.interval = (doc.interval ?? 0.001) * 1000; // seconds -> ms
        this.weight = doc.weight ?? 0;
    }
}
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
};
export class Upstreams extends Models {
    get name() {
        return UPSTREAM_NAME;
    }
    $model(doc) {
        return new Upstream(doc);
    }
    $sort(sort) {
        return isNullish(sort) ? Nil : { ...option('created_at', sort.createdAt) };
    }
    $query(query) {
        const { gtWeight, gteWeight } = query;
        return {
            _id: pickIdOrNil(query.id),
            type: query.type,
            weight: isNullish(gtWeight) && isNullish(gteWeight)
                ? Nil
                : {
                    $gt: gtWeight,
                    $gte: gteWeight,
                },
        };
    }
    $insert(values) {
        const { type, host, path, headers, searchs, auth, weight } = values;
        assertWeight(weight);
        const _id = values.id ?? new Uuid();
        const interval = toIntervalSeconds(values.interval);
        return { _id, type, host, path, headers, searchs, auth, interval, weight };
    }
    $set(values) {
        const { type, host, path, headers, searchs, auth, weight } = values;
        assertWeight(weight);
        const interval = toIntervalSeconds(values.interval);
        return { type, host, path, headers, searchs, auth, interval, weight };
    }
    $unset(values) {
        return {
            path: toUnsetOrNil(values, 'path'),
            headers: toUnsetOrNil(values, 'headers'),
            searchs: toUnsetOrNil(values, 'searchs'),
            auth: toUnsetOrNil(values, 'auth'),
            interval: toUnsetOrNil(values, 'interval'),
            weight: toUnsetOrNil(values, 'weight'),
        };
    }
}
// Accept a Duration (code convention: a number is ms) and normalise to the
// seconds the DB stores (language-neutral). Nil passes through untouched.
function toIntervalSeconds(x) {
    if (isNullish(x))
        return Nil;
    const ms = toMs(x);
    assert(ms >= 1); // at least 1ms
    return ms / 1000;
}
function assertWeight(x) {
    if (!isNullish(x))
        assert(x >= 0);
}
