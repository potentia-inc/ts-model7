import assert from 'node:assert';
import { debug } from 'node:util';
import { NoUpstreamError } from './error/upstream.js';
import { pickId, pickIdOrNil } from './model.js';
import { isNullish } from './type.js';
import { Upstream } from './upstream.js';
import { msleep } from './util.js';
const DEBUG = debug('potentia:model:upstream');
const DEBUG_VERBOSE = debug('potentia:model:upstream:verbose');
export class UpstreamPool {
    #options;
    #pools = new Map();
    constructor(options) {
        this.#options = options;
    }
    async sample(type, hint) {
        const pool = await this.#pool(type);
        return pool.sample(hint);
    }
    succeed(upstream) {
        this.#pools.get(upstream.type)?.succeed(upstream);
    }
    fail(upstream) {
        this.#pools.get(upstream.type)?.fail(upstream);
    }
    async #pool(type) {
        const pool = this.#pools.get(type);
        if (!isNullish(pool))
            return pool;
        const created = new Pool({
            load: () => this.#options.load(type),
            ...this.#options.init?.(type),
        });
        this.#pools.set(type, created);
        return created;
    }
}
class Pool {
    #options;
    #load;
    #caches = [];
    #failures = new Map();
    #times = new Map();
    #weights = new Map();
    #expiresAt = 0;
    constructor(options) {
        this.#load = options.load;
        this.#options = {
            ttl: options.ttl ?? 60,
            minFailures: options.minFailures ?? 0,
            minWeight: options.minWeight ?? 0.01,
            decay: options.decay ?? 0.8,
        };
        assert(this.#options.ttl >= 1 &&
            this.#options.minFailures >= 0 &&
            this.#options.minWeight >= 0 &&
            this.#options.decay > 0 &&
            this.#options.decay < 1);
    }
    async sample(hint) {
        await this.#sync();
        // collect the candidates
        const candidates = (() => {
            const id = pickIdOrNil(hint?.upstream);
            const filtered = this.#caches.filter((x) => {
                if (isNullish(hint))
                    return true;
                const eq = id?.equals(x.id);
                return (hint?.type === 'diff' && !eq) || (hint?.type === 'same' && eq);
            });
            return isNullish(hint) || filtered.length > 0 ? filtered : this.#caches;
        })();
        if (candidates.length === 0)
            throw new NoUpstreamError();
        // weighted sample a upstream
        const upstream = (() => {
            const sum = candidates.reduce((s, x) => s + this.#weight(this.#key(x), x.weight), 0);
            let rand = Math.random() * sum;
            for (const x of candidates)
                if ((rand -= this.#weight(this.#key(x), x.weight)) <= 0)
                    return x;
            throw new NoUpstreamError(); // should not reach here!
        })();
        // wait a while if necessary
        const key = this.#key(upstream);
        const duration = this.#time(key) + upstream.interval * 1000 - Date.now();
        if (duration > 0)
            await msleep(duration);
        this.#times.set(key, Date.now());
        DEBUG(`sample: ${candidates.length} ${key}`);
        return upstream;
    }
    succeed(id) {
        const upstream = id instanceof Upstream ? id : this.#caches.find((x) => x.id.equals(id));
        assert(!isNullish(upstream));
        const key = this.#key(upstream);
        DEBUG(`succeed:${key}`);
        this.#failures.set(key, 0);
        this.#weights.set(key, upstream.weight);
    }
    fail(id) {
        const upstream = id instanceof Upstream ? id : this.#caches.find((x) => x.id.equals(id));
        assert(!isNullish(upstream));
        const key = this.#key(upstream);
        const failure = this.#failure(key) + 1;
        this.#failures.set(key, failure);
        if (failure >= this.#options.minFailures) {
            const weight = this.#weight(key, upstream.weight) * this.#options.decay;
            DEBUG(`fail:${key}: ${failure} ${weight}`);
            this.#weights.set(key, weight);
        }
        else {
            DEBUG(`fail:${key}: ${failure} ${this.#weight(key, upstream.weight)}`);
        }
    }
    async #sync() {
        const now = Date.now();
        if (this.#expiresAt > now) {
            DEBUG(`sync: ignored`);
            return;
        }
        const upstreams = await this.#load();
        const keys = new Set();
        for await (const x of upstreams)
            keys.add(this.#key(x));
        // remove upstreams
        for (const x of this.#caches) {
            const key = this.#key(x);
            if (!keys.has(key)) {
                this.#times.delete(key);
                this.#failures.delete(key);
            }
        }
        this.#caches.splice(0, this.#caches.length, ...upstreams);
        this.#expiresAt = now + this.#options.ttl * 1000;
        DEBUG(`sync: ${this.#caches.length} ${this.#expiresAt}`);
        DEBUG_VERBOSE(JSON.stringify(this.#caches.map((x) => {
            const key = this.#key(x);
            return {
                key,
                failure: this.#failure(key),
                time: this.#time(key),
                weight: this.#weight(key, x.weight),
            };
        })));
    }
    #key(upstream) {
        return String(pickId(upstream));
    }
    #failure(key) {
        return this.#failures.get(key) ?? 0;
    }
    #time(key) {
        return this.#times.get(key) ?? 0;
    }
    #weight(key, weight) {
        return this.#weights.get(key) ?? weight;
    }
}
//# sourceMappingURL=upstream-pool.js.map