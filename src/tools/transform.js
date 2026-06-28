// @story STORY-004 | transform
// @intent parse cACV CSV → field-map headers → group by customer/L1/L2/L3 → compute contract_month metrics → build portfolio.json with new schema (customers[].solutions_l1[].solutions_l2[].solutions_l3[]) and industry_insights[] stubs

import { createReadStream, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'
import { parse } from 'csv-parse'
import { mapFields } from '../lib/fieldMapper.js'
import { inferIndustry } from '../lib/industry.js'
import { config } from '../config/index.js'

// ─── Error types ─────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip BOM and trim whitespace.
 * @param {string|any} s
 * @returns {string}
 */
function stripBom(s) {
  return String(s ?? '').replace(/^﻿/, '').trim()
}

/**
 * Parse "AbbVie Inc (0016148849)" → { customer_name: "AbbVie Inc", customer_id: "0016148849" }
 * If no parens pattern: returns { customer_name: raw, customer_id: null }
 * @param {string} raw
 * @returns {{ customer_name: string, customer_id: string|null }}
 */
function parseCustomerRaw(raw) {
  if (!raw) return { customer_name: '', customer_id: null }
  const match = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (match) return { customer_name: match[1].trim(), customer_id: match[2].trim() }
  return { customer_name: raw.trim(), customer_id: null }
}

/**
 * Parse "SAP Analytics Cloud BI (LPR1064)" → { lpr_name: "SAP Analytics Cloud BI", lpr_id: "LPR1064" }
 * If no LPR-code pattern: returns { lpr_name: raw, lpr_id: raw }
 * @param {string} raw
 * @returns {{ lpr_name: string, lpr_id: string }}
 */
function parseProductRaw(raw) {
  if (!raw) return { lpr_name: '', lpr_id: '' }
  const match = raw.match(/^(.+?)\s*\(([A-Z]{1,}[0-9A-Z]+)\)\s*$/)
  if (match) return { lpr_name: match[1].trim(), lpr_id: match[2].trim() }
  return { lpr_name: raw.trim(), lpr_id: '' }
}

/**
 * Strip comma-formatting from a number string: "1,234.56" → 1234.56
 * @param {string|any} str
 * @returns {number}
 */
function parseNumber(str) {
  if (!str || String(str).trim() === '' || String(str).trim() === '-') return 0
  return parseFloat(String(str).replace(/,/g, '')) || 0
}

/**
 * Integer-safe summation: multiply by 100, sum as integers, divide by 100.
 * @param {number[]} values
 * @returns {number}
 */
function intSum(values) {
  return Math.round(values.reduce((s, v) => s + Math.round((v ?? 0) * 100), 0)) / 100
}

/**
 * Derive a YYYYMM integer month identifier string from a raw month field (already YYYYMM).
 * @param {string} monthStr - raw YYYYMM string from CSV
 * @returns {string} - 6-digit YYYYMM string
 */
function normalizeMonth(monthStr) {
  return String(monthStr ?? '').trim()
}

/**
 * Convert a YYYYMM string to a short month name.
 * e.g. "202601" → "Jan", "202606" → "Jun"
 * @param {string} yyyymm
 * @returns {string}
 */
function yyyymmToMonthName(yyyymm) {
  const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const mm = parseInt(String(yyyymm).slice(4, 6), 10)
  return MONTH_NAMES[mm - 1] ?? yyyymm
}

/**
 * Extract 4-digit year from YYYYMM string.
 * @param {string} yyyymm
 * @returns {string}
 */
function yyyymmToYear(yyyymm) {
  return String(yyyymm).slice(0, 4)
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

/**
 * Read and parse the cACV CSV file, mapping headers to canonical field names.
 * Implements: 2-row header skip, field mapper, customer/product parsing, actuals fallback.
 *
 * @param {string} filePath
 * @param {object|null} aiClient
 * @returns {Promise<Array<import('../lib/fieldMapper.js').CacvRecord>>}
 */
// @contract input: CSV file path string, aiClient? → output: cacv-json-record[] | errors: throws ProcessingError on parse failure
async function parseCsvFile(filePath, aiClient = null) {
  const rawRows = await new Promise((resolve, reject) => {
    const rows = []
    const parser = parse({
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
    })
    parser.on('readable', () => {
      let row
      while ((row = parser.read()) !== null) rows.push(row)
    })
    parser.on('error', err => reject(new ProcessingError(`CSV parse failure: ${err.message}`)))
    parser.on('end', () => resolve(rows))
    createReadStream(filePath)
      .on('error', err => reject(new ProcessingError(`Failed to read file: ${err.message}`)))
      .pipe(parser)
  })

  if (rawRows.length === 0) return []

  // Detect header row(s) — handles old (single header row) and new (2-row: MEASURES on row0, data headers on row1)
  const row0Cells = rawRows[0].map(c => stripBom(c).toUpperCase())
  const row1Cells = rawRows.length > 1 ? rawRows[1].map(c => stripBom(c).toUpperCase()) : []

  const HEADER_FIRST_CELL_KEYWORDS = ['MEASURES', 'SOLUTION_AREA', 'EMPLOYEE_ID', 'GLOBAL_ULTIMATE_ID']

  const isNewFormat =
    row0Cells.includes('MEASURES') &&
    (row1Cells[0]?.startsWith('LEADING END CUSTOMER') ?? false)

  let headerRow
  let dataStartIndex

  if (isNewFormat) {
    // New format: row0 = measure names, row1 = dimension headers + customer column
    // Merge: prefer row1 cell; fall back to row0 cell if row1 is blank
    headerRow = rawRows[1].map((cell, i) => {
      const stripped = stripBom(cell)
      if (stripped) return stripped
      return stripBom(rawRows[0][i]) || `col_${i}`
    })
    dataStartIndex = 2
  } else if (row0Cells[0] === 'MEASURES' && HEADER_FIRST_CELL_KEYWORDS.includes(row1Cells[0])) {
    headerRow = rawRows[1]
    dataStartIndex = 2
  } else if (HEADER_FIRST_CELL_KEYWORDS.includes(row0Cells[0])) {
    headerRow = rawRows[0]
    dataStartIndex = 1
  } else {
    headerRow = rawRows[0]
    dataStartIndex = 1
  }

  const dataRows = rawRows.slice(dataStartIndex)

  // Guard: no data rows after header skip → exit 2 (ProcessingError)
  if (dataRows.length === 0) {
    throw new ProcessingError('CSV contains no data rows after header skip')
  }

  // Extend header row to cover all data columns positionally
  const maxDataCols = dataRows.reduce((m, r) => Math.max(m, r.length), 0)
  if (headerRow.length < maxDataCols) {
    const extended = [...headerRow]
    const POSITIONAL_NAMES = ['cacv_bud', 'cacv_act', 'delta_cacv', 'budget_attainment_pct']
    for (let i = headerRow.length; i < maxDataCols; i++) {
      extended.push(POSITIONAL_NAMES[i - headerRow.length] ?? `col_${i}`)
    }
    headerRow = extended
  }

  const sampleRows = dataRows.slice(0, 3)

  let mapping, metadataMapping
  try {
    const result = await mapFields(headerRow, sampleRows, aiClient)
    mapping = result.mapping
    metadataMapping = result.metadataMapping ?? {}
  } catch (err) {
    if (err.name === 'UserError') throw err
    throw new ProcessingError(`Field mapping failed: ${err.message}`)
  }

  const records = []
  for (const row of dataRows) {
    const mapped = {}
    for (const [field, idx] of Object.entries(mapping)) {
      mapped[field] = row[idx] ?? ''
    }

    // ── Resolve customer identity ──────────────────────────────────────────
    let customer_id, customer_name
    if (mapping.customer_raw !== undefined) {
      const parsed = parseCustomerRaw(mapped.customer_raw)
      customer_name = parsed.customer_name
      customer_id = parsed.customer_id
    } else {
      customer_id = metadataMapping.customer_id !== undefined
        ? (row[metadataMapping.customer_id] ?? null)
        : null
      customer_name = metadataMapping.customer_name !== undefined
        ? (row[metadataMapping.customer_name] ?? '')
        : ''
    }

    // ── Resolve product identity ──────────────────────────────────────────
    let logical_product = stripBom(mapped.logical_product ?? '')
    let product_id = stripBom(mapped.logical_product_id ?? '')

    // If product_id is empty and logical_product contains "(LPRxxxx)" pattern — parse it
    if (!product_id && logical_product) {
      const parsed = parseProductRaw(logical_product)
      if (parsed.lpr_id) {
        logical_product = parsed.lpr_name
        product_id = parsed.lpr_id
      }
    }

    const month = normalizeMonth(mapped.month ?? '')
    if (!product_id || !month) continue  // skip rows without product or month

    // ── Parse numeric fields ───────────────────────────────────────────────
    let consumed_contract_value = parseNumber(mapped.actuals)
    const budget_contract_value = parseNumber(mapped.target)

    // ACV actuals: from acv_act metadata column if present
    const annual_contract_value = metadataMapping.acv_act !== undefined
      ? parseNumber(row[metadataMapping.acv_act] ?? '')
      : 0

    // delta_cacv for historical actuals fallback
    const delta_cacv = metadataMapping.delta_cacv !== undefined
      ? parseNumber(row[metadataMapping.delta_cacv] ?? '')
      : null

    // Historical actuals fallback: consumed=0 AND budget=0 AND delta_cacv>0 (FY2024/FY2025 rows)
    if (consumed_contract_value === 0 && budget_contract_value === 0 && delta_cacv !== null && delta_cacv > 0) {
      consumed_contract_value = delta_cacv
    }

    records.push({
      solution_area:         stripBom(mapped.solution_area ?? ''),
      sub_solution_area:     stripBom(mapped.sub_solution_area ?? ''),
      logical_product,
      product_id,
      month,
      budget_contract_value,
      consumed_contract_value,
      annual_contract_value,
      delta_cacv,
      customer_id,
      customer_name,
    })
  }

  return records
}

// ─── Variance computation ─────────────────────────────────────────────────────

/**
 * Compute variance fields for a single contract_month.
 * Uses integer-safe arithmetic per entity:contract_month rules.
 *
 * @param {number} annual_contract_value
 * @param {number} budget_contract_value
 * @param {number} consumed_contract_value
 * @returns {{ acv_gap: number, budget_gap: number, budget_attainment: number|null }}
 */
// @contract input: annual_contract_value, budget_contract_value, consumed_contract_value → output: variances object
function computeVariances(annual_contract_value, budget_contract_value, consumed_contract_value) {
  const acv_gap = Math.round((annual_contract_value - consumed_contract_value) * 100) / 100
  const budget_gap = Math.round((budget_contract_value - consumed_contract_value) * 100) / 100
  const budget_attainment = budget_contract_value > 0
    ? Math.round((consumed_contract_value / budget_contract_value) * 1000) / 10
    : null
  return { acv_gap, budget_gap, budget_attainment }
}

// ─── Hierarchy builder ────────────────────────────────────────────────────────

/**
 * Build the L1 → L2 → L3 → contract hierarchy for a single customer's records.
 *
 * Groups records by: solution_area (L1) → sub_solution_area (L2) → product_id (L3).
 * For each L3 product, builds a contract block with year-keyed arrays of contract_month records.
 *
 * @param {object[]} records - cacv-json-records for one customer, sorted by month ascending
 * @returns {object[]} solutions_l1[] conforming to contract:solutions-l1-shape
 */
// @contract input: cacv-json-record[] for one customer → output: solutions_l1[] with nested hierarchy and contract blocks
function buildL1Hierarchy(records) {
  // Group: l1Name → l2Name → productKey → { meta, monthMap }
  // productKey = `${product_id}|${sub_solution_area}` to handle same LPR in multiple L2s
  const l1Map = new Map()

  for (const rec of records) {
    const l1Key = rec.solution_area || '(Unknown L1)'
    const l2Key = rec.sub_solution_area || '(Unknown L2)'
    const prodKey = `${rec.product_id}|${l2Key}`

    if (!l1Map.has(l1Key)) l1Map.set(l1Key, new Map())
    const l2Map = l1Map.get(l1Key)

    if (!l2Map.has(l2Key)) l2Map.set(l2Key, new Map())
    const prodMap = l2Map.get(l2Key)

    if (!prodMap.has(prodKey)) {
      prodMap.set(prodKey, {
        lpr_id: rec.product_id,
        lpr_name: rec.logical_product || rec.product_id,
        months: new Map(), // yyyymm → { budget_contract_value, consumed_contract_value, annual_contract_value } (last write wins)
      })
    }
    const prod = prodMap.get(prodKey)

    // Update lpr_name if we find a non-empty value (some rows have the name, some don't)
    if (rec.logical_product && !prod.lpr_name) prod.lpr_name = rec.logical_product

    // Store month record (month is YYYYMM string)
    prod.months.set(rec.month, {
      budget_contract_value: rec.budget_contract_value,
      consumed_contract_value: rec.consumed_contract_value,
      annual_contract_value: rec.annual_contract_value,
    })
  }

  // Build output hierarchy
  const l1Array = []
  for (const [l1Name, l2Map] of l1Map) {
    const l2Array = []

    for (const [l2Name, prodMap] of l2Map) {
      const l3Array = []

      for (const [, prod] of prodMap) {
        // Build year-keyed contract block
        // Group months by year
        const yearMap = new Map()
        for (const [yyyymm, vals] of prod.months) {
          const year = yyyymmToYear(yyyymm)
          if (!yearMap.has(year)) yearMap.set(year, [])
          yearMap.get(year).push({ yyyymm, ...vals })
        }

        // Sort each year's months and build contract_month objects
        const contractBlock = {
          ai_insights: [],
        }
        for (const [year, monthEntries] of yearMap) {
          monthEntries.sort((a, b) => a.yyyymm.localeCompare(b.yyyymm))
          contractBlock[year] = monthEntries.map(entry => {
            const { yyyymm, budget_contract_value, consumed_contract_value, annual_contract_value } = entry
            return {
              month: yyyymmToMonthName(yyyymm),
              annual_contract_value,
              budget_contract_value,
              consumed_contract_value,
              variances: computeVariances(annual_contract_value, budget_contract_value, consumed_contract_value),
            }
          })
        }

        l3Array.push({
          lpr_id: prod.lpr_id,
          lpr_name: prod.lpr_name,
          solution_architecture_insights: [],
          contract: contractBlock,
        })
      }

      // Sort L3 by lpr_name for stable output
      l3Array.sort((a, b) => a.lpr_name.localeCompare(b.lpr_name))

      l2Array.push({
        name: l2Name,
        solutions_l3: l3Array,
      })
    }

    // Sort L2 by name
    l2Array.sort((a, b) => a.name.localeCompare(b.name))

    l1Array.push({
      name: l1Name,
      enterprise_architecture_insights: [],
      solutions_l2: l2Array,
    })
  }

  // Sort L1 by name
  l1Array.sort((a, b) => a.name.localeCompare(b.name))

  return l1Array
}

// ─── Reporting month detection ────────────────────────────────────────────────

/**
 * Find the latest month with any consumed_contract_value > 0.
 * Returns the YYYYMM string, or null if no actuals found.
 *
 * @param {object[]} records - all cacv-json-records
 * @returns {string|null}
 */
function detectReportingMonth(records) {
  let latest = null
  for (const rec of records) {
    if (rec.consumed_contract_value > 0) {
      if (!latest || rec.month > latest) latest = rec.month
    }
  }
  return latest
}

// ─── Industry insights stub builder ──────────────────────────────────────────

/**
 * Build industry_insights[] stubs for all distinct industries in the customer list.
 * Computes aggregated_contracts from all contract months for customers in that industry.
 *
 * @param {object[]} customers - built customer objects (new schema)
 * @returns {object[]} industry_insights[] conforming to contract:industry-insight-shape
 */
// @contract input: customers[] → output: industry_insights[] with aggregated_contracts | errors: none
function buildIndustryInsights(customers) {
  const industryMap = new Map() // industry → { acv, budget, consumed }

  for (const customer of customers) {
    const industry = customer.industry || 'Unknown'
    if (!industryMap.has(industry)) {
      industryMap.set(industry, { acv: 0, budget: 0, consumed: 0 })
    }
    const agg = industryMap.get(industry)

    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        for (const l3 of l2.solutions_l3 ?? []) {
          const contract = l3.contract ?? {}
          for (const key of Object.keys(contract)) {
            if (key === 'ai_insights') continue
            const months = contract[key]
            if (!Array.isArray(months)) continue
            for (const m of months) {
              agg.acv      += m.annual_contract_value     ?? 0
              agg.budget   += m.budget_contract_value     ?? 0
              agg.consumed += m.consumed_contract_value   ?? 0
            }
          }
        }
      }
    }
  }

  const result = []
  for (const [industry, agg] of industryMap) {
    result.push({
      industry,
      summary: [],
      aggregated_contracts: {
        annual_contract_value:   Math.round(agg.acv      * 100) / 100,
        budget_contract_value:   Math.round(agg.budget   * 100) / 100,
        consumed_contract_value: Math.round(agg.consumed * 100) / 100,
      },
    })
  }

  // Sort by industry name for stable output
  result.sort((a, b) => a.industry.localeCompare(b.industry))
  return result
}

// ─── Reconciliation (new schema) ─────────────────────────────────────────────

/**
 * Run reconciliation checks on the new portfolio schema.
 * Checks:
 *   1. No NaN/null/non-finite values in any contract_month
 *   2. No duplicate (lpr_id, month, year) entries within a customer
 *
 * Non-fatal warnings emitted via stderr; fatal issues throw ProcessingError.
 *
 * @param {object[]} customers - built customers array
 * @throws {ProcessingError} if fatal checks fail
 */
// @contract input: customers[] → output: void | errors: throws ProcessingError on fatal reconciliation failure
function reconcilePortfolio(customers) {
  const failures = []

  for (const customer of customers) {
    const customerName = customer.customer || customer.customer_id || '(unknown)'
    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        // Track (l2_name|lpr_id|year|month) for duplicate detection within this L2 group
        const seen = new Set()
        for (const l3 of l2.solutions_l3 ?? []) {
          const contract = l3.contract ?? {}
          for (const key of Object.keys(contract)) {
            if (key === 'ai_insights') continue
            const months = contract[key]
            if (!Array.isArray(months)) continue
            for (const m of months) {
              // Check 1: finite values
              for (const field of ['annual_contract_value', 'budget_contract_value', 'consumed_contract_value']) {
                if (!isFinite(m[field])) {
                  failures.push(`${customerName} / ${l2.name} / ${l3.lpr_id} / ${key}/${m.month}: ${field} is NaN/Infinity`)
                }
              }
              // Check 2: duplicates within the same L2+product+year+month
              const dupKey = `${l2.name}|${l3.lpr_id}|${key}|${m.month}`
              if (seen.has(dupKey)) {
                failures.push(`${customerName} / ${l2.name} / ${l3.lpr_id}: duplicate entry for year=${key} month=${m.month}`)
              }
              seen.add(dupKey)
            }
          }
        }
      }
    }
  }

  if (failures.length > 0) {
    const lines = failures.map(f => `  · ${f}`).join('\n')
    throw new ProcessingError(`reconciliation failed — ${failures.length} error(s):\n${lines}`)
  }

  // Count products for the success log
  let totalProducts = 0
  for (const customer of customers) {
    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        totalProducts += (l2.solutions_l3 ?? []).length
      }
    }
  }
  process.stderr.write(`info: reconciled ${totalProducts} L3 product(s) across ${customers.length} customer(s)\n`)
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Main entry point — dispatched from cli.js for --transform <file>.
 *
 * @param {string[]} args — args[0] is the CSV file path
 * @param {object} options — commander options; options.output = optional output path
 */
// @entry run(args, options) | --transform <file.csv> [--output <file.json>]
export async function run(args, options) {
  const csvPath = args[0]

  // ── Guard: argument presence ───────────────────────────────────────────────
  if (!csvPath) {
    throw new UserError('--transform requires a CSV file path argument')
  }

  // ── Guard: file existence ──────────────────────────────────────────────────
  if (!existsSync(csvPath)) {
    throw new UserError(`file not found: ${csvPath}`)
  }

  process.stderr.write(`info: computing metrics...\n`)

  // ── AI client for field-mapper fallback ────────────────────────────────────
  let aiClientForMapper = null
  if (config.aiApiKey && config.aiBaseUrl) {
    const { AIClient, MODELS } = await import('../lib/aiClient.js')
    aiClientForMapper = new AIClient({
      apiKey: config.aiApiKey,
      baseURL: config.aiBaseUrl,
      defaultModel: MODELS.haiku,
      defaultMaxTokens: 512,
    })
  }

  // ── Parse CSV ──────────────────────────────────────────────────────────────
  let allRecords
  try {
    allRecords = await parseCsvFile(csvPath, aiClientForMapper)
  } catch (err) {
    if (err instanceof ProcessingError || err.name === 'UserError') throw err
    throw new ProcessingError(`CSV parse failure: ${err.message}`)
  }

  if (allRecords.length === 0) {
    throw new ProcessingError('CSV contains no data rows after header — nothing to transform')
  }

  process.stderr.write(`info: parsed ${allRecords.length} data rows\n`)

  // ── Detect reporting month ─────────────────────────────────────────────────
  const reportingMonth = detectReportingMonth(allRecords)
  if (!reportingMonth) {
    process.stderr.write('warn: no months with consumed_contract_value > 0 detected\n')
  }

  // ── Determine fiscal year ──────────────────────────────────────────────────
  const fiscalYearStr = reportingMonth
    ? reportingMonth.slice(0, 4)
    : String(new Date().getFullYear())
  const fiscalYear = `FY${fiscalYearStr}`

  // ── Group records by customer ──────────────────────────────────────────────
  const hasCustomerMeta = allRecords.some(r => r.customer_id)
  const customerGroupMap = new Map()

  for (const rec of allRecords) {
    const key = rec.customer_id ? rec.customer_id : '__anonymous__'
    if (!customerGroupMap.has(key)) {
      customerGroupMap.set(key, {
        customer_id: rec.customer_id ?? null,
        customer_name: rec.customer_name || '',
        records: [],
      })
    }
    const cg = customerGroupMap.get(key)
    // Prefer first non-empty customer_name
    if (!cg.customer_name && rec.customer_name) cg.customer_name = rec.customer_name
    cg.records.push(rec)
  }

  // ── Build per-customer entries ─────────────────────────────────────────────
  const customers = []
  for (const [, cg] of customerGroupMap) {
    // Sort records by month ascending before building hierarchy
    cg.records.sort((a, b) => a.month.localeCompare(b.month))

    const solutions_l1 = buildL1Hierarchy(cg.records)

    // Collect all lpr_names for industry inference
    const productNames = []
    for (const l1 of solutions_l1) {
      for (const l2 of l1.solutions_l2 ?? []) {
        for (const l3 of l2.solutions_l3 ?? []) {
          if (l3.lpr_name) productNames.push(l3.lpr_name)
        }
      }
    }

    const industry = inferIndustry(cg.customer_name, productNames)

    customers.push({
      customer_id: cg.customer_id,
      customer: cg.customer_name || cg.customer_id || 'Unknown',
      industry,
      account_insights: [],
      solutions_l1,
    })
  }

  // ── Reconcile ──────────────────────────────────────────────────────────────
  try {
    reconcilePortfolio(customers)
  } catch (err) {
    if (err instanceof ProcessingError) throw err
    throw new ProcessingError(`Reconciliation error: ${err.message}`)
  }

  // ── Build industry_insights stubs ──────────────────────────────────────────
  const industry_insights = buildIndustryInsights(customers)

  // ── Assemble portfolio JSON ────────────────────────────────────────────────
  const portfolio = {
    generated_at: new Date().toISOString(),
    reporting_month: reportingMonth ?? null,
    fiscal_year: fiscalYear,
    customer_count: customers.length,
    industry_insights,
    customers,
  }

  // ── Determine output path ──────────────────────────────────────────────────
  let outputPath
  if (options && options.output) {
    outputPath = options.output
  } else {
    const csvBase = path.basename(csvPath, path.extname(csvPath))
    const dataDir = config.dataDir
    outputPath = path.join(dataDir, `${csvBase}-portfolio.json`)
  }

  // Ensure output directory exists
  const { mkdirSync } = await import('fs')
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })

  // ── Write portfolio JSON ───────────────────────────────────────────────────
  try {
    await writeFile(outputPath, JSON.stringify(portfolio, null, 2), 'utf8')
  } catch (err) {
    throw new ProcessingError(`Failed to write output file: ${err.message}`)
  }

  // ── Success ────────────────────────────────────────────────────────────────
  process.stdout.write(`${outputPath}\n`)
  process.stderr.write(`info: portfolio.json written — ${customers.length} customer(s), ${industry_insights.length} industry group(s)\n`)
}
