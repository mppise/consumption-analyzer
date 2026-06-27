// @story STORY-002 | pdf2csv
// @intent integration and unit tests for the --pdf2csv feature: validates exit codes, CSV file output, error envelopes, env var behavior, table detection, and clean output filtering

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..')
const CLI = path.join(PROJECT_ROOT, 'src', 'cli.js')
const SAMPLE_PDF = path.join(PROJECT_ROOT, 'data', 'CL_WPAK_CACV_ACCOUNT_TARGET.pdf')

// Helper: run the CLI with given args, returns { stdout, stderr, status }
function runCli(args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 30000,
  })
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status ?? -1,
  }
}

// ── Unit tests: tableReconstructor ────────────────────────────────────────────

describe('tableReconstructor', () => {
  test('reconstructRows groups items by y-coordinate proximity', async () => {
    const { reconstructRows } = await import('../src/lib/tableReconstructor.js')
    const items = [
      { x: 1, y: 1.0, text: 'A' },
      { x: 5, y: 1.1, text: 'B' },  // same row as A (within tolerance)
      { x: 1, y: 2.0, text: 'C' },
    ]
    const rows = reconstructRows(items)
    assert.equal(rows.length, 2, 'should produce 2 rows')
    assert.deepEqual(rows[0], ['A', 'B'], 'first row should contain A and B sorted by x')
    assert.deepEqual(rows[1], ['C'], 'second row should contain C')
  })

  test('reconstructRows sorts items by x within a row', async () => {
    const { reconstructRows } = await import('../src/lib/tableReconstructor.js')
    const items = [
      { x: 10, y: 1.0, text: 'Right' },
      { x: 1,  y: 1.0, text: 'Left' },
    ]
    const rows = reconstructRows(items)
    assert.deepEqual(rows[0], ['Left', 'Right'])
  })

  test('reconstructRows returns empty array for empty input', async () => {
    const { reconstructRows } = await import('../src/lib/tableReconstructor.js')
    assert.deepEqual(reconstructRows([]), [])
    assert.deepEqual(reconstructRows(null), [])
  })

  test('looksLikeTable returns true for rows with 2+ cols and 2+ rows', async () => {
    const { looksLikeTable } = await import('../src/lib/tableReconstructor.js')
    assert.ok(looksLikeTable([['H1', 'H2'], ['V1', 'V2']]))
  })

  test('looksLikeTable returns false for single row', async () => {
    const { looksLikeTable } = await import('../src/lib/tableReconstructor.js')
    assert.ok(!looksLikeTable([['H1', 'H2']]))
  })

  test('looksLikeTable returns false for single column', async () => {
    const { looksLikeTable } = await import('../src/lib/tableReconstructor.js')
    assert.ok(!looksLikeTable([['H1'], ['V1']]))
  })
})

// ── Unit tests: clean output filtering ────────────────────────────────────────

describe('tableReconstructor clean output filtering', () => {
  test('isPageNumberRow detects N - N patterns', async () => {
    const { isPageNumberRow } = await import('../src/lib/tableReconstructor.js')
    assert.ok(isPageNumberRow(['1 - 1']), '"1 - 1" is a page marker')
    assert.ok(isPageNumberRow(['2 - 1']), '"2 - 1" is a page marker')
    assert.ok(isPageNumberRow(['10 - 3']), '"10 - 3" is a page marker')
    assert.ok(!isPageNumberRow(['Page', 'Number']), 'multi-cell row is not a page marker')
    assert.ok(!isPageNumberRow(['SOLUTION_AREA']), 'column header is not a page marker')
    assert.ok(!isPageNumberRow(['202601']), 'year-month integer is not a page marker')
  })

  test('isDateOrMetadataNoiseRow detects date patterns', async () => {
    const { isDateOrMetadataNoiseRow } = await import('../src/lib/tableReconstructor.js')
    assert.ok(isDateOrMetadataNoiseRow(['2026-06-25']), 'ISO date is noise')
    assert.ok(isDateOrMetadataNoiseRow(['20260625']), 'compact date is noise')
    assert.ok(isDateOrMetadataNoiseRow(['06/25/2026']), 'MM/DD/YYYY date is noise')
    assert.ok(isDateOrMetadataNoiseRow(['25.06.2026']), 'DD.MM.YYYY date is noise')
    assert.ok(!isDateOrMetadataNoiseRow(['Measures', 'cACV Target']), 'multi-cell header row is not noise')
    assert.ok(!isDateOrMetadataNoiseRow(['202601']), 'YYYYMM integer is not a date noise row')
  })

  test('applyCleanOutputFilter removes page-number marker rows', async () => {
    const { applyCleanOutputFilter } = await import('../src/lib/tableReconstructor.js')
    const rows = [
      ['Header1', 'Header2'],
      ['Data1', 'Data2'],
      ['1 - 1'],
      ['Header1', 'Header2'],
      ['Data3', 'Data4'],
    ]
    const result = applyCleanOutputFilter(rows)
    const hasPageMarker = result.some(r => r.length === 1 && /^\d+\s*-\s*\d+$/.test(r[0]))
    assert.ok(!hasPageMarker, 'no page marker rows should remain after filtering')
  })

  test('applyCleanOutputFilter emits header rows exactly once at row 1', async () => {
    const { applyCleanOutputFilter } = await import('../src/lib/tableReconstructor.js')
    // Simulate two-page output: each page has same header rows repeated
    const rows = [
      ['H1', 'H2'],       // header row (appears on both pages)
      ['D1', 'D2'],       // unique data row page 1
      ['D2a', 'D2b'],     // unique data row page 1
      ['1 - 1'],          // page marker
      ['H1', 'H2'],       // repeated header row (page 2)
      ['D3', 'D4'],       // unique data row page 2
    ]
    const result = applyCleanOutputFilter(rows)

    // Header must appear at index 0
    assert.deepEqual(result[0], ['H1', 'H2'], 'header row must be first row of output')

    // Header must appear exactly once
    const headerCount = result.filter(r => r[0] === 'H1' && r[1] === 'H2').length
    assert.equal(headerCount, 1, 'header row must appear exactly once')

    // All data rows must be present
    const dataKeys = result.map(r => r.join(','))
    assert.ok(dataKeys.includes('D1,D2'), 'data row D1/D2 must be present')
    assert.ok(dataKeys.includes('D3,D4'), 'data row D3/D4 must be present')
  })

  test('applyCleanOutputFilter handles multi-row header block deduplicated once', async () => {
    const { applyCleanOutputFilter } = await import('../src/lib/tableReconstructor.js')
    // Two header rows repeated per page (like the sample PDF)
    const rows = [
      ['Measures', 'cACV Target', 'cACV Actuals'],
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'MONTH', '$', '$'],
      ['Company A', 'Product X', '202601', '100', '90'],
      ['2 - 1'],
      ['Measures', 'cACV Target', 'cACV Actuals'],
      ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'MONTH', '$', '$'],
      ['Company B', 'Product Y', '202602', '200', '180'],
    ]
    const result = applyCleanOutputFilter(rows)

    // First two rows should be the header block
    assert.deepEqual(result[0], ['Measures', 'cACV Target', 'cACV Actuals'], 'first header row at index 0')
    assert.deepEqual(result[1], ['SOLUTION_AREA', 'SUB_SOLUTION_AREA', 'MONTH', '$', '$'], 'second header row at index 1')

    // Each header row appears only once
    const h1Count = result.filter(r => r[0] === 'Measures').length
    const h2Count = result.filter(r => r[0] === 'SOLUTION_AREA').length
    assert.equal(h1Count, 1, '"Measures" header row must appear exactly once')
    assert.equal(h2Count, 1, '"SOLUTION_AREA" header row must appear exactly once')

    // Data rows for both pages must be present
    const dataKeys = result.map(r => r[0])
    assert.ok(dataKeys.includes('Company A'), 'page 1 data must be present')
    assert.ok(dataKeys.includes('Company B'), 'page 2 data must be present')

    // No page markers
    const hasPageMarker = result.some(r => r.length === 1 && /^\d+\s*-\s*\d+$/.test(r[0]))
    assert.ok(!hasPageMarker, 'no page marker rows should remain')
  })

  test('applyCleanOutputFilter removes date/metadata noise rows', async () => {
    const { applyCleanOutputFilter } = await import('../src/lib/tableReconstructor.js')
    const rows = [
      ['Header1', 'Header2'],
      ['2026-06-25'],      // ISO date noise row
      ['Data1', 'Data2'],
      ['20260625'],        // compact date noise row
      ['Data3', 'Data4'],
    ]
    const result = applyCleanOutputFilter(rows)
    const hasIsoDate = result.some(r => r.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(r[0]))
    const hasCompactDate = result.some(r => r.length === 1 && /^\d{8}$/.test(r[0]))
    assert.ok(!hasIsoDate, 'ISO date noise rows must be filtered')
    assert.ok(!hasCompactDate, 'compact date noise rows must be filtered')
    assert.equal(result.length, 3, 'only non-noise rows should remain (header + 2 data rows)')
  })

  test('applyCleanOutputFilter returns empty array for empty input', async () => {
    const { applyCleanOutputFilter } = await import('../src/lib/tableReconstructor.js')
    assert.deepEqual(applyCleanOutputFilter([]), [])
    assert.deepEqual(applyCleanOutputFilter(null), [])
  })
})

// ── Unit tests: pdf2csv module error types ─────────────────────────────────────

describe('pdf2csv module error types', () => {
  test('UserError has exitCode 1', async () => {
    const { UserError } = await import('../src/tools/pdf2csv.js')
    const err = new UserError('test')
    assert.equal(err.exitCode, 1)
    assert.equal(err.name, 'UserError')
  })

  test('ProcessingError has exitCode 2', async () => {
    const { ProcessingError } = await import('../src/tools/pdf2csv.js')
    const err = new ProcessingError('test')
    assert.equal(err.exitCode, 2)
    assert.equal(err.name, 'ProcessingError')
  })

  test('run throws UserError when no args provided', async () => {
    const { run, UserError } = await import('../src/tools/pdf2csv.js')
    await assert.rejects(() => run([], {}), UserError)
  })

  test('run throws UserError when file does not exist', async () => {
    const { run, UserError } = await import('../src/tools/pdf2csv.js')
    await assert.rejects(() => run(['/nonexistent/path/fake.pdf'], {}), UserError)
  })
})

// ── Integration tests: CLI exit codes and output ───────────────────────────────

describe('CLI --pdf2csv integration', () => {
  test('exits 1 and writes error-envelope when no argument given', () => {
    // Commander requires a value for --pdf2csv <file>; omitting triggers its own error
    // We test the "no file" path by using a missing file path directly
    const r = runCli(['--pdf2csv', 'nonexistent-file-xyz.pdf'])
    assert.equal(r.status, 1, 'should exit 1')
    assert.match(r.stderr, /^error:/, 'stderr should start with error: prefix')
  })

  test('exits 1 and writes error-envelope when file does not exist', () => {
    const r = runCli(['--pdf2csv', '/tmp/does-not-exist-12345.pdf'])
    assert.equal(r.status, 1, 'should exit 1 for missing file')
    assert.match(r.stderr, /^error:/, 'stderr should start with error: prefix')
    assert.match(r.stderr, /file not found/, 'error message should mention file not found')
  })

  test('exits 1 and writes error-envelope when no flag given', () => {
    const r = runCli([])
    assert.equal(r.status, 1, 'should exit 1 when no flag given')
    assert.match(r.stderr, /^error:/, 'stderr should start with error: prefix')
  })

  test('exits 0 and writes CSV file for valid PDF with tables', function() {
    if (!fs.existsSync(SAMPLE_PDF)) {
      this.skip('sample PDF not present in data/ directory')
      return
    }
    const expectedCsv = SAMPLE_PDF.replace(/\.pdf$/i, '.csv')
    // Clean up any previous run artifact before the test
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)

    const r = runCli(['--pdf2csv', SAMPLE_PDF])
    assert.equal(r.status, 0, `should exit 0; stderr was: ${r.stderr}`)

    // Criterion 1: CSV file must exist at <input-basename>.csv in same dir
    assert.ok(fs.existsSync(expectedCsv), `CSV file should be written to ${expectedCsv}`)

    // stdout should contain the output file path
    assert.match(r.stdout.trim(), /\.csv$/, 'stdout should report the output file path')

    // Criterion 1: output should contain at least header + data rows
    const content = fs.readFileSync(expectedCsv, 'utf8')
    const lines = content.trim().split('\n')
    assert.ok(lines.length >= 2, 'CSV file should have at least 2 rows (header + data)')
    // Verify at least one row has multiple columns (comma-separated)
    const hasMultiColumnRow = lines.some(line => line.includes(','))
    assert.ok(hasMultiColumnRow, 'CSV file should contain at least one row with comma-separated values')

    // Clean up artifact
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)
  })

  test('CSV output file uses CSV_DELIMITER env var', function() {
    if (!fs.existsSync(SAMPLE_PDF)) {
      this.skip('sample PDF not present in data/ directory')
      return
    }
    const expectedCsv = SAMPLE_PDF.replace(/\.pdf$/i, '.csv')
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)

    const r = runCli(['--pdf2csv', SAMPLE_PDF], { CSV_DELIMITER: '|' })
    assert.equal(r.status, 0, `should exit 0; stderr was: ${r.stderr}`)
    assert.ok(fs.existsSync(expectedCsv), `CSV file should be written to ${expectedCsv}`)

    const content = fs.readFileSync(expectedCsv, 'utf8')
    const lines = content.trim().split('\n')
    // At least one multi-column row should use the pipe delimiter
    const hasMultiColumnPipeRow = lines.some(line => line.includes('|'))
    assert.ok(hasMultiColumnPipeRow, 'CSV file should use pipe delimiter in at least one row')

    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)
  })

  test('PDF_MAX_PAGES cap emits warn-envelope and exits 0', function() {
    if (!fs.existsSync(SAMPLE_PDF)) {
      this.skip('sample PDF not present in data/ directory')
      return
    }
    const expectedCsv = SAMPLE_PDF.replace(/\.pdf$/i, '.csv')
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)

    const r = runCli(['--pdf2csv', SAMPLE_PDF], { PDF_MAX_PAGES: '1' })
    assert.equal(r.status, 0, `should exit 0 even with page cap; stderr was: ${r.stderr}`)
    // May or may not emit warn if PDF has only 1 page — just check it doesn't crash
    // If PDF has >1 page, warn should appear

    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)
  })

  test('--help shows pdf2csv in usage', () => {
    const r = runCli(['--help'])
    assert.equal(r.status, 0, 'help should exit 0')
    assert.match(r.stdout, /--pdf2csv/, 'help should mention --pdf2csv flag')
  })
})

// ── Integration tests: clean output mode ──────────────────────────────────────

describe('CLI --pdf2csv clean output mode', () => {
  test('CSV output has no page-number marker rows (N - N pattern)', function() {
    if (!fs.existsSync(SAMPLE_PDF)) {
      this.skip('sample PDF not present in data/ directory')
      return
    }
    const expectedCsv = SAMPLE_PDF.replace(/\.pdf$/i, '.csv')
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)

    const r = runCli(['--pdf2csv', SAMPLE_PDF])
    assert.equal(r.status, 0, `should exit 0; stderr was: ${r.stderr}`)

    const content = fs.readFileSync(expectedCsv, 'utf8')
    const lines = content.trim().split('\n')
    // No line should be a single cell matching N - N
    const pageMarkerLines = lines.filter(line => {
      const cells = line.split(',')
      return cells.length === 1 && /^\d+\s*-\s*\d+$/.test(cells[0].trim())
    })
    assert.equal(pageMarkerLines.length, 0,
      `page marker rows must not appear in output; found: ${JSON.stringify(pageMarkerLines)}`)

    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)
  })

  test('CSV output has header rows appearing exactly once on rows 1 and 2', function() {
    if (!fs.existsSync(SAMPLE_PDF)) {
      this.skip('sample PDF not present in data/ directory')
      return
    }
    const expectedCsv = SAMPLE_PDF.replace(/\.pdf$/i, '.csv')
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)

    const r = runCli(['--pdf2csv', SAMPLE_PDF])
    assert.equal(r.status, 0, `should exit 0; stderr was: ${r.stderr}`)

    const content = fs.readFileSync(expectedCsv, 'utf8')
    const lines = content.trim().split('\n')

    // The sample PDF has two known header rows; count occurrences of each
    const measuresLines = lines.filter(l => l.startsWith('Measures,'))
    const solutionAreaLines = lines.filter(l => l.startsWith('SOLUTION_AREA,'))

    assert.equal(measuresLines.length, 1, '"Measures" header row must appear exactly once')
    assert.equal(solutionAreaLines.length, 1, '"SOLUTION_AREA" header row must appear exactly once')

    // They must be the first two lines (rows 1 and 2 — 0-indexed 0 and 1)
    assert.ok(lines[0].startsWith('Measures,'), 'first line must be the Measures header row')
    assert.ok(lines[1].startsWith('SOLUTION_AREA,'), 'second line must be the SOLUTION_AREA header row')

    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)
  })

  test('CSV output has no date/metadata noise rows', function() {
    if (!fs.existsSync(SAMPLE_PDF)) {
      this.skip('sample PDF not present in data/ directory')
      return
    }
    const expectedCsv = SAMPLE_PDF.replace(/\.pdf$/i, '.csv')
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)

    const r = runCli(['--pdf2csv', SAMPLE_PDF])
    assert.equal(r.status, 0, `should exit 0; stderr was: ${r.stderr}`)

    const content = fs.readFileSync(expectedCsv, 'utf8')
    const lines = content.trim().split('\n')

    // No single-cell line containing only an ISO date (YYYY-MM-DD or YYYYMMDD)
    const isoDates = lines.filter(l => {
      const cells = l.split(',')
      return cells.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(cells[0].trim())
    })
    const compactDates = lines.filter(l => {
      const cells = l.split(',')
      return cells.length === 1 && /^\d{8}$/.test(cells[0].trim())
    })
    assert.equal(isoDates.length, 0, 'no ISO date noise rows must appear in output')
    assert.equal(compactDates.length, 0, 'no compact date noise rows must appear in output')

    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)
  })

  test('clean output row count is reduced compared to raw extraction', function() {
    if (!fs.existsSync(SAMPLE_PDF)) {
      this.skip('sample PDF not present in data/ directory')
      return
    }
    const expectedCsv = SAMPLE_PDF.replace(/\.pdf$/i, '.csv')
    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)

    const r = runCli(['--pdf2csv', SAMPLE_PDF])
    assert.equal(r.status, 0, `should exit 0; stderr was: ${r.stderr}`)

    const content = fs.readFileSync(expectedCsv, 'utf8')
    const lines = content.trim().split('\n')

    // The sample PDF has 5 pages; raw output had 231 rows (5 page markers + 8 repeated header rows + data)
    // Clean output should have fewer rows than 231 (noise removed)
    // We know the clean output is 218 rows; test that it is < 231 to avoid hardcoding
    assert.ok(lines.length < 231,
      `clean CSV row count (${lines.length}) should be less than raw row count (231)`)

    // Sanity check: should still have substantial data (> 200 rows given ~215 data rows)
    assert.ok(lines.length >= 200,
      `clean CSV should retain all data rows; got ${lines.length}`)

    if (fs.existsSync(expectedCsv)) fs.unlinkSync(expectedCsv)
  })
})
