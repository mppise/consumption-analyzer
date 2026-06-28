// @story STORY-002 | pdf2csv
// @intent reads a SAP cACV PDF, detects old- and new-format 2-row headers via isCacvHeaderRow/buildMergedHeader, normalizes to exactly 7 canonical columns, strips BOM and comma-formatted numbers, and writes clean CSV to <input-basename>.csv

import { PdfReader } from 'pdfreader'
import { stringify } from 'csv-stringify'
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../config/index.js'
import { reconstructRows, looksLikeTable, isPageNumberRow, isDateOrMetadataNoiseRow } from '../lib/tableReconstructor.js'

// @entry run(args, options) | contract:tool-module — called by cli.js for --pdf2csv <file>
// @contract input: args[0] = pdf file path (string) → output: RFC 4180 CSV written to <input-basename>.csv in same directory as input | errors: throws UserError (exit 1), ProcessingError (exit 2)

/**
 * Sentinel error types — caught by cli.js which maps them to exit codes.
 * Tool modules never call process.exit() directly (pattern:exit-code-contract).
 */
export class UserError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UserError'
    this.exitCode = 1
  }
}

export class ProcessingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProcessingError'
    this.exitCode = 2
  }
}

/**
 * Known dimension keywords used to identify a header row.
 * Any row containing ANY cell that matches one of these (case-insensitive) is a header row.
 */
const HEADER_KEYWORDS = ['MEASURES', 'SOLUTION_AREA', 'EMPLOYEE_ID', 'GLOBAL_ULTIMATE_ID']

/**
 * Detects whether a row is a header row.
 * Handles both old format (first cell = MEASURES/SOLUTION_AREA) and
 * new format (first cell starts with 'LEADING END CUSTOMER', or empty first cell
 * with 'MEASURES' somewhere in the row).
 *
 * @contract input: row string[] → output: boolean
 */
function isCacvHeaderRow(row) {
  if (!row || row.length === 0) return false
  const first = row[0].replace(/^﻿/, '').trim().toUpperCase()
  // Old format: first cell is a known keyword
  if (HEADER_KEYWORDS.includes(first)) return true
  // New format: first cell starts with 'LEADING END CUSTOMER'
  if (first.startsWith('LEADING END CUSTOMER')) return true
  // New format row 0: empty first cell but 'MEASURES' appears somewhere in the row
  if (first === '' && row.some(c => c.replace(/^﻿/, '').trim().toUpperCase() === 'MEASURES')) return true
  return false
}

/**
 * Alias table: maps every known raw label variant (lowercased, trimmed) from both
 * old-format and new-format SAP cACV PDFs to one of the 7 canonical column names.
 *
 * Canonical names: solution_area, sub_solution_area, logical_product,
 *                  logical_product_id, month, cacv_target, cacv_actual
 *
 * Any label not found here is passed through as-is (preserves extra columns if
 * a PDF variant adds them — downstream fieldMapper handles reconciliation).
 */
const HEADER_ALIAS_MAP = {
  // solution_area variants
  solution_area:            'solution_area',
  'solution area':          'solution_area',
  'consumed solution 2026': 'solution_area',
  'consumed solution 2025': 'solution_area',
  'consumed solution':      'solution_area',

  // sub_solution_area variants
  sub_solution_area:            'sub_solution_area',
  'sub_solution area':          'sub_solution_area',
  'sub solution_area':          'sub_solution_area',
  'sub solution area':          'sub_solution_area',
  'subsolution_area':           'sub_solution_area',
  'subsolution area':           'sub_solution_area',
  'consumed subsolution 2026':  'sub_solution_area',
  'consumed subsolution 2025':  'sub_solution_area',
  'consumed subsolution':       'sub_solution_area',

  // logical_product variants (product name column)
  logical_product:                    'logical_product',
  'logical product':                  'logical_product',
  // pfhier_logical_product_desc is the product-name column in new-format PDFs
  // (contains both name and embedded LPR code, e.g. "SAP Analytics Cloud BI (LPR1064)")
  pfhier_logical_product_desc:        'logical_product',
  'pfhier_logical_product_desc':      'logical_product',
  // lpr in new-format CSVs is the LPR code → logical_product_id, not logical_product
  // (see HEADER_ALIAS_MAP: logical_product_id variants below)

  // logical_product_id variants (product code/identifier column)
  logical_product_id:       'logical_product_id',
  'logical product id':     'logical_product_id',
  'logical product_id':     'logical_product_id',
  // 'leading end customer id&name' is a customer identifier column in new-format CSVs —
  // it is NOT logical_product_id; lpr is the correct product code column.
  lpr:                      'logical_product_id',
  employee_id:              'logical_product_id',
  global_ultimate_id:       'logical_product_id',

  // month variants
  month:                    'month',

  // cacv_target variants
  cacv_target:              'cacv_target',
  'cacv target':            'cacv_target',
  'cacv_bud':               'cacv_target',
  'cacv bud':               'cacv_target',
  target:                   'cacv_target',
  'ytd target':             'cacv_target',
  'cacv_target_bud':        'cacv_target',

  // cacv_actual variants
  cacv_actual:              'cacv_actual',
  cacv_actuals:             'cacv_actual',
  'cacv actual':            'cacv_actual',
  'cacv actuals':           'cacv_actual',
  'cacv act':               'cacv_actual',
  'cacv_act':               'cacv_actual',
  actual:                   'cacv_actual',
  actuals:                  'cacv_actual',
  'ytd actuals':            'cacv_actual',
  'ytd actual':             'cacv_actual',
}

/**
 * Normalizes a merged header row to canonical column names using HEADER_ALIAS_MAP.
 * Unrecognised labels are passed through as-is so extra columns are preserved.
 *
 * @contract input: mergedHeader string[] (lowercased) → output: string[] (canonical names)
 */
function normalizeHeaderToCanonical(mergedHeader) {
  if (!mergedHeader) return mergedHeader
  return mergedHeader.map(label => HEADER_ALIAS_MAP[label.trim()] ?? label.trim())
}

/**
 * Parses a numeric value from a CSV cell that may contain:
 *   - Comma-formatted integers: "22,865" → "22865"
 *   - Comma-formatted decimals: "1,234,567.89" → "1234567.89"
 *   - Quoted strings: the csv-stringify step never adds them here because we work
 *     on raw string[] rows before writing, but guard anyway
 *   - Plain numbers: "0", "84" — returned as-is
 *
 * Returns the stripped numeric string. Non-numeric values (e.g. empty string) are
 * returned unchanged.
 *
 * @contract input: cell string → output: string (numeric, no commas, no surrounding quotes)
 */
function parseNumericCell(cell) {
  if (!cell) return cell
  // Strip surrounding double-quotes
  let v = cell.trim().replace(/^"(.*)"$/, '$1')
  // Strip all commas (thousands separators)
  v = v.replace(/,/g, '')
  return v
}

/**
 * The 7 canonical column names that must appear in the output CSV (Criterion 2).
 * Both old-format and new-format PDFs are projected to this exact ordered set.
 */
const CANONICAL_COLUMNS = [
  'solution_area',
  'sub_solution_area',
  'logical_product',
  'logical_product_id',
  'month',
  'cacv_target',
  'cacv_actual',
]

/**
 * Applies cACV-domain post-processing to a flat array of raw reconstructed rows.
 *
 * Algorithm:
 *   1. Strip page-number rows and date/metadata noise rows.
 *   2. Detect the first non-noise row that contains a known dimension keyword
 *      as the header row; collect the 2-row header block.
 *   3. Strip all subsequent header repetitions (same keyword detection).
 *   4. Merge and normalize the 2-row header via buildMergedHeader() +
 *      normalizeHeaderToCanonical() to produce canonical column names.
 *   5. Project header and every data row to exactly CANONICAL_COLUMNS (7 columns).
 *      Unknown extra columns are dropped; missing canonical columns are filled with ''.
 *   6. For every data row: convert (Null) to empty string in any cell;
 *      strip $ prefix and commas from cells that look like currency.
 *
 * Returns null if no data rows remain after filtering.
 *
 * @contract input: rows string[][] (all pages concatenated, raw from reconstructRows) → output: string[][] | null
 */
function applyCacvTransform(rows) {
  if (!rows || rows.length === 0) return null

  // Collect all candidate header rows (they may form a multi-row header that needs merging)
  // headerCandidates: array of consecutive header rows seen before first data row
  let headerCandidates = []
  let normalizedHeader = null
  // colIndexMap: maps canonical column name → index in the raw reconstructed row
  let colIndexMap = null
  let seenFirstData = false
  const dataRows = []

  for (const row of rows) {
    // Filter noise rows
    if (isPageNumberRow(row)) continue
    if (isDateOrMetadataNoiseRow(row)) continue

    if (isCacvHeaderRow(row)) {
      if (!seenFirstData) {
        // Still in header zone — collect candidates to merge
        headerCandidates.push(row.map(cell => String(cell).trim().toLowerCase()))
      }
      // Always skip header rows (do not pass to data, even on page repeats)
      continue
    }

    // First non-header row: finalize the header and build column index map
    if (!seenFirstData) {
      seenFirstData = true
      // Criterion 2 + 3: merge raw header rows then normalize to canonical 7-column names
      const mergedRaw = buildMergedHeader(headerCandidates)
      const mergedNormalized = normalizeHeaderToCanonical(mergedRaw)

      // Build a map from canonical name → position in the merged (normalized) header
      colIndexMap = {}
      if (mergedNormalized) {
        mergedNormalized.forEach((name, idx) => {
          // First occurrence wins if a name appears more than once
          if (!(name in colIndexMap)) colIndexMap[name] = idx
        })
      }
      // The output header is always the fixed canonical order (Criterion 2)
      normalizedHeader = CANONICAL_COLUMNS
    }

    if (normalizedHeader === null || colIndexMap === null) continue

    // Transform each cell in the raw row (Criteria 4, 5):
    //   - Strip UTF-8 BOM (﻿) from start of any cell (Criterion 4)
    //   - (Null) → empty string
    //   - Quoted comma-formatted numbers like "22,865" → stripped unquoted numeric (Criterion 5)
    //   - Unquoted comma-formatted numbers like 1,234,567.89 → stripped numeric (Criterion 5)
    //   - $ prefix stripped from currency cells
    const transformedRaw = row.map(cell => {
      // Criterion 4: strip BOM and surrounding whitespace
      const trimmed = String(cell ?? '').replace(/^﻿/, '').trim()
      if (trimmed === '(Null)') return ''
      // Criterion 5: strip surrounding double-quotes then commas (handles "22,865" → 22865)
      const unquoted = trimmed.replace(/^"(.*)"$/, '$1')
      // Strip $ prefix and commas from currency/numeric cells
      // Handles: $1,234.56 → 1234.56 | 22,865 → 22865 | "22,865" → 22865 | -1,234 → -1234
      if (/^-?\$?[\d,]+(\.\d+)?$/.test(unquoted)) {
        return unquoted.replace(/^\$/, '').replace(/,/g, '')
      }
      return unquoted
    })

    // Project to canonical 7 columns (Criteria 2 + 3)
    const projected = CANONICAL_COLUMNS.map(col => {
      const idx = colIndexMap[col]
      return idx !== undefined ? (transformedRaw[idx] ?? '') : ''
    })

    dataRows.push(projected)
  }

  if (!normalizedHeader || dataRows.length === 0) return null

  // Prepend canonical header
  return [normalizedHeader, ...dataRows]
}

/**
 * Build a merged header from multiple candidate header rows.
 *
 * Strategy:
 *   - If only one candidate row, use it directly.
 *   - New format (row with 'leading end customer' as first cell + row with 'measures' somewhere):
 *     Use dimension row (starting with 'leading end customer') as base;
 *     fill empty cells from measure row.
 *   - Old format (row where first cell is 'measures' + dimension row):
 *     Find the widest one as the dimension row; append measure labels from the 'measures' row.
 *   - Result: unified header ready for fieldMapper.
 *
 * Example (old format):
 *   row A: ['measures', 'ytd target', 'ytd actuals']  (3 cols, first cell = 'measures')
 *   row B: ['employee_id', 'global_ultimate_id', ..., 'month']  (8 cols)
 *   → merged: ['employee_id', ..., 'month', 'target', 'actuals']
 *
 * Example (new format):
 *   row A: ['', '', '', '', 'Measures', 'cACV_BUD', 'cACV ACT', ...]
 *   row B: ['Leading End Customer ID&Name', 'Consumed Solution 2026', ...]
 *   → merged: ['Leading End Customer ID&Name', 'Consumed Solution 2026', ..., 'cACV_BUD', 'cACV ACT', ...]
 *
 * @param {string[][]} candidates - already lowercased candidate header rows
 * @returns {string[]|null}
 */
function buildMergedHeader(candidates) {
  if (!candidates || candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]

  // Check for new format: a row whose first cell starts with 'leading end customer'
  const dimRow = candidates.find(r => r[0]?.startsWith('leading end customer'))
  const measRow = candidates.find(r => r.some(c => c === 'measures'))

  if (dimRow) {
    // New format: merge dimension row with measure row
    // Use dimension row as base; fill empty cells from measure row
    if (measRow) {
      return dimRow.map((cell, i) => cell || measRow[i] || `col_${i}`)
    }
    return dimRow
  }

  // Old format: Find the widest row (dimension headers)
  const dimensionRow = candidates.reduce((best, row) => row.length > best.length ? row : best, candidates[0])

  // Find measure rows: first cell is 'measures'; collect their non-first cells as measure names
  const measureLabels = []
  for (const row of candidates) {
    if (row[0] === 'measures' && row.length > 1) {
      // Normalize measure labels: strip "ytd " prefix, use as-is otherwise
      for (let i = 1; i < row.length; i++) {
        const label = row[i].replace(/^ytd\s+/i, '').trim()
        measureLabels.push(label || row[i])
      }
    }
  }

  if (measureLabels.length > 0) {
    // Dimension row + measure labels
    return [...dimensionRow, ...measureLabels]
  }

  return dimensionRow
}

/**
 * Promisified wrapper around PdfReader.parseFileItems.
 * Resolves with an object containing page-keyed arrays of text items.
 *
 * @contract input: filePath string → output: Promise<{pages: Array<{page, items}>, pageCount: number}> | errors: rejects with Error on parse failure
 */
function parsePdf(filePath) {
  return new Promise((resolve, reject) => {
    const reader = new PdfReader()
    const pages = []
    let currentPage = null
    let pageCount = 0

    reader.parseFileItems(filePath, (err, item) => {
      if (err) {
        reject(new Error(`PDF parse error: ${err.parserError ?? err.message ?? String(err)}`))
        return
      }

      if (!item) {
        // End of file
        if (currentPage) pages.push(currentPage)
        resolve({ pages, pageCount })
        return
      }

      if (item.page) {
        if (currentPage) pages.push(currentPage)
        currentPage = { page: item.page, items: [] }
        pageCount = item.page
        return
      }

      if (item.text !== undefined && currentPage) {
        currentPage.items.push({ x: item.x, y: item.y, text: item.text })
      }
    })
  })
}

/**
 * Writes CSV rows to a file on disk using csv-stringify.
 * Returns a Promise that resolves with the output file path when all rows have been written.
 *
 * @contract input: rows string[][], outputPath string, delimiter string → output: Promise<string> (resolves with outputPath) | errors: rejects on stream/write error
 */
function writeRowsToCsvFile(rows, outputPath, delimiter) {
  return new Promise((resolve, reject) => {
    const stringifier = stringify({ delimiter, quoted: false })
    const writeStream = fs.createWriteStream(outputPath)

    stringifier.on('error', reject)
    writeStream.on('error', reject)
    writeStream.on('finish', () => resolve(outputPath))

    stringifier.pipe(writeStream)

    for (const row of rows) {
      stringifier.write(row)
    }
    stringifier.end()
  })
}

// @entry run(args, options) | dispatched from cli.js for --pdf2csv flag
export async function run(args, options) {
  // --- Criterion 5: validate argument presence ---
  const fileArg = args[0]
  if (!fileArg || fileArg.trim() === '') {
    throw new UserError('--pdf2csv requires a filename argument')
  }

  // Resolve path: if absolute use as-is; else resolve relative to cwd
  const resolvedPath = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg)

  // --- Criterion 5: validate file existence ---
  if (!fs.existsSync(resolvedPath)) {
    throw new UserError(`file not found: ${fileArg}`)
  }

  const delimiter = config.csvDelimiter  // pattern:env-config
  const maxPages = config.pdfMaxPages    // Criterion 8: PDF_MAX_PAGES

  // --- Parse PDF ---
  let parsed
  try {
    parsed = await parsePdf(resolvedPath)
  } catch (err) {
    // Criterion 6: corrupt/unreadable PDF → exit 2
    throw new ProcessingError(`cannot parse PDF: ${err.message}`)
  }

  const { pages } = parsed

  // --- Apply PDF_MAX_PAGES cap (Criterion 8) ---
  let pagesToProcess = pages
  if (maxPages > 0 && pages.length > maxPages) {
    process.stderr.write(`warn: PDF_MAX_PAGES reached (${maxPages}) — output may be incomplete\n`)
    pagesToProcess = pages.slice(0, maxPages)
  }

  // --- Reconstruct table rows across all processed pages ---
  const allRows = []

  for (const pageData of pagesToProcess) {
    if (!pageData.items || pageData.items.length === 0) {
      // Criterion 7: warn on pages with no text layer
      process.stderr.write(`warn: page ${pageData.page} skipped — no text layer detected\n`)
      continue
    }

    const rows = reconstructRows(pageData.items)
    if (rows.length > 0) {
      allRows.push(...rows)
    }
  }

  // --- Criterion 6: no tables detected → exit 2 ---
  if (!looksLikeTable(allRows)) {
    throw new ProcessingError(`no tables detected in ${fileArg}`)
  }

  // --- Apply cACV-domain transform: merge 2-row header, normalize, strip comma-numbers ---
  // Criteria 1, 2, 3, 4
  const finalRows = applyCacvTransform(allRows)

  if (!finalRows || finalRows.length < 2) {
    // Header only or empty — no data rows → exit 2
    throw new ProcessingError(`no table rows detected after header merge in ${fileArg}`)
  }

  // --- Criterion 1: derive output path — use options.output if provided, else replace .pdf extension with .csv in same directory ---
  const outputPath = options.output ?? resolvedPath.replace(/\.pdf$/i, '.csv')

  // --- Write CSV to file ---
  await writeRowsToCsvFile(finalRows, outputPath, delimiter)
  process.stdout.write(`${outputPath}\n`)
}

// ── Exports for unit testing ───────────────────────────────────────────────────
// These internal functions are exported so the test suite can exercise them
// without requiring a real PDF file (Criteria 2, 3, 4, 5).
export {
  isCacvHeaderRow,
  buildMergedHeader,
  normalizeHeaderToCanonical,
  applyCacvTransform,
  HEADER_ALIAS_MAP,
  CANONICAL_COLUMNS,
}
