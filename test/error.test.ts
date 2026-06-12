import { strict as assert } from 'node:assert'
import { describe, test } from 'node:test'
import {
  LockError,
  LockingError,
  RelockError,
  UnlockError,
} from '../src/error/lock.js'
import { NoUpstreamError, UpstreamError } from '../src/error/upstream.js'

describe('lock errors', () => {
  test('default and custom messages, and the class hierarchy', () => {
    assert.equal(new LockingError().message, 'Unknown Lock Error')
    assert.equal(new LockingError('custom').message, 'custom')

    const cases: { Cls: new (m?: string) => LockingError; dflt: string }[] = [
      { Cls: LockError, dflt: 'Lock Error' },
      { Cls: RelockError, dflt: 'Relock Error' },
      { Cls: UnlockError, dflt: 'Unlock Error' },
    ]
    for (const { Cls, dflt } of cases) {
      assert.equal(new Cls().message, dflt) // default message
      assert.equal(new Cls('custom').message, 'custom') // custom message
      assert.ok(new Cls() instanceof LockingError)
      assert.ok(new Cls() instanceof Error)
    }
  })
})

describe('upstream errors', () => {
  test('default and custom messages, and the class hierarchy', () => {
    assert.equal(new UpstreamError().message, 'Unknown Upstream Error')
    assert.equal(new UpstreamError('custom').message, 'custom')

    assert.equal(new NoUpstreamError().message, 'No Upstream')
    assert.equal(new NoUpstreamError('custom').message, 'custom')
    assert.ok(new NoUpstreamError() instanceof UpstreamError)
    assert.ok(new NoUpstreamError() instanceof Error)
  })
})
