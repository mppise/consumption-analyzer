// @story STORY-004 | transform
// @intent single authoritative implementation of the 9 risk classification business rules — first match wins; no other file may define risk thresholds

/**
 * Risk level constants.
 */
export const RISK = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  ON_TRACK: 'ON_TRACK',
  NO_DATA: 'NO_DATA',
}

/**
 * Evaluate the 9 risk rules in priority order (first match wins) for a single product.
 *
 * @param {object} metrics — output of computeProductMetrics()
 * @returns {{ risk_level: string, risk_reason: string }}
 */
// @contract input: product metrics object from metrics.js → output: {risk_level, risk_reason} | errors: always returns at least NO_DATA
export function classifyRisk(metrics) {
  const {
    ytdTarget,
    ytdActuals,
    ytdAttainmentPct,
    contractUtilizationPct,
    pastMonthsCount,
    pastRecords,
    trendDirection,
  } = metrics

  // Rule 9 (pre-check) — NoData: target=0 for all months OR no reported months yet
  if (pastMonthsCount === 0 || ytdTarget === 0) {
    return { risk_level: RISK.NO_DATA, risk_reason: 'No past months or zero YTD target' }
  }

  // Rule 0 — CRITICAL: contract utilization extremely low (consumed < 15% of contracted ACV)
  // This catches products where budget attainment looks fine but contract value is barely used.
  // e.g. SAP Commerce Cloud at Cardinal: 8% budget att AND 4% contract utilization = renewal cliff.
  if (contractUtilizationPct !== null && contractUtilizationPct < 15 && pastMonthsCount >= 3) {
    return {
      risk_level: RISK.CRITICAL,
      risk_reason: `Contract utilization ${contractUtilizationPct.toFixed(1)}% — consumed cACV is only ${contractUtilizationPct.toFixed(1)}% of contracted ACV after ${pastMonthsCount} months`,
    }
  }

  // Build per-past-month attainment series for rule evaluation
  const pastAttainments = pastRecords.map(r =>
    r.cacv_target > 0 ? (r.cacv_actual / r.cacv_target) * 100 : null
  )

  // Helper: find attainment for past record at index i (null when target=0)
  const attAt = i => pastAttainments[i]

  // Rule 1 — CRITICAL: any past month has actuals=0 AND target>0 AND it's not the first reported month
  // (Spec says: not the product's first reported month)
  for (let i = 1; i < pastRecords.length; i++) {
    const r = pastRecords[i]
    if (r.cacv_actual === 0 && r.cacv_target > 0) {
      return {
        risk_level: RISK.CRITICAL,
        risk_reason: `Zero actuals with target > 0 in month ${r.month} (not the first reported month)`,
      }
    }
  }

  // Rule 2 — CRITICAL: 2+ consecutive past months with attainment < 50%
  for (let i = 0; i < pastRecords.length - 1; i++) {
    const a1 = attAt(i)
    const a2 = attAt(i + 1)
    if (a1 !== null && a2 !== null && a1 < 50 && a2 < 50) {
      return {
        risk_level: RISK.CRITICAL,
        risk_reason: `2+ consecutive months with attainment < 50% (months ${pastRecords[i].month} and ${pastRecords[i + 1].month})`,
      }
    }
  }

  // Latest past month attainment
  const latestAtt = pastAttainments[pastAttainments.length - 1]

  // Rule 3 — HIGH: latest past month attainment 50–74% AND trend="down"
  if (latestAtt !== null && latestAtt >= 50 && latestAtt < 75 && trendDirection === 'down') {
    return {
      risk_level: RISK.HIGH,
      risk_reason: `Latest month attainment ${latestAtt.toFixed(1)}% (50–74%) with downward trend`,
    }
  }

  // Rule 4 — HIGH: ytd attainment < 70% AND past_months_count >= 3
  if (ytdAttainmentPct !== null && ytdAttainmentPct < 70 && pastMonthsCount >= 3) {
    return {
      risk_level: RISK.HIGH,
      risk_reason: `YTD attainment ${ytdAttainmentPct.toFixed(1)}% < 70% with ${pastMonthsCount} months of data`,
    }
  }

  // Rule 5 — MEDIUM: latest past month attainment 75–89% AND trend="down"
  if (latestAtt !== null && latestAtt >= 75 && latestAtt < 90 && trendDirection === 'down') {
    return {
      risk_level: RISK.MEDIUM,
      risk_reason: `Latest month attainment ${latestAtt.toFixed(1)}% (75–89%) with downward trend`,
    }
  }

  // Rule 6 — MEDIUM: exactly one past month with actuals=0 AND target>0 (not consecutive)
  const zeroMonths = pastRecords.filter(r => r.cacv_actual === 0 && r.cacv_target > 0)
  if (zeroMonths.length === 1) {
    return {
      risk_level: RISK.MEDIUM,
      risk_reason: `Exactly one month (${zeroMonths[0].month}) with zero actuals and positive target`,
    }
  }

  // Rule 7 — LOW: latest past month attainment 90–99%
  if (latestAtt !== null && latestAtt >= 90 && latestAtt < 100) {
    return {
      risk_level: RISK.LOW,
      risk_reason: `Latest month attainment ${latestAtt.toFixed(1)}% (90–99%)`,
    }
  }

  // Rule 8 — ON_TRACK: attainment >= 100%
  if (ytdAttainmentPct !== null && ytdAttainmentPct >= 100) {
    return {
      risk_level: RISK.ON_TRACK,
      risk_reason: `YTD attainment ${ytdAttainmentPct.toFixed(1)}% >= 100%`,
    }
  }

  // @gap 2026-06-26 spec rules 1-8 do not cover products with data where ytd < 100% and latest >= 100%
  // (e.g. strong final month but sub-100% YTD). Fallback: ON_TRACK if ytd >= 90%, LOW otherwise.
  // This prevents valid products from falling through to NO_DATA.
  if (ytdAttainmentPct !== null && ytdAttainmentPct >= 90) {
    return {
      risk_level: RISK.ON_TRACK,
      risk_reason: `YTD attainment ${ytdAttainmentPct.toFixed(1)}% near target — no active risk triggers`,
    }
  }

  if (ytdAttainmentPct !== null) {
    return {
      risk_level: RISK.LOW,
      risk_reason: `YTD attainment ${ytdAttainmentPct.toFixed(1)}% below target — no active risk triggers`,
    }
  }

  // Rule 9 fallback — NO_DATA (should be caught by pre-check, but as safety)
  return { risk_level: RISK.NO_DATA, risk_reason: 'No data available for risk classification' }
}

/**
 * Compute urgency score (0–100) for a product.
 *
 * risk_weights = {CRITICAL:1.0, HIGH:0.75, MEDIUM:0.5, LOW:0.25, ON_TRACK:0, NO_DATA:0}
 * months_remaining_weight = months_remaining / 12
 * gap_weight = fy_target_total > 0 ? Math.min(1, Math.abs(gap) / fy_target_total) : 0
 * urgency = Math.round(risk_weight * months_remaining_weight * gap_weight * 100)
 *
 * @param {string} riskLevel
 * @param {number} monthsRemaining — months left in the fiscal year (1–12)
 * @param {number} gap — ytdActuals - ytdTarget (negative = below)
 * @param {number} fyTargetTotal — sum of all 12 months target
 * @returns {number}
 */
// @contract input: riskLevel, monthsRemaining, gap, fyTargetTotal → output: urgency score 0-100 int
export function computeUrgency(riskLevel, monthsRemaining, gap, fyTargetTotal) {
  const riskWeights = {
    [RISK.CRITICAL]: 1.0,
    [RISK.HIGH]: 0.75,
    [RISK.MEDIUM]: 0.5,
    [RISK.LOW]: 0.25,
    [RISK.ON_TRACK]: 0,
    [RISK.NO_DATA]: 0,
  }
  const riskWeight = riskWeights[riskLevel] ?? 0
  const monthsRemainingWeight = monthsRemaining / 12
  const gapWeight = fyTargetTotal > 0 ? Math.min(1, Math.abs(gap) / fyTargetTotal) : 0
  return Math.round(riskWeight * monthsRemainingWeight * gapWeight * 100)
}
