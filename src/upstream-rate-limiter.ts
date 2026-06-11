import assert from 'node:assert'
import { msleep } from './util.js'

export interface RateLimiter {
  // Block until a request for `key` may proceed, enforcing at least intervalMs
  // of spacing between consecutive requests for that key. The slot is reserved
  // synchronously (before awaiting), so concurrent calls queue correctly.
  reserve(key: string, intervalMs: number): Promise<void>
  // Optional: drop any state held for `key` (e.g. an upstream that's gone).
  forget?(key: string): void
}

// In-process rate limiter: spaces requests for each key at `intervalMs`.
//
// For a fixed multi-worker fleet, set `workers` to the number of pool instances
// that share each upstream's budget. Every worker then spaces locally at
// `intervalMs * workers`, so the aggregate across the fleet stays within the
// global limit -- with no shared state (no DB round-trip).
//
// This is a ceiling, not a scheduler: under-counting `workers` breaks the global
// limit, while over-counting merely under-utilizes it (an idle worker's share is
// wasted). For an autoscaling fleet where the worker count can't be bounded,
// implement RateLimiter against a shared store -- see the MongoDB and Redis
// recipes in the README.
export class LocalRateLimiter implements RateLimiter {
  #workers: number
  #next: Map<string, number> = new Map()

  constructor(options: { workers?: number } = {}) {
    this.#workers = options.workers ?? 1
    assert(Number.isInteger(this.#workers) && this.#workers >= 1)
  }

  async reserve(key: string, intervalMs: number): Promise<void> {
    const spacing = intervalMs * this.#workers
    const now = Date.now()
    const at = Math.max(now, this.#next.get(key) ?? 0)
    this.#next.set(key, at + spacing)
    const wait = at - now
    if (wait > 0) await msleep(wait)
  }

  forget(key: string): void {
    this.#next.delete(key)
  }
}
