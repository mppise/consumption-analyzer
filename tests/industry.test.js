// @story STORY-006 | industry-vertical-inference
// @intent unit tests for inferIndustry() — verifies all 8 rule branches, the 4 spec-mandated name assertions, fallback behaviour, and null-safety

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferIndustry } from '../src/lib/industry.js'

// ── Criterion 3: spec-mandated name assertions ────────────────────────────────

test('AbbVie → Pharma/Life Sciences (spec criterion 3)', () => {
  assert.equal(inferIndustry('AbbVie', []), 'Pharma/Life Sciences')
})

test('Cardinal → Healthcare/MedTech (spec criterion 3)', () => {
  assert.equal(inferIndustry('Cardinal', []), 'Healthcare/MedTech')
})

test('Medtronic → Healthcare/MedTech (spec criterion 3)', () => {
  assert.equal(inferIndustry('Medtronic', []), 'Healthcare/MedTech')
})

test('Abbott → Healthcare/MedTech (spec criterion 3)', () => {
  assert.equal(inferIndustry('Abbott', []), 'Healthcare/MedTech')
})

// ── Rule 1: product fingerprint — pharma-specific products ────────────────────

test('Rule 1a: product "Traceability Hub" → Pharma/Life Sciences', () => {
  assert.equal(inferIndustry('GenericCorp', ['SAP Traceability Hub for Life Sciences']), 'Pharma/Life Sciences')
})

test('Rule 1b: product "Batch Release Hub" → Pharma/Life Sciences', () => {
  assert.equal(inferIndustry('GenericCorp', ['SAP Batch Release Hub']), 'Pharma/Life Sciences')
})

test('Rule 1 beats Rule 4: Traceability Hub + Commerce Cloud → Pharma/Life Sciences', () => {
  assert.equal(
    inferIndustry('GenericCorp', ['SAP Traceability Hub', 'SAP Commerce Cloud']),
    'Pharma/Life Sciences',
  )
})

// ── Rule 2: customer name — pharma company names ──────────────────────────────

test('Rule 2: Pfizer → Pharma/Life Sciences', () => {
  assert.equal(inferIndustry('Pfizer Inc', []), 'Pharma/Life Sciences')
})

test('Rule 2: Novartis → Pharma/Life Sciences', () => {
  assert.equal(inferIndustry('Novartis AG', []), 'Pharma/Life Sciences')
})

test('Rule 2: Roche → Pharma/Life Sciences', () => {
  assert.equal(inferIndustry('F. Hoffmann-La Roche Ltd', []), 'Pharma/Life Sciences')
})

test('Rule 2: Merck → Pharma/Life Sciences', () => {
  assert.equal(inferIndustry('Merck KGaA', []), 'Pharma/Life Sciences')
})

test('Rule 2: GSK → Pharma/Life Sciences', () => {
  assert.equal(inferIndustry('GSK plc', []), 'Pharma/Life Sciences')
})

// ── Rule 3: customer name — health/medtech company names ─────────────────────

test('Rule 3: Cardinal Health → Healthcare/MedTech', () => {
  assert.equal(inferIndustry('Cardinal Health Inc', []), 'Healthcare/MedTech')
})

test('Rule 3: Stryker → Healthcare/MedTech', () => {
  assert.equal(inferIndustry('Stryker Corporation', []), 'Healthcare/MedTech')
})

test('Rule 3: Boston Scientific → Healthcare/MedTech', () => {
  assert.equal(inferIndustry('Boston Scientific Corp', []), 'Healthcare/MedTech')
})

// ── Rule 4: Commerce Cloud (no higher rule matched) → Retail/Commerce ─────────

test('Rule 4: Commerce Cloud → Retail/Commerce', () => {
  assert.equal(inferIndustry('RetailCo', ['SAP Commerce Cloud']), 'Retail/Commerce')
})

test('Rule 3 beats Rule 4: Abbott + Commerce Cloud → Healthcare/MedTech', () => {
  assert.equal(inferIndustry('Abbott', ['SAP Commerce Cloud']), 'Healthcare/MedTech')
})

// ── Rule 5: Watchlist Screening + Ariba → Financial Services ─────────────────

test('Rule 5: Watchlist Screening + Ariba → Financial Services', () => {
  assert.equal(
    inferIndustry('BigBank', ['Watchlist Screening', 'Ariba Buying and Invoicing']),
    'Financial Services',
  )
})

// ── Rule 6: Watchlist Screening without Ariba → Manufacturing ────────────────

test('Rule 6: Watchlist Screening alone → Manufacturing', () => {
  assert.equal(inferIndustry('MfgCo', ['Watchlist Screening']), 'Manufacturing')
})

test('Rule 6: Watchlist Screening + Concur (no Ariba) → Manufacturing', () => {
  assert.equal(inferIndustry('MfgCo', ['Watchlist Screening', 'Concur Travel']), 'Manufacturing')
})

// ── Rule 7: Ariba + Concur (no higher-priority rule) → Manufacturing ──────────

test('Rule 7: Ariba + Concur → Manufacturing', () => {
  assert.equal(
    inferIndustry('ManufacturingInc', ['Ariba Contracts', 'Concur Expense']),
    'Manufacturing',
  )
})

test('Rule 7: Ariba alone (no Concur) → Unknown', () => {
  assert.equal(inferIndustry('SomeCo', ['Ariba Sourcing']), 'Unknown')
})

// ── Rule 8: fallback → Unknown ────────────────────────────────────────────────

test('Rule 8: no rule matches → Unknown', () => {
  assert.equal(inferIndustry('TechCorp', ['SAP Analytics Cloud BI']), 'Unknown')
})

test('Rule 8: empty product list + unknown name → Unknown', () => {
  assert.equal(inferIndustry('SomeUnknownEntity', []), 'Unknown')
})

// ── Criterion 5: never null, never throws ─────────────────────────────────────

test('null customerName does not throw, returns Unknown', () => {
  assert.doesNotThrow(() => inferIndustry(null, []))
  assert.equal(inferIndustry(null, []), 'Unknown')
})

test('null productNames does not throw, returns Unknown', () => {
  assert.doesNotThrow(() => inferIndustry('UnknownCo', null))
  assert.equal(inferIndustry('UnknownCo', null), 'Unknown')
})

test('both null does not throw, returns Unknown', () => {
  assert.doesNotThrow(() => inferIndustry(null, null))
  assert.equal(inferIndustry(null, null), 'Unknown')
})

test('empty strings do not throw, returns Unknown', () => {
  assert.doesNotThrow(() => inferIndustry('', []))
  assert.equal(inferIndustry('', []), 'Unknown')
})

// ── Criterion 2: return value is always one of the 8 enumerated verticals ─────

test('return value is always one of the 8 enumerated verticals', () => {
  const VALID_VERTICALS = new Set([
    'Pharma/Life Sciences',
    'Healthcare/MedTech',
    'Manufacturing',
    'Financial Services',
    'Retail/Commerce',
    'Technology',
    'Public Sector',
    'Unknown',
  ])

  const testPairs = [
    ['AbbVie', ['SAP Traceability Hub']],
    ['Cardinal', []],
    ['Medtronic', []],
    ['BigBank', ['Watchlist Screening', 'Ariba']],
    ['RetailCo', ['Commerce Cloud']],
    ['MfgCo', ['Ariba', 'Concur']],
    ['MfgCo2', ['Watchlist Screening']],
    ['Unknown Entity', ['SAP BTP']],
    [null, null],
    ['', []],
  ]

  for (const [name, products] of testPairs) {
    const result = inferIndustry(name, products)
    assert.ok(
      VALID_VERTICALS.has(result),
      `inferIndustry("${name}") returned "${result}" which is not in the 8 enumerated verticals`,
    )
  }
})
