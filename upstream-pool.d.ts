import type { RateLimiter } from './upstream-rate-limiter.js';
import type { UpstreamOrId } from './upstream.js';
import { Upstream } from './upstream.js';
import type { Duration } from './util.js';
export type UpstreamPoolInit = {
    ttl: Duration;
    minFailures: number;
    minWeight: number;
    decay: number;
};
export type UpstreamPoolOptions = {
    load: (type: Upstream['type']) => Promise<Upstream[]>;
    init?: (type: Upstream['type']) => Partial<UpstreamPoolInit>;
    rateLimiter?: RateLimiter;
};
type Hint = {
    type: 'same' | 'diff';
    upstream: UpstreamOrId;
};
export declare class UpstreamPool {
    #private;
    constructor(options: UpstreamPoolOptions);
    sample(type: Upstream['type'], hint?: Hint): Promise<Upstream>;
    succeed(upstream: Upstream): void;
    fail(upstream: Upstream): void;
}
export {};
