import assert from 'node:assert';
import { getMessage } from './error.js';
import { LockError, RelockError, UnlockError } from './error/lock.js';
import { Model, Models, pickIdOrNil, STRING_DOC_SCHEMA, isDuplicationError, } from './model.js';
import { Nil, isNullish } from './type.js';
import { msleep, option } from './util.js';
export const LOCK_NAME = 'locks';
export class Lock extends Model {
    expiresAt;
    constructor(doc) {
        super(doc);
        this.expiresAt = doc.expires_at;
    }
}
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
};
export class Locks extends Models {
    get name() {
        return LOCK_NAME;
    }
    $model(doc) {
        return new Lock(doc);
    }
    $query(query) {
        return { _id: pickIdOrNil(query.id), expires_at: query.expiresAt };
    }
    $insert(values) {
        return { _id: values.id, expires_at: values.expiresAt };
    }
    $set(values) {
        return { expires_at: values.expiresAt };
    }
    $sort(sort) {
        if (isNullish(sort))
            return Nil;
        return {
            ...option('created_at', sort.createdAt),
            ...option('expires_at', sort.expiresAt),
        };
    }
    async trylock(values, options = {}) {
        const $now = options.$now ?? new Date();
        try {
            const locked = await this.collection.findOneAndUpdate({ _id: values.id, expires_at: { $lt: $now } }, {
                $set: { ...this.$set(values), updated_at: $now },
                $setOnInsert: { _id: values.id, created_at: $now },
            }, { returnDocument: 'after', upsert: true, ...options });
            return isNullish(locked) ? Nil : this.$model(locked);
        }
        catch (err) {
            if (isDuplicationError(err))
                return Nil;
            throw err;
        }
    }
    async relock(lock, values, options = {}) {
        const $now = options.$now ?? new Date();
        const relocked = await this.collection.findOneAndUpdate({ _id: lock.id, expires_at: lock.expiresAt }, { $set: { ...this.$set(values), updated_at: $now } }, { returnDocument: 'after', ...options });
        if (isNullish(relocked))
            throw new RelockError();
        return this.$model(relocked);
    }
    async lock(key, exec, options = {}) {
        const ttl = (options.ttl ?? 3) * 1000; // to ms
        const retries = options.retries ?? 0; // no retry by default
        assert(ttl >= 1);
        assert(Number.isInteger(retries) && retries >= 0);
        const timeout = Math.ceil(ttl / 2);
        const until = () => new Date(Date.now() + ttl);
        const state = {
            retries: 0,
            heartbeating: true,
            lock: await this.trylock({ id: key, expiresAt: until() }),
        };
        if (isNullish(state.lock))
            throw new LockError();
        const abortController = new AbortController();
        const heartbeat = (async () => {
            await msleep(timeout);
            while (state.heartbeating && !isNullish(state.lock)) {
                try {
                    state.lock = await this.relock(state.lock, { expiresAt: until() });
                    state.retries = 0;
                }
                catch (err) {
                    if (state.retries === retries) {
                        state.lock = Nil;
                        options.onError?.(new RelockError(getMessage(err)));
                        abortController.abort();
                        break;
                    }
                    ++state.retries;
                }
                await msleep(state.retries > 0 ? Math.min(10, timeout) : timeout);
            }
        })();
        try {
            return await exec(abortController.signal);
        }
        finally {
            state.heartbeating = false;
            await heartbeat;
            if (!isNullish(state.lock)) {
                const lock = state.lock;
                state.lock = Nil;
                await this.deleteOne(lock).catch((err) => {
                    options.onError?.(new UnlockError(getMessage(err)));
                });
            }
        }
    }
}
//# sourceMappingURL=lock.js.map