// @story STORY-002 | pdf2csv
// @intent groups pdfreader text items (with x/y coordinates) into table rows and columns, yielding string arrays suitable for csv-stringify

/**
 * Y-coordinate tolerance: items whose y values are within this threshold are
 * considered to be on the same logical row. Tuned for pdfreader's unit scale
 * (~72 units/inch scaled down — pdfreader uses a ~0.01-inch unit, so 0.3 ≈ 3 points).
 */
const ROW_Y_TOLERANCE = 0.3

/**
 * @contract input: items[] — pdfreader text items [{x, y, text}] (single page) →
 *           output: string[][] — array of rows, each row is sorted-by-x array of text strings |
 *           errors: returns [] if no items
 */
export function reconstructRows(items) {
  if (!items || items.length === 0) return []

  // Group items by y-bucket (items within ROW_Y_TOLERANCE share a bucket)
  const buckets = [] // [{yRef: number, items: [{x, text}]}]

  for (const item of items) {
    const existingBucket = buckets.find(b => Math.abs(b.yRef - item.y) <= ROW_Y_TOLERANCE)
    if (existingBucket) {
      existingBucket.items.push({ x: item.x, text: item.text })
    } else {
      buckets.push({ yRef: item.y, items: [{ x: item.x, text: item.text }] })
    }
  }

  // Sort buckets by yRef (top-to-bottom)
  buckets.sort((a, b) => a.yRef - b.yRef)

  // Within each bucket, sort items by x (left-to-right) and extract text
  return buckets.map(bucket => {
    bucket.items.sort((a, b) => a.x - b.x)
    return bucket.items.map(i => i.text)
  })
}

/**
 * Determines whether a set of rows looks like a table.
 * A table must have at least 2 rows (header + 1 data row) and at least 2 columns.
 *
 * @contract input: rows string[][] → output: boolean
 */
export function looksLikeTable(rows) {
  if (!rows || rows.length < 2) return false
  const maxCols = Math.max(...rows.map(r => r.length))
  return maxCols >= 2
}

// ── Clean output filtering ─────────────────────────────────────────────────────

/**
 * Returns true if the row is a page-number marker (e.g. "1 - 1", "2 - 1").
 * These single-cell rows are emitted by pdfreader from PDF page-label objects
 * and carry no data content.
 *
 * @contract input: row string[] → output: boolean
 */
export function isPageNumberRow(row) {
  if (!row || row.length !== 1) return false
  return /^\d+\s*-\s*\d+$/.test(row[0].trim())
}

/**
 * Returns true if the row is a date/metadata noise row.
 * Matches single-cell rows whose only content is:
 *   - An ISO date (YYYY-MM-DD)
 *   - A short run-together date (YYYYMMDD)
 *   - A locale date (MM/DD/YYYY or DD.MM.YYYY)
 *   - A short metadata string (≤ 20 chars, no commas, no spaces run longer than 2 chars)
 *     that does not look like a real data value.
 * The conservative heuristic is: single-cell AND (date pattern OR very short plain token).
 *
 * @contract input: row string[] → output: boolean
 */
export function isDateOrMetadataNoiseRow(row) {
  if (!row || row.length !== 1) return false
  const cell = row[0].trim()
  // ISO date: 2026-06-25
  if (/^\d{4}-\d{2}-\d{2}$/.test(cell)) return true
  // Compact date: 20260625
  if (/^\d{8}$/.test(cell)) return true
  // Locale date: 06/25/2026 or 25.06.2026
  if (/^\d{1,2}[./]\d{1,2}[./]\d{4}$/.test(cell)) return true
  // Locale date: 25.06.26 or 6/25/26
  if (/^\d{1,2}[./]\d{1,2}[./]\d{2}$/.test(cell)) return true
  return false
}

/**
 * Produces a canonical row key for header deduplication:
 * joins all cells with a pipe separator (cells are trimmed).
 *
 * @contract input: row string[] → output: string
 */
export function rowKey(row) {
  return row.map(c => c.trim()).join('|')
}

/**
 * Applies clean-output filtering to a flat array of rows spanning all pages:
 *   (a) Removes page-number marker rows (isPageNumberRow).
 *   (b) Deduplicates header rows — emits the leading header block once at row 1 only;
 *       suppresses all subsequent appearances of those exact rows.
 *   (c) Removes date/metadata noise rows (isDateOrMetadataNoiseRow).
 *
 * "Header block" is defined as the contiguous leading rows that appear before the
 * first multi-column data row whose cells do not match any known header pattern.
 * In practice: we detect the set of row keys that appear at the top of the output
 * and track them; if the same row key re-appears later we suppress it.
 *
 * Algorithm:
 *   1. Walk rows; skip page-number and date/metadata noise rows.
 *   2. Collect the initial header block: leading rows that are repeated ≥ 2 times
 *      across the full (pre-filter) list are candidates. We scan forward from the
 *      start to find where the first non-repeating data row begins — everything
 *      before that boundary is the header block.
 *   3. Once the header block keys are known, emit each header key exactly once
 *      (the first occurrence); suppress all later occurrences.
 *
 * @contract input: rows string[][] (all pages concatenated) → output: string[][] (clean rows)
 */
export function applyCleanOutputFilter(rows) {
  if (!rows || rows.length === 0) return []

  // Step 1: pre-filter — remove page markers and date/metadata noise
  const preFiltered = rows.filter(row => !isPageNumberRow(row) && !isDateOrMetadataNoiseRow(row))

  if (preFiltered.length === 0) return []

  // Step 2: identify the header block.
  // Count how many times each row key appears across the entire pre-filtered output.
  const keyCounts = new Map()
  for (const row of preFiltered) {
    const k = rowKey(row)
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1)
  }

  // The header block is the leading contiguous sequence of rows that appear more than once.
  // We stop collecting header rows at the first row that appears only once (a unique data row).
  const headerKeys = new Set()
  for (const row of preFiltered) {
    const k = rowKey(row)
    if ((keyCounts.get(k) ?? 1) > 1) {
      headerKeys.add(k)
    } else {
      // First unique data row — header block ends here
      break
    }
  }

  // Step 3: emit each header key exactly once; emit all non-header rows normally
  const emittedHeaderKeys = new Set()
  const result = []

  for (const row of preFiltered) {
    const k = rowKey(row)
    if (headerKeys.has(k)) {
      if (!emittedHeaderKeys.has(k)) {
        emittedHeaderKeys.add(k)
        result.push(row)
      }
      // else: suppress duplicate header row
    } else {
      result.push(row)
    }
  }

  return result
}
