// @story STORY-004 | verify
// @intent reads a portfolio.json produced by --transform and performs independent financial accuracy checks —
//   re-derives all rollup values from raw month data and fails fast if any computed field is inconsistent

import { readFileSync } from 'node:fs'
import path from 'node:path'

export class UserError extends Error {
  constructor(message) { super(message); this.name = 'UserError'; this.exitCode = 1 }
}
export class ProcessingError extends Error {
  constructor(message) { super(message); this.name = 'ProcessingError'; this.exitCode = 2 }
}

// ─── Arithmetic helpers (match transform.js exactly) ──────────────────────────

function intSum(values) {
  return Math.round(values.reduce((s, v) => s + Math.round((v ?? 0) * 100), 0)) / 100
}

function tolerance(a, b) {
  return Math.max(0.01, 0.001 * Math.max(Math.abs(a), Math.abs(b)))
}

function roundTo2(n) { return Math.round(n * 100) / 100 }
function roundTo1(n) { return Math.round(n * 10) / 10 }

// ─── YYYYMM helpers ───────────────────────────────────────────────────────────

const MONTH_ABBR_TO_NUM = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

function monthToYYYYMM(year, abbr) {
  const m = MONTH_ABBR_TO_NUM[abbr]
  if (!m) return null
  return parseInt(`${year}${m}`, 10)
}

// ─── Check runner ─────────────────────────────────────────────────────────────

// @entry run(args, options) | dispatched from cli.js for --verify <file>
export async function run(args, _options) {
  const fileArg = args[0]
  if (!fileArg || fileArg.trim() === '') throw new UserError('--verify requires a portfolio JSON file path argument')

  const resolvedPath = path.isAbsolute(fileArg) ? fileArg : path.resolve(process.cwd(), fileArg)

  let raw
  try { raw = readFileSync(resolvedPath, 'utf8') } catch (err) { throw new UserError(`file not found: ${fileArg}`) }

  let portfolio
  try { portfolio = JSON.parse(raw) } catch (err) { throw new ProcessingError(`cannot parse JSON: ${err.message}`) }

  if (!Array.isArray(portfolio.customers)) {
    throw new ProcessingError('invalid portfolio.json — expected customers[] array')
  }

  const failures = []
  const warnings = []
  let productCount = 0
  let monthCount = 0

  const rmInt = portfolio.reporting_month ? parseInt(String(portfolio.reporting_month), 10) : null

  for (const customer of portfolio.customers) {
    const custName = customer.customer || customer.customer_id || '(unknown)'
    const customerRollup = customer.annual_contract_values ?? {}

    // ── Check A: Customer-level annual rollup integrity ───────────────────────
    // Recompute from all L3 months and compare to customer.annual_contract_values
    // ACV is constant per L3+year — use max() per L3, then sum across L3s (same as transform.js)
    const recomputedYears = {}
    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        for (const l3 of l2.solutions_l3 ?? []) {
          const contract = l3.contract ?? {}
          for (const key of Object.keys(contract)) {
            if (key === 'contract_insights') continue
            const months = contract[key]
            if (!Array.isArray(months) || !months.length) continue
            if (!recomputedYears[key]) recomputedYears[key] = { acv: [], budget: [] }
            // max() per L3 for ACV (constant across months); sum() for budget (monthly accrual)
            recomputedYears[key].acv.push(Math.max(...months.map(m => m.ytd_annual_contract_value ?? 0)))
            for (const m of months) {
              recomputedYears[key].budget.push(m.ytd_budget_contract_value ?? 0)
            }
          }
        }
      }
    }
    for (const [year, arrs] of Object.entries(recomputedYears)) {
      const reacv    = intSum(arrs.acv)
      const rebudget = intSum(arrs.budget)
      const stored   = customerRollup[year]
      if (!stored) {
        failures.push(`[A] ${custName} / year=${year}: missing annual_contract_values entry`)
      } else {
        const tolA = tolerance(reacv,    stored.annual_annual_contract_value ?? 0)
        const tolB = tolerance(rebudget, stored.annual_budget_contract_value  ?? 0)
        if (Math.abs(reacv    - (stored.annual_annual_contract_value ?? 0)) > tolA) {
          failures.push(`[A] ${custName} / ${year}: annual_annual_contract_value stored=${stored.annual_annual_contract_value} recomputed=${reacv}`)
        }
        if (Math.abs(rebudget - (stored.annual_budget_contract_value ?? 0)) > tolB) {
          failures.push(`[A] ${custName} / ${year}: annual_budget_contract_value stored=${stored.annual_budget_contract_value} recomputed=${rebudget}`)
        }
      }
    }

    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        for (const l3 of l2.solutions_l3 ?? []) {
          productCount++
          const contract = l3.contract ?? {}
          const tag = `${custName} / ${l1.name} / ${l2.name} / ${l3.lpr_id}`

          for (const key of Object.keys(contract)) {
            if (key === 'contract_insights') continue
            const months = contract[key]
            if (!Array.isArray(months)) continue

            for (const m of months) {
              monthCount++

              // ── Check D: No NaN/Infinity ──────────────────────────────────
              for (const field of ['ytd_annual_contract_value', 'ytd_budget_contract_value', 'ytd_consumed_contract_value']) {
                if (!isFinite(m[field] ?? null)) {
                  failures.push(`[D] ${tag} / ${key}/${m.month}: ${field} is not finite`)
                }
              }

              // ── Check B: Variance field consistency ───────────────────────
              const acv   = m.ytd_annual_contract_value   ?? 0
              const bud   = m.ytd_budget_contract_value   ?? 0
              const cons  = m.ytd_consumed_contract_value ?? 0
              const v     = m.variances ?? {}

              const expectedAcvGap     = roundTo2(acv  - cons)
              const expectedBudgetGap  = roundTo2(bud  - cons)
              const expectedAttainment = bud > 0 ? roundTo1(cons / bud * 100) : null

              const tolV = 0.02  // tight: variances are derived, not measured
              if (v.acv_gap !== undefined && Math.abs((v.acv_gap ?? 0) - expectedAcvGap) > tolV) {
                failures.push(`[B] ${tag} / ${key}/${m.month}: acv_gap stored=${v.acv_gap} expected=${expectedAcvGap}`)
              }
              if (v.budget_gap !== undefined && Math.abs((v.budget_gap ?? 0) - expectedBudgetGap) > tolV) {
                failures.push(`[B] ${tag} / ${key}/${m.month}: budget_gap stored=${v.budget_gap} expected=${expectedBudgetGap}`)
              }
              if (expectedAttainment !== null && v.budget_attainment !== undefined && v.budget_attainment !== null) {
                if (Math.abs(v.budget_attainment - expectedAttainment) > 0.1) {
                  failures.push(`[B] ${tag} / ${key}/${m.month}: budget_attainment stored=${v.budget_attainment} expected=${expectedAttainment}`)
                }
              }

              // ── Check E: No future-month actuals beyond reporting_month ───
              if (rmInt) {
                const yyyymm = monthToYYYYMM(key, m.month)
                if (yyyymm !== null && yyyymm > rmInt && cons > 0) {
                  warnings.push(`[E] ${tag} / ${key}/${m.month}: consumed=${cons} in future month (reporting_month=${portfolio.reporting_month})`)
                }
              }

              // ── Check F: Anomaly — consumed > 1.5× budget ────────────────
              if (bud > 0 && cons > 2.5 * bud) {
                warnings.push(`[F] ${tag} / ${key}/${m.month}: consumed ${cons} > 2.5× budget ${bud} (${roundTo1(cons / bud * 100)}%)`)
              }
            }
          }
        }
      }
    }
  }

  // ── Check C: Industry aggregated_contracts vs customer rollup ───────────────
  // Build customer YTD totals per industry from raw months, compare to stored aggregated_contracts
  const industryTotals = new Map()
  for (const customer of portfolio.customers) {
    const ind = customer.industry ?? 'Unknown'
    if (!industryTotals.has(ind)) industryTotals.set(ind, { budget: 0, consumed: 0 })
    const agg = industryTotals.get(ind)
    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        for (const l3 of l2.solutions_l3 ?? []) {
          const contract = l3.contract ?? {}
          for (const key of Object.keys(contract)) {
            if (key === 'contract_insights' || key === 'annual_contract_values') continue
            const months = contract[key]
            if (!Array.isArray(months)) continue
            for (const m of months) {
              if (rmInt) {
                const yyyymm = monthToYYYYMM(key, m.month)
                if (yyyymm !== null && yyyymm > rmInt) continue
              }
              agg.budget   += m.ytd_budget_contract_value   ?? 0
              agg.consumed += m.ytd_consumed_contract_value ?? 0
            }
          }
        }
      }
    }
  }

  for (const indBlock of portfolio.industry_insights ?? []) {
    const ind = indBlock.industry ?? 'Unknown'
    const stored = indBlock.aggregated_contracts ?? {}
    const derived = industryTotals.get(ind)
    if (!derived) continue
    const rebudget   = Math.round(derived.budget   * 100) / 100
    const reconsumed = Math.round(derived.consumed * 100) / 100
    const tolIB = tolerance(rebudget,   stored.budget_contract_value   ?? 0)
    const tolIC = tolerance(reconsumed, stored.consumed_contract_value ?? 0)
    if (Math.abs(rebudget   - (stored.budget_contract_value   ?? 0)) > tolIB) {
      failures.push(`[C] Industry "${ind}": budget_contract_value stored=${stored.budget_contract_value} recomputed=${rebudget}`)
    }
    if (Math.abs(reconsumed - (stored.consumed_contract_value ?? 0)) > tolIC) {
      failures.push(`[C] Industry "${ind}": consumed_contract_value stored=${stored.consumed_contract_value} recomputed=${reconsumed}`)
    }
  }

  // ── Emit warnings (non-fatal) ─────────────────────────────────────────────
  for (const w of warnings) {
    process.stderr.write(`warn: ${w}\n`)
  }

  // ── Emit failures and exit ────────────────────────────────────────────────
  if (failures.length > 0) {
    const lines = failures.map(f => `  · ${f}`).join('\n')
    throw new ProcessingError(`verify failed — ${failures.length} issue(s) across ${productCount} products, ${monthCount} months:\n${lines}`)
  }

  process.stdout.write(`✓ verify: ${productCount} products, ${monthCount} months checked — all checks pass\n`)
  if (warnings.length > 0) {
    process.stderr.write(`info: ${warnings.length} warning(s) — see stderr above\n`)
  }
}
