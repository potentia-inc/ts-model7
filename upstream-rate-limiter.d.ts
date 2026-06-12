import { Duration } from './util.js';
export interface RateLimiter {
    reserve(key: string, interval: Duration): Promise<void>;
    forget?(key: string): void;
}
export declare class LocalRateLimiter implements RateLimiter {
    #private;
    constructor(options?: {
        workers?: number;
    });
    get workers(): number;
    set workers(workers: number);
    reserve(key: string, interval: Duration): Promise<void>;
    forget(key: string): void;
}
