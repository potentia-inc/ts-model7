import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'
import { LocalRateLimiter } from '../src/upstream-rate-limiter.js'

describe('LocalRateLimiter', () => {
  test('spaces consecutive requests for a key by the interval', async () => {
    const limiter = new LocalRateLimiter()
    const interval = 50
    const started = Date.now()
    for (let i = 0; i < 4; ++i) await limiter.reserve('a', interval)
    // first is immediate, the next three each wait one interval
    assert.ok(Date.now() - started >= 3 * interval - 10)
  })

  test('keys are independent', async () => {
    const limiter = new LocalRateLimiter()
    const started = Date.now()
    await limiter.reserve('a', 1000)
    await limiter.reserve('b', 1000) // different key: no wait
    assert.ok(Date.now() - started < 100)
  })

  test('workers multiplies the spacing', async () => {
    const limiter = new LocalRateLimiter({ workers: 3 })
    const interval = 30
    const started = Date.now()
    await limiter.reserve('a', interval) // immediate
    await limiter.reserve('a', interval) // waits interval * workers
    assert.ok(Date.now() - started >= 3 * interval - 10)
  })

  test('concurrent reserves queue (slot reserved before awaiting)', async () => {
    const limiter = new LocalRateLimiter()
    const interval = 40
    const started = Date.now()
    await Promise.all([
      limiter.reserve('a', interval),
      limiter.reserve('a', interval),
      limiter.reserve('a', interval),
    ])
    assert.ok(Date.now() - started >= 2 * interval - 10)
  })

  test('workers can be adjusted at runtime', async () => {
    const limiter = new LocalRateLimiter()
    assert.equal(limiter.workers, 1)

    limiter.workers = 4
    assert.equal(limiter.workers, 4)

    const interval = 25
    const started = Date.now()
    await limiter.reserve('a', interval) // immediate
    await limiter.reserve('a', interval) // waits interval * 4
    assert.ok(Date.now() - started >= 4 * interval - 10)

    assert.throws(() => (limiter.workers = 0))
    assert.throws(() => (limiter.workers = 1.5))
  })

  test('forget() clears the spacing state', async () => {
    const limiter = new LocalRateLimiter()
    await limiter.reserve('a', 1000) // pushes the next slot far ahead
    limiter.forget('a')
    const started = Date.now()
    await limiter.reserve('a', 1000) // immediate again
    assert.ok(Date.now() - started < 100)
  })
})
