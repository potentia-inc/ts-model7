import { Upstream, UpstreamOrId } from './upstream.js';
export type UpstreamPoolInit = {
    ttl: number;
    minFailures: number;
    minWeight: number;
    decay: number;
};
export type UpstreamPoolOptions = {
    load: (type: Upstream['type']) => Promise<Upstream[]>;
    init?: (type: Upstream['type']) => Partial<UpstreamPoolInit>;
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
