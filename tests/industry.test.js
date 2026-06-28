// @story STORY-006 | industry-vertical-inference
// @intent unit tests for inferIndustry() — verifies AI-backed classification: valid vertical passthrough, fallback on API error, fallback on unrecognised value, and in-memory caching behaviour

import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  inferIndustry,
  _clearCache,
  _setAiClientFactory,
  VALID_VERTICALS,
} from '../src/lib/industry.js'

// Reset cache and restore the default factory before every test to ensure isolation
beforeEach(() => {
  _clearCache()
  // Restore default factory (no-op client — env vars are not set in test env)
  _setAiClientFactory(async () => null)
})

// ── (a) Valid vertical returned when AI returns a recognised value ─────────────

test('(a) returns correct vertical when AI returns a valid value', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => 'Automotive',
  }))

  const result = await inferIndustry('BMW AG')
  assert.equal(result, 'Automotive')
})

test('(a-2) returns "Life sciences and healthcare" when AI returns that string', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => 'Life sciences and healthcare',
  }))

  const result = await inferIndustry('Pfizer Inc')
  assert.equal(result, 'Life sciences and healthcare')
})

test('(a-3) returns "Financial services" when AI returns that string', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => 'Financial services',
  }))

  const result = await inferIndustry('JP Morgan Chase')
  assert.equal(result, 'Financial services')
})

// ── (b) Fallback to "Professional services" on API error ─────────────────────

test('(b) falls back to "Professional services" when AI call throws', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => { throw new Error('upstream timeout') },
  }))

  const result = await inferIndustry('AnyBank Ltd')
  assert.equal(result, 'Professional services')
})

test('(b-2) falls back to "Professional services" when factory itself throws', async () => {
  _setAiClientFactory(async () => { throw new Error('factory error') })

  const result = await inferIndustry('FactoryFailCo')
  assert.equal(result, 'Professional services')
})

// ── (c) Fallback on unrecognised value ────────────────────────────────────────

test('(c) falls back to "Professional services" when AI returns old-schema vertical', async () => {
  // "Pharma/Life Sciences" was a prior-version vertical, not in the 23 SAP verticals
  _setAiClientFactory(async () => ({
    chat: async () => 'Pharma/Life Sciences',
  }))

  const result = await inferIndustry('Pfizer Inc')
  assert.equal(result, 'Professional services')
})

test('(c-2) falls back when AI returns empty string', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => '',
  }))

  const result = await inferIndustry('EmptyCo')
  assert.equal(result, 'Professional services')
})

test('(c-3) falls back when AI returns a hallucinated vertical', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => 'Space exploration',
  }))

  const result = await inferIndustry('SpaceCo')
  assert.equal(result, 'Professional services')
})

test('(c-4) trimming of trailing punctuation allows valid vertical with trailing period', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => 'Retail.',
  }))

  const result = await inferIndustry('RetailCo')
  assert.equal(result, 'Retail')
})

// ── (d) Caching — same customer name only calls AI once ───────────────────────

test('(d) same customer name only triggers one AI call (cache hit on second call)', async () => {
  let callCount = 0
  _setAiClientFactory(async () => ({
    chat: async () => {
      callCount++
      return 'Retail'
    },
  }))

  const r1 = await inferIndustry('RetailCo')
  const r2 = await inferIndustry('RetailCo')
  const r3 = await inferIndustry('RetailCo')

  assert.equal(callCount, 1, `Expected 1 AI call, got ${callCount}`)
  assert.equal(r1, 'Retail')
  assert.equal(r2, 'Retail')
  assert.equal(r3, 'Retail')
})

test('(d-2) different customer names each trigger their own AI call', async () => {
  const callLog = []
  _setAiClientFactory(async () => ({
    chat: async (prompt) => {
      callLog.push(prompt)
      if (prompt.includes('BMW')) return 'Automotive'
      if (prompt.includes('SAP')) return 'High tech'
      return 'Professional services'
    },
  }))

  const r1 = await inferIndustry('BMW AG')
  const r2 = await inferIndustry('SAP SE')

  assert.equal(callLog.length, 2, `Expected 2 AI calls for 2 distinct names, got ${callLog.length}`)
  assert.equal(r1, 'Automotive')
  assert.equal(r2, 'High tech')
})

test('(d-3) _clearCache() resets cache so next call re-invokes AI', async () => {
  let callCount = 0
  _setAiClientFactory(async () => ({
    chat: async () => {
      callCount++
      return 'Mining'
    },
  }))

  await inferIndustry('MiningCo')
  assert.equal(callCount, 1)

  _clearCache()

  await inferIndustry('MiningCo')
  assert.equal(callCount, 2, 'Expected second AI call after cache clear')
})

// ── Null-safety ───────────────────────────────────────────────────────────────

test('null customerName falls back to "Professional services" without throwing', async () => {
  _setAiClientFactory(async () => ({
    chat: async () => 'Professional services',
  }))

  await assert.doesNotReject(() => inferIndustry(null))
  const result = await inferIndustry(null)
  assert.equal(result, 'Professional services')
})

// ── VALID_VERTICALS export ────────────────────────────────────────────────────

test('VALID_VERTICALS contains exactly 23 entries', () => {
  assert.equal(VALID_VERTICALS.size, 23, `Expected 23 verticals, found ${VALID_VERTICALS.size}`)
})

test('VALID_VERTICALS contains "Professional services" (the fallback)', () => {
  assert.ok(VALID_VERTICALS.has('Professional services'))
})

test('VALID_VERTICALS contains all 23 expected canonical strings', () => {
  const expected = [
    'Aerospace and defense',
    'Agribusiness',
    'Automotive',
    'Chemicals',
    'Consumer products',
    'Construction and real estate',
    'Defense and security',
    'Education and research',
    'Financial services',
    'Government',
    'High tech',
    'Industrial manufacturing',
    'Life sciences and healthcare',
    'Media, sports, and entertainment',
    'Mill products',
    'Mining',
    'Oil, gas, and energy',
    'Professional services',
    'Retail',
    'Telecommunications',
    'Travel and transportation',
    'Utilities',
    'Wholesale distribution',
  ]
  for (const v of expected) {
    assert.ok(VALID_VERTICALS.has(v), `Missing vertical: "${v}"`)
  }
})
