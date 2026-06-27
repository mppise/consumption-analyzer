// @story STORY-004 | transform
// @intent orchestrates --transform: parse cACV CSV → field-map headers → extract customer metadata → compute metrics per customer and portfolio rollup → classify risk → reconcile financials → write portfolio.json with nested customers[].solution_areas[].sub_solution_areas[].products[] hierarchy

import { createReadStream, existsSync } from 'fs'
import { writeFile } from 'fs/promises'
import path from 'path'
import { parse } from 'csv-parse'
import { computeProductMetrics, detectReportingMonth, intSum } from '../lib/metrics.js'
import { mapFields } from '../lib/fieldMapper.js'
import { reconcile } from '../lib/reconciler.js'
import { inferIndustry } from '../lib/industry.js'
import { config } from '../config/index.js'

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
 * Strip BOM character from a string and trim whitespace.
 * @param {string|any} s
 * @returns {string}
 */
function stripBom(s) {
  return String(s ?? '').replace(/^﻿/, '').trim()
}

/**
 * Parse "AbbVie Inc (0016148849)" → { customer_name: "AbbVie Inc", customer_id: "0016148849" }
 * If no parens pattern: returns { customer_name: raw, customer_id: '' }
 * @param {string} raw
 * @returns {{ customer_name: string, customer_id: string }}
 */
function parseCustomerRaw(raw) {
  if (!raw) return { customer_name: '', customer_id: '' }
  const match = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/)
  if (match) return { customer_name: match[1].trim(), customer_id: match[2].trim() }
  return { customer_name: raw.trim(), customer_id: '' }
}

/**
 * Parse "Cloud Platform Enterprise Agreement (LPR868)" → { name: "Cloud Platform...", id: "LPR868" }
 * Matches trailing "(LPRxxx)" or any uppercase+digit code patterns.
 * If no LPR-pattern: returns { name: raw, id: '' }
 * @param {string} raw
 * @returns {{ name: string, id: string }}
 */
function parseProductRaw(raw) {
  if (!raw) return { name: raw || '', id: '' }
  const match = raw.match(/^(.+?)\s*\(([A-Z]{1,}[0-9A-Z]+)\)\s*$/)
  if (match) return { name: match[1].trim(), id: match[2].trim() }
  return { name: raw.trim(), id: '' }
}

function parseNumber(str) {
  if (!str || str.trim() === '' || str.trim() === '-') return 0
  return parseFloat(String(str).replace(/,/g, '')) || 0
}

/**
 * Read and parse the cACV CSV file, using field mapper to normalize headers.
 *
 * @param {string} filePath
 * @param {object|null} aiClient - optional AIClient for AI-fallback header mapping
 * @returns {Promise<Array<object>>} array of cacv-json-records
 */
// @contract input: CSV file path string, aiClient? → output: cacv-json-record[] | errors: throws ProcessingError on parse failure, UserError on unmappable headers
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
    createReadStream(filePath).on('error', err => reject(new ProcessingError(`Failed to read file: ${err.message}`))).pipe(parser)
  })

  if (rawRows.length === 0) return []

  // Detect header row(s).
  const row0Cells = rawRows[0].map(c => stripBom(c).toUpperCase())
  const row1Cells = rawRows.length > 1 ? rawRows[1].map(c => stripBom(c).toUpperCase()) : []

  const HEADER_FIRST_CELL_KEYWORDS = ['MEASURES', 'SOLUTION_AREA', 'EMPLOYEE_ID', 'GLOBAL_ULTIMATE_ID']

  const isNewFormat =
    row0Cells.includes('MEASURES') &&
    (row1Cells[0]?.startsWith('LEADING END CUSTOMER') ?? false)

  let headerRow
  let dataStartIndex

  if (isNewFormat) {
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

    // --- Resolve customer identity ---
    let customer_id, customer_name

    if (mapping.customer_raw !== undefined) {
      const parsed = parseCustomerRaw(mapped.customer_raw)
      customer_name = parsed.customer_name
      customer_id = parsed.customer_id
    } else {
      customer_id = metadataMapping.customer_id !== undefined ? (row[metadataMapping.customer_id] ?? '') : ''
      customer_name = metadataMapping.customer_name !== undefined ? (row[metadataMapping.customer_name] ?? '') : ''
    }

    // --- Resolve product identity ---
    let logical_product = mapped.logical_product ?? ''
    let product_id = mapped.logical_product_id ?? ''

    if (!product_id && logical_product) {
      const parsed = parseProductRaw(logical_product)
      if (parsed.id) {
        logical_product = parsed.name
        product_id = parsed.id
      }
    }

    const month = mapped.month ?? ''

    if (!product_id || !month) continue

    // --- Resolve actuals ---
    let cacv_actual = parseNumber(mapped.actuals)
    const cacv_target = parseNumber(mapped.target)

    const acv_act = metadataMapping.acv_act !== undefined
      ? parseNumber(row[metadataMapping.acv_act] ?? '')
      : 0

    // Historical actuals fallback: cacv_act=0 AND cacv_target=0 AND delta_cacv>0 (FY2024/FY2025 rows)
    if (cacv_actual === 0 && cacv_target === 0 && metadataMapping.delta_cacv !== undefined) {
      const deltaRaw = row[metadataMapping.delta_cacv] ?? ''
      const deltaVal = parseNumber(deltaRaw)
      if (deltaVal > 0) {
        cacv_actual = deltaVal
      }
    }

    records.push({
      solution_area:     mapped.solution_area ?? '',
      sub_solution_area: mapped.sub_solution_area ?? '',
      logical_product,
      product_id,
      month,
      cacv_target,
      cacv_actual,
      acv_act,
      customer_id,
      customer_name,
    })
  }

  return records
}

/**
 * Build the nested solution_areas → sub_solution_areas → products hierarchy.
 * Products are full product objects conforming to contract:product-in-subsa-shape.
 * _composite_key is retained in-memory for reconciler Check 6; stripped before write.
 *
 * @param {Array<object>} productObjects — fully computed product objects with solution_area + sub_solution_area
 * @returns {Array<object>} solution_areas hierarchy
 */
// @contract input: computed product objects[] → output: solution_area[] with nested sub_solution_areas[].products[]
function buildSolutionAreasHierarchy(productObjects) {
  const saMap = new Map()

  for (const p of productObjects) {
    const saKey = p.solution_area
    if (!saMap.has(saKey)) saMap.set(saKey, new Map())
    const ssaMap = saMap.get(saKey)
    if (!ssaMap.has(p.sub_solution_area)) ssaMap.set(p.sub_solution_area, [])
    ssaMap.get(p.sub_solution_area).push(p)
  }

  const result = []
  for (const [saName, ssaMap] of saMap) {
    const subAreas = []
    let saTotalTarget = 0
    let saTotalActuals = 0

    for (const [ssaName, ssaProducts] of ssaMap) {
      const ssaTotalTarget = intSum(ssaProducts.map(p => p.ytd_target))
      const ssaTotalActuals = intSum(ssaProducts.map(p => p.ytd_actuals))
      const ssaAttPct = ssaTotalTarget > 0
        ? Math.round((ssaTotalActuals / ssaTotalTarget) * 1000) / 10
        : null

      // Products stored here conform to product-in-subsa-shape
      // _composite_key retained in-memory for reconciler; stripped before JSON write
      subAreas.push({
        name: ssaName,
        ytd_target: ssaTotalTarget,
        ytd_actuals: ssaTotalActuals,
        attainment_pct: ssaAttPct,
        products: ssaProducts,
      })

      saTotalTarget += ssaTotalTarget
      saTotalActuals += ssaTotalActuals
    }

    const saAttPct = saTotalTarget > 0
      ? Math.round((saTotalActuals / saTotalTarget) * 1000) / 10
      : null

    result.push({
      name: saName,
      ytd_target: saTotalTarget,
      ytd_actuals: saTotalActuals,
      attainment_pct: saAttPct,
      sub_solution_areas: subAreas,
    })
  }

  return result
}

/**
 * Strip _composite_key from all product objects in the nested hierarchy before writing to disk.
 * The key must remain in-memory for reconciler Check 6 but must not appear in the output file.
 *
 * @param {Array<object>} solutionAreas
 * @returns {Array<object>} deep copy with _composite_key removed from all products
 */
function stripCompositeKeys(solutionAreas) {
  return solutionAreas.map(sa => ({
    ...sa,
    sub_solution_areas: (sa.sub_solution_areas ?? []).map(ssa => ({
      ...ssa,
      products: (ssa.products ?? []).map(p => {
        const { _composite_key, solution_area, sub_solution_area, risk_level, risk_reason, customer_name, customer_id, ...rest } = p
        return rest
      }),
    })),
  }))
}

/**
 * Build portfolio from records: compute metrics, classify risk, build hierarchy.
 *
 * @param {object[]} records
 * @param {number} reportingMonth
 * @param {string} fiscalYear
 * @param {number} monthsRemaining
 * @returns {{ solutionAreas: object[], summary: object, productObjects: object[] }}
 */
// @contract input: cacv-json-record[], reportingMonth YYYYMM, fiscalYear string, monthsRemaining int → output: {solutionAreas, summary, productObjects}
function buildPortfolioFromRecords(records, reportingMonth, fiscalYear, monthsRemaining) {
  // Group records by composite key: customer|solution_area|sub_solution_area|product_id
  const productMap = new Map()
  const productMeta = new Map()

  for (const rec of records) {
    const customerKey = rec.customer_id || rec.customer_name || '__anon__'
    const key = `${customerKey}|${rec.solution_area}|${rec.sub_solution_area}|${rec.product_id}`
    if (!productMap.has(key)) {
      productMap.set(key, [])
      productMeta.set(key, {
        solution_area: rec.solution_area,
        sub_solution_area: rec.sub_solution_area,
        logical_product: rec.logical_product,
        product_id: rec.product_id,
        customer_id: rec.customer_id,
        customer_name: rec.customer_name,
      })
    }
    productMap.get(key).push(rec)
  }

  // Sort each product's records by month ascending
  for (const [, recs] of productMap) {
    recs.sort((a, b) => a.month.localeCompare(b.month))
  }

  // Compute metrics and build product objects conforming to product-in-subsa-shape
  const productObjects = []
  for (const [key, productRecs] of productMap) {
    const meta = productMeta.get(key)
    const metrics = computeProductMetrics(meta.product_id || key, productRecs, reportingMonth, fiscalYear)

    // Build product-in-subsa-shape with _composite_key in-memory (stripped before write)
    productObjects.push({
      // Internal fields (stripped before JSON write)
      _composite_key: key,
      solution_area: meta.solution_area,
      sub_solution_area: meta.sub_solution_area,
      customer_name: meta.customer_name,
      customer_id: meta.customer_id,
      // product-in-subsa-shape fields
      lpr: meta.product_id,
      name: meta.logical_product,
      ytd_target: metrics.ytdTarget,
      ytd_actuals: metrics.ytdActuals,
      ytd_attainment_pct: metrics.ytdAttainmentPct,
      ytd_acv_act: metrics.ytdAcvAct,
      contract_utilization_pct: metrics.contractUtilizationPct,
      monthly_series: metrics.monthlySeries,
      trend_direction: metrics.trendDirection,
      insight: null,
      recommendation: null,
      ea_action: null,
    })
  }

  // Build nested hierarchy
  const solutionAreas = buildSolutionAreasHierarchy(productObjects)

  // Build summary: only total_ytd_target, total_ytd_actuals, overall_attainment_pct
  const totalYtdTarget = intSum(productObjects.map(p => p.ytd_target))
  const totalYtdActuals = intSum(productObjects.map(p => p.ytd_actuals))
  const overallAttainmentPct = totalYtdTarget > 0
    ? Math.round((totalYtdActuals / totalYtdTarget) * 1000) / 10
    : null

  const summary = {
    total_ytd_target: totalYtdTarget,
    total_ytd_actuals: totalYtdActuals,
    overall_attainment_pct: overallAttainmentPct,
  }

  return { solutionAreas, summary, productObjects }
}

/**
 * Main entry point — dispatched from cli.js for --transform <file>.
 *
 * @param {string[]} args — args[0] is the CSV file path
 * @param {object} options — commander options; options.output = optional output path
 */
// @entry run(args, options) | --transform <file.csv> [--output <file.json>]
export async function run(args, options) {
  const csvPath = args[0]

  if (!csvPath) {
    throw new UserError('--transform requires a CSV file path argument')
  }

  if (!existsSync(csvPath)) {
    throw new UserError(`file not found: ${csvPath}`)
  }

  process.stderr.write(`info: computing metrics...\n`)

  // Build AI client for field mapper fallback if API key is set
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

  // ---- Parse CSV (with field mapper) ----
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

  process.stderr.write(`warn: parsed ${allRecords.length} data rows\n`)

  // ---- Detect reporting month ----
  const reportingMonth = detectReportingMonth(allRecords)
  if (reportingMonth === 0) {
    process.stderr.write('warn: no months with actuals > 0 detected — all products will be NO_DATA\n')
  }

  // ---- Determine fiscal year and months remaining ----
  const reportingMonthStr = reportingMonth > 0 ? String(reportingMonth) : String(new Date().getFullYear()) + '01'
  const fiscalYear = reportingMonthStr.slice(0, 4)
  const currentMonthIndex = reportingMonth > 0 ? parseInt(reportingMonthStr.slice(4, 6), 10) : 0
  const monthsRemaining = Math.max(0, 12 - currentMonthIndex)

  // ---- Detect distinct customers ----
  const hasCustomerMeta = allRecords.some(r => r.customer_id)
  const customerGroupMap = new Map()

  for (const rec of allRecords) {
    let key
    if (rec.customer_id) {
      key = rec.customer_id
    } else {
      key = '__anonymous__'
    }

    if (!customerGroupMap.has(key)) {
      customerGroupMap.set(key, {
        customer_id: rec.customer_id || '',
        customer_name: rec.customer_name || '',
        records: [],
      })
    }
    const cg = customerGroupMap.get(key)
    if (!cg.customer_name && rec.customer_name) cg.customer_name = rec.customer_name
    cg.records.push(rec)
  }

  // ---- Build per-customer data ----
  const customers = []
  for (const [, cg] of customerGroupMap) {
    const { solutionAreas, summary, productObjects } = buildPortfolioFromRecords(
      cg.records, reportingMonth, fiscalYear, monthsRemaining
    )

    // Per-customer reconciliation (uses in-memory productObjects with _composite_key)
    try {
      reconcile(productObjects, solutionAreas, summary)
    } catch (err) {
      if (err.name === 'ProcessingError') throw err
      throw new ProcessingError(`Reconciliation error (customer ${cg.customer_name || cg.customer_id}): ${err.message}`)
    }

    // Infer industry from customer name + product names
    const productNames = productObjects.map(p => p.name)
    const industry = inferIndustry(cg.customer_name, productNames)

    // Strip _composite_key (and internal fields) from products before output
    const cleanSolutionAreas = stripCompositeKeys(solutionAreas)

    customers.push({
      customer_id: cg.customer_id,
      customer_name: cg.customer_name,
      industry,
      summary,
      solution_areas: cleanSolutionAreas,
    })
  }

  // ---- Build portfolio-level rollup across all customers ----
  const { solutionAreas: allSolutionAreas, summary: portfolioSummary, productObjects: allProductObjects } =
    buildPortfolioFromRecords(allRecords, reportingMonth, fiscalYear, monthsRemaining)

  // Portfolio-level reconciliation
  try {
    reconcile(allProductObjects, allSolutionAreas, portfolioSummary)
  } catch (err) {
    if (err.name === 'ProcessingError') throw err
    throw new ProcessingError(`Reconciliation error: ${err.message}`)
  }

  // Infer portfolio-level industry (using all customers — first non-Unknown wins, else Unknown)
  let portfolioIndustry = 'Unknown'
  for (const c of customers) {
    if (c.industry && c.industry !== 'Unknown') {
      portfolioIndustry = c.industry
      break
    }
  }

  // ---- Assemble portfolio JSON ----
  const currentDate = new Date()
  // Spec: reporting_month is YYYYMM (6-digit string, no dash)
  const reportingMonthFormatted = reportingMonth > 0 ? String(reportingMonth) : null

  const portfolio = {
    generated_at: currentDate.toISOString(),
    reporting_month: reportingMonthFormatted,
    fiscal_year: `FY${fiscalYear}`,
    customer_count: customers.length,
    industry: portfolioIndustry,
    customers,
    summary: portfolioSummary,
    ai_insights: null,
  }

  // ---- Determine output path ----
  let outputPath
  if (options.output) {
    outputPath = options.output
  } else {
    const csvDir = path.dirname(csvPath)
    const csvBase = path.basename(csvPath, path.extname(csvPath))
    outputPath = path.join(csvDir, `${csvBase}-portfolio.json`)
  }

  // Ensure output directory exists
  const { mkdirSync } = await import('fs')
  mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true })

  // ---- Write portfolio JSON ----
  try {
    await writeFile(outputPath, JSON.stringify(portfolio, null, 2), 'utf8')
  } catch (err) {
    throw new ProcessingError(`Failed to write output file: ${err.message}`)
  }

  // ---- Success: print output path to stdout ----
  process.stdout.write(`${outputPath}\n`)
  const totalProducts = allProductObjects.length
  process.stderr.write(`warn: portfolio.json written — ${totalProducts} products, ${customers.length} customer(s)\n`)
}
