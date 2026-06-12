import { strict as assert } from 'node:assert'
import { Uuid } from '../src/type.js'

// A predicate used as an expected field value in `match`.
export type Predicate = (value: unknown) => boolean

// Partial structural assertion, like jest's `toMatchObject`: every key present
// in `expected` must match in `actual`, while extra keys in `actual` are
// ignored. A function-valued field is treated as a predicate; arrays match by
// length and element-wise; nested plain objects recurse (also partially);
// everything else is compared with deepStrictEqual.
export function match(
  actual: unknown,
  expected: unknown,
  path = '<root>',
): void {
  if (typeof expected === 'function') {
    assert.ok(
      (expected as Predicate)(actual),
      `predicate failed at ${path}: ${show(actual)}`,
    )
  } else if (Array.isArray(expected)) {
    assert.ok(
      Array.isArray(actual),
      `expected an array at ${path}: ${show(actual)}`,
    )
    assert.equal(
      (actual as unknown[]).length,
      expected.length,
      `array length at ${path}`,
    )
    expected.forEach((e, i) =>
      match((actual as unknown[])[i], e, `${path}[${i}]`),
    )
  } else if (isPlainObject(expected)) {
    // Recurse into plain objects only (partial match); class instances such as
    // Date/Uuid/Buffer compare by value below via deepStrictEqual.
    assert.ok(
      actual !== null && typeof actual === 'object',
      `expected an object at ${path}: ${show(actual)}`,
    )
    for (const key of Object.keys(expected as Record<string, unknown>)) {
      match(
        (actual as Record<string, unknown>)[key],
        (expected as Record<string, unknown>)[key],
        `${path}.${key}`,
      )
    }
  } else {
    assert.deepStrictEqual(actual, expected, `mismatch at ${path}`)
  }
}

function isPlainObject(x: unknown): boolean {
  if (x === null || typeof x !== 'object') return false
  const proto = Object.getPrototypeOf(x)
  return proto === Object.prototype || proto === null
}

// Predicates mirroring the jest matchers the suites relied on.

export const string: Predicate = (v) => typeof v === 'string'

export const empty: Predicate = (v) =>
  v !== null && typeof v === 'object' && Object.keys(v as object).length === 0

export const nil: Predicate = (v) => v === undefined

export function uuid(expected?: Uuid): Predicate {
  return (v) =>
    v instanceof Uuid && (expected === undefined || v.equals(expected))
}

export function date(expected?: Date | string | number): Predicate {
  return (v) =>
    v instanceof Date &&
    (expected === undefined || v.getTime() === new Date(expected).getTime())
}

function show(x: unknown): string {
  try {
    return JSON.stringify(x)
  } catch {
    return String(x)
  }
}
