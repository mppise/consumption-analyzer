// @story STORY-004 | transform
// @intent computes all per-product cACV metrics (YTD totals, attainment, trend, run-rate, forecasts, monthly series) from grouped cacv-json-records — pure functions, no I/O

/**
 * Integer-safe summation: multiply each value by 100, sum as integers, divide by 100.
 * Prevents floating-point drift on financial totals (e.g. 1234.56 + 789.01).
 * @param {number[]} values
 * @returns {number}
 */
export function intSum(values) {
  return Math.round(values.reduce((s, v) => s + Math.round((v ?? 0) * 100), 0)) / 100
}

/**
 * Determine the current YYYYMM integer from today's date.
 * @returns {number} e.g. 202606
 */
export function currentYYYYMM() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return parseInt(`${y}${m}`, 10)
}

/**
 * Given all records across all products, find the last month where any product has actuals > 0.
 * This is the "reporting month" — the last month with real actuals data.
 * @param {Array<{month: string, cacv_actual: number}>} allRecords
 * @returns {number} YYYYMM integer
 */
export function detectReportingMonth(allRecords) {
  let lastActualsMonth = 0
  for (const rec of allRecords) {
    const m = parseInt(rec.month, 10)
    if (rec.cacv_actual > 0 && m > lastActualsMonth) {
      lastActualsMonth = m
    }
  }
  return lastActualsMonth
}

/**
 * Format YYYYMM integer as "YYYY-MM" string.
 * @param {number} yyyymm
 * @returns {string}
 */
export function formatYYYYMM(yyyymm) {
  const s = String(yyyymm)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}`
}

/**
 * Compute a population standard deviation.
 * @param {number[]} values
 * @returns {number}
 */
function stddev(values) {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

/**
 * Advance a YYYYMM integer by n months, handling year rollover.
 * e.g. addMonths(202612, 1) = 202701
 * @param {number} yyyymm
 * @param {number} n
 * @returns {number}
 */
function addMonths(yyyymm, n) {
  const s = String(yyyymm)
  let year = parseInt(s.slice(0, 4), 10)
  let month = parseInt(s.slice(4, 6), 10)
  month += n
  while (month > 12) { month -= 12; year++ }
  while (month < 1)  { month += 12; year-- }
  return parseInt(`${year}${String(month).padStart(2, '0')}`, 10)
}

/**
 * Compute forward-looking forecast fields for a product.
 *
 * @param {Array<{month: string, cacv_target: number, cacv_actual: number}>} pastRecords — months <= reportingMonth
 * @param {number} reportingMonth — YYYYMM integer
 * @param {number} fyTargetTotal — sum of all monthly targets across full FY
 * @param {string} trendDirection — result of computeTrend()
 * @param {number} ytdActuals — sum of actuals so far
 * @param {number|null} fyForecast — pre-computed FY run-rate forecast
 * @param {Array<{month: string, cacv_target: number}>} allRecords — full record set (for next-quarter target lookup)
 * @returns {object} forecast fields
 */
// @contract input: pastRecords[], reportingMonth YYYYMM, fyTargetTotal number, trendDirection string, ytdActuals number, fyForecast number|null, allRecords[] → output: forecast-shape object
export function computeForecasts(pastRecords, reportingMonth, fyTargetTotal, trendDirection, ytdActuals, fyForecast, allRecords) {
  const pastMonthsCount = pastRecords.length

  // ---- Next quarter months ----
  const nq1 = addMonths(reportingMonth, 1)
  const nq2 = addMonths(reportingMonth, 2)
  const nq3 = addMonths(reportingMonth, 3)
  const next_quarter_months = [nq1, nq2, nq3]

  // ---- Next quarter target: look up from allRecords ----
  const targetByMonth = new Map(allRecords.map(r => [parseInt(r.month, 10), r.cacv_target]))
  const next_quarter_target = (targetByMonth.get(nq1) ?? 0)
    + (targetByMonth.get(nq2) ?? 0)
    + (targetByMonth.get(nq3) ?? 0)

  // ---- Next quarter forecast: run-rate per month × 3 ----
  const monthlyRunRate = pastMonthsCount > 0 ? ytdActuals / pastMonthsCount : null
  const next_quarter_forecast = monthlyRunRate !== null
    ? Math.round(monthlyRunRate * 3 * 100) / 100
    : null

  const next_quarter_attainment_pct = (next_quarter_forecast !== null && next_quarter_target > 0)
    ? Math.round((next_quarter_forecast / next_quarter_target) * 1000) / 10
    : null

  // ---- Year-end ----
  const year_end_forecast = fyForecast
  const year_end_target = fyTargetTotal
  const year_end_attainment_pct = (year_end_forecast !== null && year_end_target > 0)
    ? Math.round((year_end_forecast / year_end_target) * 1000) / 10
    : null

  // ---- Confidence ----
  const pastAttainments = pastRecords
    .map(r => r.cacv_target > 0 ? (r.cacv_actual / r.cacv_target) * 100 : null)
    .filter(v => v !== null)

  let forecast_confidence
  let forecast_confidence_reason

  if (pastAttainments.length < 2) {
    forecast_confidence = 'Insufficient Data'
    forecast_confidence_reason = `Only ${pastAttainments.length} month${pastAttainments.length === 1 ? '' : 's'} of data available`
  } else {
    const n = pastAttainments.length
    const mean = pastAttainments.reduce((a, b) => a + b, 0) / n
    const cv = mean > 0 ? (stddev(pastAttainments) / mean) * 100 : 0
    const minPct = Math.round(Math.min(...pastAttainments))
    const maxPct = Math.round(Math.max(...pastAttainments))

    if (cv < 10) {
      forecast_confidence = 'High'
      forecast_confidence_reason = `Consistent attainment over ${n} months (${minPct}%–${maxPct}%)`
    } else if (cv <= 25) {
      forecast_confidence = 'Medium'
      forecast_confidence_reason = `Moderate variance over ${n} months — some month-to-month fluctuation`
    } else {
      forecast_confidence = 'Low'
      forecast_confidence_reason = `High variance over ${n} months — consumption pattern is unpredictable`
    }

    // Downgrade by one level if trend is 'down' and CV < 25
    if (trendDirection === 'down' && cv < 25) {
      if (forecast_confidence === 'High') {
        forecast_confidence = 'Medium'
        forecast_confidence_reason += ' (downward trend)'
      } else if (forecast_confidence === 'Medium') {
        forecast_confidence = 'Low'
        forecast_confidence_reason += ' (downward trend)'
      }
    }
  }

  return {
    next_quarter_months,
    next_quarter_target,
    next_quarter_forecast,
    next_quarter_attainment_pct,
    year_end_forecast,
    year_end_target,
    year_end_attainment_pct,
    forecast_confidence,
    forecast_confidence_reason,
  }
}

/**
 * Compute trend direction from the attainment values of the last ≤ 3 past months.
 * "up"    — each value >= previous
 * "down"  — each value <= previous
 * "flat"  — all equal
 * "volatile" — neither consistently up nor down
 * "insufficient_data" — fewer than 2 past months
 *
 * @param {number[]} lastThreeAttainments — up to 3 attainment_pct values in chronological order (most recent last)
 * @returns {string}
 */
export function computeTrend(lastThreeAttainments) {
  const vals = lastThreeAttainments.filter(v => v !== null && v !== undefined)
  if (vals.length < 2) return 'insufficient_data'
  let up = true
  let down = true
  let flat = true
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] < vals[i - 1]) up = false
    if (vals[i] > vals[i - 1]) down = false
    if (vals[i] !== vals[i - 1]) flat = false
  }
  if (flat) return 'flat'
  if (up) return 'up'
  if (down) return 'down'
  return 'volatile'
}

/**
 * Compute all metrics for a single product.
 *
 * @param {string} productId
 * @param {Array<{month: string, cacv_target: number, cacv_actual: number}>} records — all months, sorted ascending
 * @param {number} reportingMonth — last month with actuals (YYYYMM integer)
 * @param {string} [fiscalYear] — 4-digit year string (e.g. '2026'). When provided, YTD aggregates
 *   are scoped to months within this year only, preventing cross-year inflation.
 * @returns {object} — full product metrics object
 */
// @contract input: productId string, records cacv-json-record[], reportingMonth YYYYMM int, fiscalYear string → output: product-metrics-shape | errors: none (always returns object)
export function computeProductMetrics(productId, records, reportingMonth, fiscalYear) {
  // Separate past months (month <= reportingMonth) from future months (month > reportingMonth)
  const fyStart = fiscalYear ? parseInt(fiscalYear + '01', 10) : 0
  const pastRecords = records.filter(r => {
    const m = parseInt(r.month, 10)
    return m <= reportingMonth && (!fiscalYear || m >= fyStart)
  })
  const futureRecords = records.filter(r => parseInt(r.month, 10) > reportingMonth)

  // ---- YTD aggregates (current fiscal year only) ----
  // Use integer-safe summation to prevent floating-point drift on financial totals.
  const ytdTarget = intSum(pastRecords.map(r => r.cacv_target))
  const ytdActuals = intSum(pastRecords.map(r => r.cacv_actual))
  const ytdAttainmentPct = ytdTarget > 0
    ? Math.round((ytdActuals / ytdTarget) * 1000) / 10
    : null

  const gap = ytdActuals - ytdTarget

  // ---- Monthly series — past months only, minimal fields ----
  // Future months have zero actuals by definition (reporting_month is the cutoff).
  // acv_act/attainment_pct/gap are computable from target+actual — strip to save tokens.
  const monthlySeries = records
    .filter(r => parseInt(r.month, 10) <= reportingMonth)  // past months only
    .map(r => ({
      month: r.month,
      target: r.cacv_target,
      actual: r.cacv_actual,
    }))

  // ---- Trend (last 3 past months) ----
  const pastAttainments = pastRecords.map(r =>
    r.cacv_target > 0 ? (r.cacv_actual / r.cacv_target) * 100 : null
  )
  const lastThreeAttainments = pastAttainments.filter(v => v !== null).slice(-3)
  const trendDirection = computeTrend(lastThreeAttainments)

  // ---- Run rate ----
  const pastMonthsCount = pastRecords.length
  const runRateProjection = pastMonthsCount > 0
    ? Math.round((ytdActuals / pastMonthsCount) * 12 * 100) / 100
    : null

  // ---- FY totals (current fiscal year only) ----
  const fyRecords = fiscalYear
    ? records.filter(r => r.month.startsWith(fiscalYear))
    : records
  const fyTargetTotal = intSum(fyRecords.map(r => r.cacv_target))

  // ---- FY forecast (remaining months in current FY) ----
  const remainingMonths = fyRecords.length - pastMonthsCount
  const fyForecast = pastMonthsCount > 0
    ? Math.round(((ytdActuals / pastMonthsCount) * Math.max(0, remainingMonths) + ytdActuals) * 100) / 100
    : null

  // ---- Contract utilization: cACV_ACT / ACV_ACT ----
  // ACV_ACT = total contracted ACV (contract value, not a consumption target)
  // This measures what fraction of the contract value is being consumed YTD.
  // A low value (e.g. 4%) signals renewal risk even when budget attainment looks OK.
  // Guard: ytd_acv_act < 1 → null (prevents division by near-zero producing spurious huge %)
  const ytdAcvAct = intSum(pastRecords.map(r => r.acv_act ?? 0))
  const contractUtilizationPct = ytdAcvAct >= 1
    ? Math.round((ytdActuals / ytdAcvAct) * 1000) / 10
    : null

  // ---- Forecasts (next quarter + year-end + confidence) ----
  const forecasts = computeForecasts(pastRecords, reportingMonth, fyTargetTotal, trendDirection, ytdActuals, fyForecast, fyRecords)

  return {
    ytdTarget,
    ytdActuals,
    ytdAttainmentPct,
    contractUtilizationPct,
    ytdAcvAct,
    gap,
    monthlySeries,
    trendDirection,
    runRateProjection,
    fyTargetTotal,
    fyForecast,
    pastMonthsCount,
    pastRecords,
    ...forecasts,
  }
}
