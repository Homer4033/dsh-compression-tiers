import test from 'node:test'
import assert from 'node:assert/strict'
import { queryParam } from '../src/http.js'

test('queryParam reads one parameter and tolerates a bare path', () => {
  assert.equal(queryParam({ url: '/compression-tiers/api/github/binding?session=abc' }, 'session'), 'abc')
  assert.equal(queryParam({ url: '/x?a=1&session=a%20b' }, 'session'), 'a b')
  assert.equal(queryParam({ url: '/x?a=1' }, 'session'), undefined)
  assert.equal(queryParam({ url: '/x' }, 'session'), undefined)
  // An empty value is present-but-empty, which the route treats as missing.
  assert.equal(queryParam({ url: '/x?session=' }, 'session'), '')
  assert.equal(queryParam(null, 'session'), undefined)
})
