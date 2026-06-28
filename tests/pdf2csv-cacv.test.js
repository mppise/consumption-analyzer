// @story STORY-002 | pdf2csv cACV domain unit tests
// @intent unit-tests for isCacvHeaderRow, buildMergedHeader, normalizeHeaderToCanonical,
//         and applyCacvTransform — cover both old-format and new-format PDFs without
//         requiring a real PDF file (Criteria 2, 3, 4, 5, 6)

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import {
  isCacvHeaderRow,
  buildMergedHeader,
  normalizeHeaderToCanonical,
  applyCacvTransform,
  HEADER_ALIAS_MAP,
  CANONICAL_COLUMNS,
} from '../src/tools/pdf2csv.js'

// ── HEADER_ALIAS_MAP coverage ─────────────────────────────────────────────────

describe('HEADER_ALIAS_MAP', () => {
  test('maps old-format solution area labels to solution_area', () => {
    assert.equal(HEADER_ALIAS_MAP['solution_area'], 'solution_area')
    assert.equal(HEADER_ALIAS_MAP['solution area'], 'solution_area')
  })

  test('maps new-format consumed-solution labels to solution_area', () => {
    assert.equal(HEADER_ALIAS_MAP['consumed solution 2026'], 'solution_area')
    assert.equal(HEADER_ALIAS_MAP['consumed solution 2025'], 'solution_area')
    assert.equal(HEADER_ALIAS_MAP['consumed solution'], 'solution_area')
  })

  test('maps new-format consumed-subsolution labels to sub_solution_area', () => {
    assert.equal(HEADER_ALIAS_MAP['consumed subsolution 2026'], 'sub_solution_area')
    assert.equal(HEADER_ALIAS_MAP['consumed subsolution 2025'], 'sub_solution_area')
    assert.equal(HEADER_ALIAS_MAP['consumed subsolution'], 'sub_solution_area')
  })

  test('maps sub-solution area label variants to sub_solution_area', () => {
    assert.equal(HEADER_ALIAS_MAP['sub_solution_area'], 'sub_solution_area')
    assert.equal(HEADER_ALIAS_MAP['sub solution area'], 'sub_solution_area')
    assert.equal(HEADER_ALIAS_MAP['subsolution_area'], 'sub_solution_area')
  })

  test('maps pfhier_logical_product_desc to logical_product', () => {
    assert.equal(HEADER_ALIAS_MAP['pfhier_logical_product_desc'], 'logical_product')
  })

  test('maps lpr to logical_product_id', () => {
    assert.equal(HEADER_ALIAS_MAP['lpr'], 'logical_product_id')
  })

  test('maps old-format cacv_target aliases to cacv_target', () => {
    assert.equal(HEADER_ALIAS_MAP['cacv_target'], 'cacv_target')
    assert.equal(HEADER_ALIAS_MAP['cacv_bud'], 'cacv_target')
    assert.equal(HEADER_ALIAS_MAP['cacv bud'], 'cacv_target')
    assert.equal(HEADER_ALIAS_MAP['ytd target'], 'cacv_target')
  })

  test('maps old-format cacv_actual aliases to cacv_actual', () => {
    assert.equal(HEADER_ALIAS_MAP['cacv_actual'], 'cacv_actual')
    assert.equal(HEADER_ALIAS_MAP['cacv act'], 'cacv_actual')
    assert.equal(HEADER_ALIAS_MAP['cacv actuals'], 'cacv_actual')
    assert.equal(HEADER_ALIAS_MAP['ytd actuals'], 'cacv_actual')
    assert.equal(HEADER_ALIAS_MAP['ytd actual'], 'cacv_actual')
  })

  test('CANONICAL_COLUMNS has exactly 7 entries in correct order', () => {
    assert.deepEqual(CANONICAL_COLUMNS, [
      'solution_area',
      'sub_solution_area',
      'logical_product',
      'logical_product_id',
      'month',
      'cacv_target',
      'cacv_actual',
    ])
  })
})

// ── isCacvHeaderRow ────────────────────────────────────────────────────────────

describe('isCacvHeaderRow', () => {
  test('detects old-format row starting with MEASURES', () => {
    assert.ok(isCacvHeaderRow(['MEASURES', 'cACV Target', 'cACV Actuals']))
  })

  test('detects old-format row starting with SOLUTION_AREA', () => {
    assert.ok(isCacvHeaderRow(['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'MONTH']))
  })

  test('detects old-format row starting with EMPLOYEE_ID', () => {
    assert.ok(isCacvHeaderRow(['EMPLOYEE_ID', 'GLOBAL_ULTIMATE_ID', 'MONTH']))
  })

  test('detects new-format row starting with "Leading End Customer"', () => {
    assert.ok(isCacvHeaderRow(['Leading End Customer ID&Name', 'Consumed Solution 2026', 'Month']))
  })

  test('detects new-format measures row (empty first cell, MEASURES somewhere in row)', () => {
    assert.ok(isCacvHeaderRow(['', '', '', '', 'Measures', 'cACV_BUD', 'cACV ACT']))
  })

  test('detects new-format measures row with BOM in first cell', () => {
    // BOM as first cell — strip then check for MEASURES elsewhere
    assert.ok(isCacvHeaderRow(['﻿', '', '', '', 'Measures', 'cACV_BUD']))
  })

  test('does not flag normal data rows as header rows', () => {
    assert.ok(!isCacvHeaderRow(['Company A', 'Finance', 'Product X', '202601', '100', '90']))
  })

  test('does not flag empty/short rows as header rows', () => {
    assert.ok(!isCacvHeaderRow([]))
    assert.ok(!isCacvHeaderRow(null))
    assert.ok(!isCacvHeaderRow(['just one cell']))
  })
})

// ── buildMergedHeader ─────────────────────────────────────────────────────────

describe('buildMergedHeader', () => {
  test('returns single candidate unchanged', () => {
    const candidates = [['solution_area', 'month', 'cacv_target', 'cacv_actual']]
    assert.deepEqual(buildMergedHeader(candidates), candidates[0])
  })

  test('returns null for empty candidates', () => {
    assert.equal(buildMergedHeader([]), null)
    assert.equal(buildMergedHeader(null), null)
  })

  test('old-format: merges dimension row + measures row (MEASURES row first)', () => {
    const measRow = ['measures', 'target', 'actuals']
    const dimRow = ['employee_id', 'global_ultimate_id', 'solution_area', 'sub_solution_area', 'logical_product', 'month']
    const merged = buildMergedHeader([measRow, dimRow])
    // Dimension row is widest (6 cols vs 3); measure labels appended
    assert.ok(merged.includes('employee_id'), 'dimension columns must be present')
    assert.ok(merged.includes('solution_area'), 'solution_area must be present')
    assert.ok(merged.includes('target'), 'measure label must be present')
    assert.ok(merged.includes('actuals'), 'actuals label must be present')
  })

  test('new-format: merges "leading end customer" dimension row with measures row', () => {
    const measRow = ['', '', '', '', 'measures', 'cacv_bud', 'cacv act', 'delta cacv to bud']
    const dimRow = ['leading end customer id&name', 'consumed solution 2026', 'consumed subsolution 2026', 'pfhier_logical_product_desc', 'month', '', '', '']
    const merged = buildMergedHeader([measRow, dimRow])
    // dim row wins for non-empty cells; meas row fills empty dim cells
    assert.equal(merged[0], 'leading end customer id&name')
    assert.equal(merged[1], 'consumed solution 2026')
    assert.equal(merged[2], 'consumed subsolution 2026')
    assert.equal(merged[3], 'pfhier_logical_product_desc')
    assert.equal(merged[4], 'month')
    assert.equal(merged[5], 'cacv_bud', 'empty dim cell filled from meas row')
    assert.equal(merged[6], 'cacv act', 'empty dim cell filled from meas row')
  })

  test('new-format: measures row first, dimension row second (swapped order)', () => {
    const measRow = ['', '', '', '', 'measures', 'cacv_bud', 'cacv act']
    const dimRow = ['leading end customer id&name', 'consumed solution 2026', 'consumed subsolution 2026', 'pfhier_logical_product_desc', 'month', '', '']
    // swapped: meas row before dim row
    const merged = buildMergedHeader([measRow, dimRow])
    assert.equal(merged[0], 'leading end customer id&name')
    assert.equal(merged[5], 'cacv_bud')
  })
})

// ── normalizeHeaderToCanonical ────────────────────────────────────────────────

describe('normalizeHeaderToCanonical', () => {
  test('maps old-format labels to canonical names', () => {
    const raw = ['solution_area', 'sub_solution_area', 'logical_product', 'logical_product_id', 'month', 'cacv_target', 'cacv_actual']
    assert.deepEqual(normalizeHeaderToCanonical(raw), [
      'solution_area', 'sub_solution_area', 'logical_product', 'logical_product_id', 'month', 'cacv_target', 'cacv_actual',
    ])
  })

  test('maps new-format consumed-solution labels to canonical', () => {
    const raw = ['leading end customer id&name', 'consumed solution 2026', 'consumed subsolution 2026', 'pfhier_logical_product_desc', 'month', 'cacv_bud', 'cacv act']
    const normalized = normalizeHeaderToCanonical(raw)
    assert.equal(normalized[1], 'solution_area')
    assert.equal(normalized[2], 'sub_solution_area')
    assert.equal(normalized[3], 'logical_product')
    assert.equal(normalized[4], 'month')
    assert.equal(normalized[5], 'cacv_target')
    assert.equal(normalized[6], 'cacv_actual')
  })

  test('passes through unrecognised labels unchanged', () => {
    const raw = ['unknown_column', 'another_unknown']
    const normalized = normalizeHeaderToCanonical(raw)
    assert.equal(normalized[0], 'unknown_column')
    assert.equal(normalized[1], 'another_unknown')
  })

  test('returns null/undefined input unchanged', () => {
    assert.equal(normalizeHeaderToCanonical(null), null)
    assert.equal(normalizeHeaderToCanonical(undefined), undefined)
  })
})

// ── applyCacvTransform ────────────────────────────────────────────────────────

describe('applyCacvTransform — old-format PDF rows', () => {
  // Simulate old-format PDF: MEASURES row first, SOLUTION_AREA dimension row second
  const OLD_FORMAT_ROWS = [
    ['MEASURES', 'cACV Target', 'cACV Actuals'],               // header row 1
    ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH'], // header row 2
    ['Finance', 'Treasury', 'SAP Treasury', 'LPR100', '202601', '100000', '90000'],
    ['Finance', 'Treasury', 'SAP Treasury', 'LPR100', '202602', '100000', '85000'],
  ]

  test('returns 7-column canonical header as first row (Criterion 2)', () => {
    const result = applyCacvTransform(OLD_FORMAT_ROWS)
    assert.ok(result, 'result must not be null')
    assert.deepEqual(result[0], CANONICAL_COLUMNS,
      'first row must be the exact canonical 7-column header')
  })

  test('data rows are projected to 7 canonical columns', () => {
    const result = applyCacvTransform(OLD_FORMAT_ROWS)
    // header + 2 data rows
    assert.equal(result.length, 3, 'header + 2 data rows')
    // Each data row has exactly 7 columns
    for (const row of result.slice(1)) {
      assert.equal(row.length, 7, `each data row must have 7 columns; got ${row.length} in ${JSON.stringify(row)}`)
    }
  })

  test('raw header rows do not appear as data rows (Criterion 2)', () => {
    const result = applyCacvTransform(OLD_FORMAT_ROWS)
    const rawMeasuresRow = result.slice(1).find(r => r[0] === 'MEASURES' || r[0] === 'measures')
    assert.equal(rawMeasuresRow, undefined, 'raw header rows must not appear in output data')
  })
})

describe('applyCacvTransform — new-format PDF rows (CACV_CROSS_FC_OPS_DIBO_REPORT)', () => {
  // Simulate new-format PDF: measures row has empty first cell + MEASURES keyword;
  // dimension row starts with 'Leading End Customer ID&Name'
  const NEW_FORMAT_ROWS = [
    ['﻿', '', '', '', 'Measures', 'cACV_BUD', 'cACV ACT', 'Δ cACV to BUD'],  // header row 1 (with BOM)
    ['Leading End Customer ID&Name', 'Consumed Solution 2026', 'Consumed SubSolution 2026', 'PFHIER_LOGICAL_PRODUCT_DESC', 'Month', '', '', ''], // header row 2
    ['AbbVie Inc (0016148849)', 'BAIP - Data & AI', 'BDC Public', 'SAP Analytics Cloud BI (LPR1064)', '202601', '65266.32', '44881.78', '-20384.54'],
    ['AbbVie Inc (0016148849)', 'BAIP - Data & AI', 'BDC Public', 'SAP Analytics Cloud BI (LPR1064)', '202602', '66309.09', '27436.41', '-38872.68'],
  ]

  test('returns 7-column canonical header as first row (Criterion 2)', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    assert.ok(result, 'result must not be null for new-format rows')
    assert.deepEqual(result[0], CANONICAL_COLUMNS,
      'first row must be the exact canonical 7-column header')
  })

  test('new-format: solution_area and sub_solution_area are populated (Criterion 3)', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    const firstDataRow = result[1]
    // solution_area index = 0
    assert.equal(firstDataRow[CANONICAL_COLUMNS.indexOf('solution_area')], 'BAIP - Data & AI')
    // sub_solution_area index = 1
    assert.equal(firstDataRow[CANONICAL_COLUMNS.indexOf('sub_solution_area')], 'BDC Public')
  })

  test('new-format: logical_product is populated from PFHIER_LOGICAL_PRODUCT_DESC (Criterion 3)', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    const firstDataRow = result[1]
    assert.equal(firstDataRow[CANONICAL_COLUMNS.indexOf('logical_product')], 'SAP Analytics Cloud BI (LPR1064)')
  })

  test('new-format: month is populated (Criterion 3)', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    const firstDataRow = result[1]
    assert.equal(firstDataRow[CANONICAL_COLUMNS.indexOf('month')], '202601')
  })

  test('new-format: cacv_target is populated (Criterion 3)', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    const firstDataRow = result[1]
    assert.equal(firstDataRow[CANONICAL_COLUMNS.indexOf('cacv_target')], '65266.32')
  })

  test('new-format: cacv_actual is populated (Criterion 3)', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    const firstDataRow = result[1]
    assert.equal(firstDataRow[CANONICAL_COLUMNS.indexOf('cacv_actual')], '44881.78')
  })

  test('header rows do not appear as data rows (Criterion 2)', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    const bomHeaderRow = result.slice(1).find(r => r.some(c => c.includes('Measures') || c.includes('Leading End Customer')))
    assert.equal(bomHeaderRow, undefined, 'raw header rows must not appear as data rows')
  })

  test('produces data rows for each input row', () => {
    const result = applyCacvTransform(NEW_FORMAT_ROWS)
    // 1 header + 2 data rows
    assert.equal(result.length, 3)
  })
})

// ── BOM stripping ──────────────────────────────────────────────────────────────

describe('applyCacvTransform — BOM stripping (Criterion 4)', () => {
  test('BOM in first header cell does not appear in output', () => {
    const rows = [
      ['﻿', '', '', '', 'Measures', 'cACV_BUD', 'cACV ACT'],
      ['Leading End Customer ID&Name', 'Consumed Solution 2026', 'Consumed SubSolution 2026', 'PFHIER_LOGICAL_PRODUCT_DESC', 'Month', '', ''],
      ['Cust A', 'Finance', 'Treasury', 'SAP TRM', '202601', '50000', '45000'],
    ]
    const result = applyCacvTransform(rows)
    // No BOM character in any output cell
    const allCells = result.flat()
    const hasBom = allCells.some(c => c.includes('﻿'))
    assert.ok(!hasBom, 'no BOM characters should appear in output CSV')
  })

  test('BOM in data cell is stripped before output', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['﻿Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '50000', '45000'],
    ]
    const result = applyCacvTransform(rows)
    // Check the data row has 'Finance' not '﻿Finance'
    const dataRow = result[1]
    assert.equal(dataRow[0], 'Finance', 'BOM should be stripped from data cell values')
  })
})

// ── Comma-formatted number parsing ────────────────────────────────────────────

describe('applyCacvTransform — comma-formatted number parsing (Criterion 5)', () => {
  test('strips commas from thousands-formatted integers like 22,865', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '22,865', '18,000'],
    ]
    const result = applyCacvTransform(rows)
    const dataRow = result[1]
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_target')], '22865', 'comma-formatted integer must be stripped')
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_actual')], '18000', 'comma-formatted integer must be stripped')
  })

  test('strips commas from thousands-formatted decimals like 1,234,567.89', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '1,234,567.89', '987,654.32'],
    ]
    const result = applyCacvTransform(rows)
    const dataRow = result[1]
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_target')], '1234567.89')
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_actual')], '987654.32')
  })

  test('strips quotes and commas from quoted comma-formatted numbers like "22,865"', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '"22,865"', '"18,000"'],
    ]
    const result = applyCacvTransform(rows)
    const dataRow = result[1]
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_target')], '22865', 'quoted comma-formatted number must be unquoted and stripped')
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_actual')], '18000', 'quoted comma-formatted number must be unquoted and stripped')
  })

  test('plain numbers pass through unchanged', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '65266.32', '44881.78'],
    ]
    const result = applyCacvTransform(rows)
    const dataRow = result[1]
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_target')], '65266.32')
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_actual')], '44881.78')
  })

  test('negative numbers pass through without stripping', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '100000', '-20384.54'],
    ]
    const result = applyCacvTransform(rows)
    const dataRow = result[1]
    assert.equal(dataRow[CANONICAL_COLUMNS.indexOf('cacv_actual')], '-20384.54')
  })
})

// ── Page-noise filtering ───────────────────────────────────────────────────────

describe('applyCacvTransform — page-noise row filtering (Criterion 6)', () => {
  test('page-number marker rows (N - N) are filtered out', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '100000', '90000'],
      ['1 - 1'],  // page-number noise row
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202602', '100000', '85000'],
    ]
    const result = applyCacvTransform(rows)
    // Should have header + 2 data rows, no page marker
    assert.equal(result.length, 3, 'page marker row must be filtered')
    const pageMarkerRow = result.find(r => r.length === 1 && /^\d+\s*-\s*\d+$/.test(r[0]))
    assert.equal(pageMarkerRow, undefined, 'no page marker rows in output')
  })

  test('date-only rows are filtered out', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['2026-06-25'],  // ISO date noise row
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '100000', '90000'],
    ]
    const result = applyCacvTransform(rows)
    assert.equal(result.length, 2, 'date noise row must be filtered')
    const dateRow = result.find(r => r.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(r[0]))
    assert.equal(dateRow, undefined, 'no date noise rows in output')
  })

  test('header repetitions on subsequent pages are suppressed', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202601', '100000', '90000'],
      ['2 - 1'],  // page marker
      // Repeated header rows on page 2 — must not appear as data rows
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', 'Treasury', 'SAP TRM', 'LPR100', '202602', '100000', '85000'],
    ]
    const result = applyCacvTransform(rows)
    // Only 1 header row + 2 data rows
    assert.equal(result[0].join(','), CANONICAL_COLUMNS.join(','), 'first row is canonical header')
    assert.equal(result.length, 3, 'page 2 header repetition must be suppressed')
  })
})

// ── Edge cases ─────────────────────────────────────────────────────────────────

describe('applyCacvTransform — edge cases', () => {
  test('returns null for empty input', () => {
    assert.equal(applyCacvTransform([]), null)
    assert.equal(applyCacvTransform(null), null)
  })

  test('returns null if no data rows after header', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      // no data rows
    ]
    assert.equal(applyCacvTransform(rows), null)
  })

  test('(Null) values in cells are replaced with empty string', () => {
    const rows = [
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'LOGICAL_PRODUCT', 'LOGICAL_PRODUCT_ID', 'MONTH', 'CACV_TARGET', 'CACV_ACTUAL'],
      ['Finance', '(Null)', 'SAP TRM', 'LPR100', '202601', '(Null)', '90000'],
    ]
    const result = applyCacvTransform(rows)
    const dataRow = result[1]
    assert.equal(dataRow[1], '', '(Null) sub_solution_area must become empty string')
    assert.equal(dataRow[5], '', '(Null) cacv_target must become empty string')
  })
})
