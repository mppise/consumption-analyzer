// @story STORY-001 | field-mapper-enhancement
// @intent normalizes arbitrary CSV headers to canonical cACV field names using alias lookup and optional AI fallback; also recognizes optional metadata fields (employee_id, customer_id, customer_name, customer_raw) and passes through unknown columns

// @contract input: headers string[], sampleRows string[][], aiClient? AIClient → output: { mapping: {canonical_field: columnIndex}, metadataMapping: {metadata_field: columnIndex}, extraMapping: {originalHeader: columnIndex}, warnings: string[] } | errors: throws UserError on unmapped REQUIRED canonical fields (solution_area, logical_product, month, actuals)

/**
 * The canonical cACV field names that every downstream tool expects.
 * Optional fields: customer_raw, sub_solution_area, logical_product_id, target
 */
export const CANONICAL_FIELDS = [
  'solution_area',
  'sub_solution_area',
  'logical_product',
  'logical_product_id',
  'month',
  'target',
  'actuals',
  'customer_raw',
]

/**
 * Required fields — missing any of these is a hard failure.
 * Optional canonical fields (sub_solution_area, logical_product_id, target, customer_raw)
 * may be absent without throwing.
 */
export const REQUIRED_FIELDS = ['solution_area', 'logical_product', 'month', 'actuals']

/**
 * Alias map for canonical fields and the new customer_raw field.
 * All values are already normalized (lowercase, underscores) — matched
 * against the normalized form of each input header.
 */
const FIELD_ALIASES = {
  solution_area: [
    'solution_area', 'solutionarea', 'sol_area', 'area',
    // new format
    'consumed_solution_2026', 'consumed_solution', 'solution_2026',
  ],
  sub_solution_area: [
    'sub_solution_area', 'subsolutionarea', 'sub_area', 'subsolution',
    // new format
    'consumed_subsolution_2026', 'consumed_subsolution', 'subsolution_2026',
  ],
  logical_product: [
    'logical_product', 'logicalproduct', 'product', 'product_name', 'productname',
    // new format
    'pfhier_logical_product_desc', 'logical_product_desc', 'product_desc',
  ],
  logical_product_id: ['logical_product_id', 'logicalproductid', 'product_id', 'productid', 'lpr_id', 'id'],
  month: ['month', 'yyyymm', 'period', 'fiscal_month', 'reporting_month', 'date'],
  target: [
    'target', 'cacv_target', 'budget', 'budgeted', 'plan', 'planned', 'cacv_tgt',
    // new format
    'cacv_bud', 'cacv_budget',
  ],
  actuals: [
    'actuals', 'cacv_actuals', 'actual', 'consumed', 'consumption', 'cacv_act', 'cacv_actual',
  ],
  // customer_raw: the combined "Name (ID)" format from new CSV; parsed in transform.js
  customer_raw: [
    'leading_end_customer_idname',
    'leading_end_customer_id_name',
    'customer_id_name',
    'end_customer',
    'customer',
  ],
}

/**
 * Optional metadata fields — recognized but not required.
 * These are stored separately from canonical fields in the returned metadataMapping.
 * All alias values are already normalized (lowercase, underscores).
 */
export const METADATA_FIELDS = {
  employee_id: ['employee_id', 'employeeid', 'emp_id', 'user_id'],
  customer_id: ['global_ultimate_id', 'globalultimateid', 'customer_id', 'account_id', 'org_id'],
  customer_name: ['global_ultimate_text', 'globalultimatetext', 'customer_name', 'customer', 'account_name', 'company', 'organization'],
  // pre-computed fields from new format — stored as metadata, not used in metrics computation
  acv_act: ['acv_act', 'avc_act'],
  cacv_acv: ['cacv_acv', 'cacv_acv_diff'],
  budget_attainment_pct: ['budget_attainment_', 'budget_attainment', 'budget_attainment_pct', 'attainment_pct_precomputed'],
  delta_cacv: ['_cacv_to_bud', 'delta_cacv_to_bud', 'cacv_to_bud', 'delta_cacv'],
}

/**
 * Normalize a header string to a stable key for alias lookup:
 *   1. Lowercase
 *   2. Trim
 *   3. Replace runs of spaces, hyphens, dots with a single underscore
 *   4. Strip any remaining non-alphanumeric, non-underscore characters
 *
 * @param {string} h - raw header string
 * @returns {string} normalized key
 */
function normalizeHeader(h) {
  return String(h)
    .toLowerCase()
    .trim()
    .replace(/[\s\-\.]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
}

/**
 * Attempt to map each canonical field to one of the input headers by alias lookup.
 *
 * @param {string[]} normalizedHeaders - pre-normalized form of each input header
 * @returns {{ matched: Map<string,number>, unmatched: string[] }}
 *   matched: canonical_field → column index (0-based)
 *   unmatched: canonical fields that had no alias hit
 */
function fuzzyMatch(normalizedHeaders) {
  const matched = new Map()   // canonical_field → column index
  const unmatched = []

  for (const field of CANONICAL_FIELDS) {
    const aliases = FIELD_ALIASES[field] ?? []
    let found = false

    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (aliases.includes(normalizedHeaders[i])) {
        matched.set(field, i)
        found = true
        break
      }
    }

    if (!found) unmatched.push(field)
  }

  return { matched, unmatched }
}

/**
 * Call the AI client to resolve headers that the alias lookup did not match.
 *
 * @param {string[]} headers - original (un-normalized) headers
 * @param {string[][]} sampleRows - first ≤3 data rows
 * @param {object} aiClient - an AIClient instance (must have .chat(prompt) method)
 * @returns {Promise<object>} raw JSON object mapping original_header → canonical_field_or_null
 */
async function aiMapHeaders(headers, sampleRows, aiClient) {
  const prompt = `Given these CSV headers: ${JSON.stringify(headers)}
And these sample values: ${JSON.stringify(sampleRows.slice(0, 3))}
Map each header to one of these canonical fields: solution_area, sub_solution_area, logical_product, logical_product_id, month, target, actuals
Return ONLY a JSON object like: {"original_header": "canonical_field", ...}
If a header doesn't map to any canonical field, map it to null.`

  const response = await aiClient.chat(prompt)

  // Extract the first JSON object from the response
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('AI field mapper returned no JSON object')

  const parsed = JSON.parse(jsonMatch[0])

  // Validate — each value must be a canonical field or null
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== null && !CANONICAL_FIELDS.includes(value)) {
      // Treat unrecognized values as null rather than throwing
      parsed[key] = null
    }
  }

  return parsed
}

/**
 * Map arbitrary CSV headers to canonical cACV field names.
 *
 * Algorithm:
 *   1. Normalize each header.
 *   2. Fuzzy-match against known FIELD_ALIASES → confident matches for canonical fields.
 *   3. For any unmatched canonical field: if aiClient provided, ask AI.
 *   4. Match remaining unmatched headers against METADATA_FIELDS aliases.
 *   5. Remaining unmatched headers → extraMapping (pass-through by original header name).
 *   6. Throw UserError if any required canonical field remains unmapped.
 *
 * @param {string[]} headers - raw header strings from the CSV
 * @param {string[][]} sampleRows - first few data rows (used for AI context)
 * @param {object|null} [aiClient] - AIClient instance; pass null to skip AI fallback
 * @returns {Promise<{ mapping: object, metadataMapping: object, extraMapping: object, warnings: string[] }>}
 *   mapping: { canonical_field: columnIndex (0-based) }
 *   metadataMapping: { metadata_field: columnIndex } (employee_id, customer_id, customer_name)
 *   extraMapping: { originalHeader: columnIndex } for unrecognized columns
 */
// @entry mapFields(headers, sampleRows, aiClient) | maps raw CSV headers to canonical cACV fields
export async function mapFields(headers, sampleRows, aiClient = null) {
  const warnings = []
  const normalizedHeaders = headers.map(normalizeHeader)

  // Step 1: alias-based fuzzy match for canonical fields
  const { matched, unmatched } = fuzzyMatch(normalizedHeaders)

  // Step 2: AI fallback for unmatched REQUIRED canonical fields
  const unmatchedForAI = unmatched.filter(f => REQUIRED_FIELDS.includes(f))
  if (unmatchedForAI.length > 0 && aiClient) {
    let aiResult
    try {
      aiResult = await aiMapHeaders(headers, sampleRows, aiClient)
    } catch (err) {
      process.stderr.write(`warn: AI field mapping failed — ${err.message}\n`)
      aiResult = {}
    }

    // Apply AI mappings: original_header → canonical_field
    for (const [origHeader, canonical] of Object.entries(aiResult)) {
      if (!canonical) continue                        // AI returned null → no mapping
      if (!unmatched.includes(canonical)) continue   // already matched or not needed

      // Find column index for this original header
      const colIdx = headers.findIndex(h => h === origHeader)
      if (colIdx === -1) continue

      matched.set(canonical, colIdx)
      // Remove from unmatched list
      const i = unmatched.indexOf(canonical)
      if (i !== -1) unmatched.splice(i, 1)

      const warn = `warn: mapped "${origHeader}" → ${canonical} via AI`
      process.stderr.write(warn + '\n')
      warnings.push(warn)
    }
  }

  // Step 3: report any remaining unmatched REQUIRED canonical fields
  // Optional fields (customer_raw, sub_solution_area, logical_product_id, target) may be absent
  const unmatchedRequired = unmatched.filter(f => REQUIRED_FIELDS.includes(f))
  if (unmatchedRequired.length > 0) {
    throw new UserError(
      `field mapping failed — no column found for: ${unmatchedRequired.join(', ')}\n` +
      `  Available headers: ${headers.join(', ')}`
    )
  }
  if (unmatched.length > 0) {
    const warn = `warn: optional canonical fields not mapped: ${unmatched.join(', ')}`
    warnings.push(warn)
  }

  // Build final canonical mapping: { canonical_field: columnIndex }
  const mapping = {}
  for (const [field, idx] of matched) {
    mapping[field] = idx
  }

  // Step 4: match remaining columns against METADATA_FIELDS
  // Track which column indices are already consumed by canonical fields
  const usedIndices = new Set(Object.values(mapping))
  const metadataMapping = {}

  for (const [metaField, aliases] of Object.entries(METADATA_FIELDS)) {
    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (usedIndices.has(i)) continue
      if (aliases.includes(normalizedHeaders[i])) {
        metadataMapping[metaField] = i
        usedIndices.add(i)
        break
      }
    }
  }

  // Step 5: remaining unmatched columns → extraMapping (keyed by original header name)
  const extraMapping = {}
  for (let i = 0; i < headers.length; i++) {
    if (!usedIndices.has(i)) {
      extraMapping[headers[i]] = i
    }
  }

  return { mapping, metadataMapping, extraMapping, warnings }
}

/**
 * Apply a field mapping to an array of raw CSV rows (arrays of strings).
 * Returns objects with: canonical fields at top level, metadata fields under `metadata`,
 * and extra (unknown) fields under `extra`.
 *
 * @param {string[][]} rows - data rows (NOT including header row)
 * @param {object} mapping - { canonical_field: columnIndex } (canonical fields only)
 * @param {object} [metadataMapping] - { metadata_field: columnIndex } (employee_id, customer_id, customer_name)
 * @param {object} [extraMapping] - { originalHeader: columnIndex } (unknown pass-through columns)
 * @returns {object[]} array of objects with canonical fields + metadata: {} + extra: {}
 */
// @contract input: rows string[][], mapping { canonical_field: columnIndex }, metadataMapping?, extraMapping? → output: object[] with canonical fields + metadata + extra
export function applyMapping(rows, mapping, metadataMapping = {}, extraMapping = {}) {
  return rows.map(row => {
    const obj = {}

    // Canonical fields at top level
    for (const [field, idx] of Object.entries(mapping)) {
      obj[field] = row[idx] ?? ''
    }

    // Metadata fields under `metadata` key
    const metadata = {}
    for (const [field, idx] of Object.entries(metadataMapping)) {
      metadata[field] = row[idx] ?? ''
    }
    obj.metadata = metadata

    // Extra (unknown) fields under `extra` key
    const extra = {}
    for (const [header, idx] of Object.entries(extraMapping)) {
      extra[header] = row[idx] ?? ''
    }
    obj.extra = extra

    return obj
  })
}

/**
 * Sentinel error for user-facing validation failures.
 * Caught by cli.js → exit 1.
 */
export class UserError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UserError'
    this.exitCode = 1
  }
}
