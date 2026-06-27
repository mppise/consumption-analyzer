// @story STORY-004 | transform
// @intent performs seven financial integrity checks on the computed portfolio object before it is written to disk — collects all failures and throws a single ProcessingError listing them all

// @contract input: products[], solutionAreas[], summary object → output: void (side-effect: stderr reconciliation line) | errors: throws ProcessingError on any check 1–6 failure

/**
 * Sentinel for processing failures — caught by cli.js → exit 2.
 */
export class ProcessingError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProcessingError'
    this.exitCode = 2
  }
}

/**
 * Round a floating-point number to a fixed number of decimal places.
 * @param {number} n
 * @param {number} decimals
 * @returns {number}
 */
function roundTo(n, decimals) {
  const factor = Math.pow(10, decimals)
  return Math.round(n * factor) / factor
}

/**
 * Integer-safe summation: multiply values by 100, sum as integers, divide.
 * Avoids floating-point drift on financial totals.
 * @param {number[]} values
 * @returns {number}
 */
function intSum(values) {
  return Math.round(values.reduce((s, v) => s + Math.round(v * 100), 0)) / 100
}

/**
 * Proportional tolerance for reconciliation checks.
 * Returns max(0.01, 0.001 * magnitude) to allow small rounding differences
 * that scale with the size of the numbers being compared.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function tolerance(a, b) {
  return Math.max(0.01, 0.001 * Math.max(Math.abs(a), Math.abs(b)))
}

/**
 * Format a number as a $ currency string for error messages.
 * @param {number} n
 * @returns {string}
 */
function fmtUSD(n) {
  if (!isFinite(n)) return String(n)
  return '$' + Math.round(n).toLocaleString('en-US')
}

/**
 * Flatten all products from the nested solution_areas hierarchy.
 * Works with both old flat products[] and new nested SA→SSA→products[] structure.
 *
 * @param {object[]} solutionAreas — array of SA objects with sub_solution_areas[].products[]
 * @returns {object[]} flat array of all product objects
 */
function flattenProductsFromHierarchy(solutionAreas) {
  const result = []
  for (const sa of solutionAreas ?? []) {
    for (const ssa of sa.sub_solution_areas ?? []) {
      for (const p of ssa.products ?? []) {
        result.push({ ...p, solution_area: sa.name, sub_solution_area: ssa.name })
      }
    }
  }
  return result
}

/**
 * Perform all seven reconciliation checks on a computed portfolio.
 *
 * Accepts either:
 *   reconcile(products, solutionAreas, summary)  — legacy flat products array
 *   reconcile(null, solutionAreas, summary)       — new nested hierarchy (products extracted from solutionAreas)
 *
 * Checks 1–6 collect failures; if any exist, throw ProcessingError.
 * Check 7 emits anomaly warnings to stderr (non-fatal).
 *
 * @param {object[]|null} productsArg   - flat products array (legacy) OR null to derive from solutionAreas
 * @param {object[]}      solutionAreas - portfolio.solution_areas array (new nested structure)
 * @param {object}        summary       - portfolio.summary object
 * @throws {ProcessingError} if any check 1–6 failures are found
 */
// @entry reconcile(products, solutionAreas, summary) | financial integrity gate before portfolio.json is written
export function reconcile(productsArg, solutionAreas, summary) {
  const failures = []

  // Derive flat products list from the nested hierarchy if not provided directly
  const products = (productsArg && productsArg.length > 0)
    ? productsArg
    : flattenProductsFromHierarchy(solutionAreas)

  // -----------------------------------------------------------------------
  // Check 1 — No NaN/null in financial fields
  // -----------------------------------------------------------------------
  for (const p of products) {
    const name = p.logical_product || p.name || p.logical_product_id || '(unknown)'

    for (const field of ['ytd_target', 'ytd_actuals', 'fy_target_total']) {
      if (field === 'fy_target_total') {
        const v = p.fy_target_total
        if (v !== undefined && v !== null && !isFinite(v)) {
          failures.push(`"${name}": fy_target_total is NaN`)
        }
        continue
      }
      if (!isFinite(p[field] ?? null)) {
        failures.push(`"${name}": ${field} is NaN`)
      }
    }

    for (const ms of p.monthly_series ?? []) {
      if (!isFinite(ms.target)) {
        failures.push(`"${name}" month ${ms.month}: target is NaN`)
      }
      if (!isFinite(ms.actual)) {
        failures.push(`"${name}" month ${ms.month}: actuals is NaN`)
      }
    }
  }

  // -----------------------------------------------------------------------
  // Check 2 — Monthly series sum matches YTD totals
  // Derive reporting month and fiscal year from the highest month with actual > 0.
  // YTD aggregates in metrics are scoped to the fiscal year, so we filter
  // monthly_series to the same year before summing for comparison.
  // -----------------------------------------------------------------------
  let reportingMonth = 0
  for (const p of products) {
    for (const ms of p.monthly_series ?? []) {
      const m = parseInt(String(ms.month), 10)
      if (ms.actual > 0 && m > reportingMonth) reportingMonth = m
    }
  }

  const fiscalYearPrefix = reportingMonth > 0 ? String(reportingMonth).slice(0, 4) : null
  const fyStart = fiscalYearPrefix ? parseInt(fiscalYearPrefix + '01', 10) : 0

  for (const p of products) {
    const name = p.logical_product || p.name || p.logical_product_id || '(unknown)'
    const pastSeries = (p.monthly_series ?? []).filter(ms => {
      const m = parseInt(String(ms.month), 10)
      if (fyStart > 0 && m < fyStart) return false
      return true
    })

    const sumTarget  = intSum(pastSeries.map(ms => ms.target))
    const sumActuals = intSum(pastSeries.map(ms => ms.actual))
    const tol2t = tolerance(sumTarget, p.ytd_target)
    const tol2a = tolerance(sumActuals, p.ytd_actuals)

    if (Math.abs(sumTarget - p.ytd_target) > tol2t) {
      failures.push(
        `"${name}": ytd_target ${fmtUSD(p.ytd_target)} ≠ sum of monthly targets ${fmtUSD(sumTarget)}`
      )
    }
    if (Math.abs(sumActuals - p.ytd_actuals) > tol2a) {
      failures.push(
        `"${name}": ytd_actuals ${fmtUSD(p.ytd_actuals)} ≠ sum of monthly actuals ${fmtUSD(sumActuals)}`
      )
    }
  }

  // -----------------------------------------------------------------------
  // Check 3 — Product rollup matches solution area totals
  // With the new nested hierarchy, products are inside sub_solution_areas.
  // We verify: sum of products in each SA = SA ytd_target/ytd_actuals.
  // -----------------------------------------------------------------------
  for (const sa of solutionAreas) {
    const saName = sa.name ?? sa
    // Collect all products from all sub_solution_areas within this SA
    const saProducts = flattenProductsFromHierarchy([sa])
    const sumTarget  = intSum(saProducts.map(p => p.ytd_target ?? 0))
    const sumActuals = intSum(saProducts.map(p => p.ytd_actuals ?? 0))
    const tol3t = tolerance(sumTarget, sa.ytd_target)
    const tol3a = tolerance(sumActuals, sa.ytd_actuals)

    if (Math.abs(sumTarget - sa.ytd_target) > tol3t) {
      failures.push(
        `Solution area "${saName}": ytd_target ${fmtUSD(sa.ytd_target)} ≠ sum of products ${fmtUSD(sumTarget)}`
      )
    }
    if (Math.abs(sumActuals - sa.ytd_actuals) > tol3a) {
      failures.push(
        `Solution area "${saName}": ytd_actuals ${fmtUSD(sa.ytd_actuals)} ≠ sum of products ${fmtUSD(sumActuals)}`
      )
    }
  }

  // -----------------------------------------------------------------------
  // Check 4 — Solution area rollup matches portfolio summary
  // -----------------------------------------------------------------------
  const totalSaTarget  = intSum(solutionAreas.map(sa => sa.ytd_target ?? 0))
  const totalSaActuals = intSum(solutionAreas.map(sa => sa.ytd_actuals ?? 0))
  const tol4t = tolerance(totalSaTarget, summary.total_ytd_target ?? 0)
  const tol4a = tolerance(totalSaActuals, summary.total_ytd_actuals ?? 0)

  if (Math.abs(totalSaTarget - (summary.total_ytd_target ?? 0)) > tol4t) {
    failures.push(
      `Portfolio summary: total_ytd_target ${fmtUSD(summary.total_ytd_target)} ≠ sum of solution areas ${fmtUSD(totalSaTarget)}`
    )
  }
  if (Math.abs(totalSaActuals - (summary.total_ytd_actuals ?? 0)) > tol4a) {
    failures.push(
      `Portfolio summary: total_ytd_actuals ${fmtUSD(summary.total_ytd_actuals)} ≠ sum of solution areas ${fmtUSD(totalSaActuals)}`
    )
  }

  // -----------------------------------------------------------------------
  // Check 5 — Attainment % cross-verification
  // -----------------------------------------------------------------------
  for (const p of products) {
    const name = p.logical_product || p.name || p.logical_product_id || '(unknown)'
    if ((p.ytd_target ?? 0) <= 0) continue

    const stored = p.ytd_attainment_pct ?? p.attainment_pct
    if (stored === null || stored === undefined) continue

    const recomputed = roundTo((p.ytd_actuals / p.ytd_target) * 100, 1)
    if (Math.abs(recomputed - stored) > 0.1) {
      failures.push(
        `"${name}": attainment_pct ${stored} ≠ recomputed ${recomputed}`
      )
    }
  }

  // -----------------------------------------------------------------------
  // Check 6 — Duplicate detection
  // With the new nested structure, products are identified by _composite_key
  // (still present in-memory; stripped before write). Falls back to
  // logical_product + sub_solution_area combination as the dedup key.
  // -----------------------------------------------------------------------
  const seenEntries = new Map()  // "product_key|month" → count
  for (const p of products) {
    const pid = p._composite_key || `${p.solution_area}|${p.sub_solution_area}|${p.logical_product || p.name}`
    for (const ms of p.monthly_series ?? []) {
      const key = `${pid}|${ms.month}`
      seenEntries.set(key, (seenEntries.get(key) ?? 0) + 1)
    }
  }
  for (const [key, count] of seenEntries) {
    if (count > 1) {
      const parts = key.split('|')
      const month = parts[parts.length - 1]
      const pid = parts.slice(0, -1).join('|')
      failures.push(`Duplicate: ${pid} month ${month} appears ${count} times`)
    }
  }

  // -----------------------------------------------------------------------
  // Check 7 — Anomaly warnings (non-fatal)
  // -----------------------------------------------------------------------
  for (const p of products) {
    const name = p.logical_product || p.name || p.logical_product_id || '(unknown)'
    for (const ms of p.monthly_series ?? []) {
      if ((ms.target ?? 0) > 0 && (ms.actual ?? 0) > 2 * ms.target) {
        process.stderr.write(
          `warn: "${name}" ${ms.month}: actuals (${fmtUSD(ms.actual)}) > 2× target (${fmtUSD(ms.target)}) — verify data\n`
        )
      }
    }
  }

  // -----------------------------------------------------------------------
  // Throw if any check 1–6 failures were collected
  // -----------------------------------------------------------------------
  if (failures.length > 0) {
    const lines = failures.map(f => `  · ${f}`).join('\n')
    throw new ProcessingError(
      `reconciliation failed — ${failures.length} error(s):\n${lines}`
    )
  }

  // -----------------------------------------------------------------------
  // Success
  // -----------------------------------------------------------------------
  const totalYtdActuals = summary.total_ytd_actuals ?? 0
  const nProducts = products.length
  process.stderr.write(
    `✓ reconciled: ${nProducts} products · ${fmtUSD(totalYtdActuals)} YTD actuals · 4 tiers verified\n`
  )
}
