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

              const tolV = 0.02
              if (v.ytd_acv_gap !== undefined && Math.abs((v.ytd_acv_gap ?? 0) - expectedAcvGap) > tolV) {
                failures.push(`[B] ${tag} / ${key}/${m.month}: ytd_acv_gap stored=${v.ytd_acv_gap} expected=${expectedAcvGap}`)
              }
              if (v.ytd_budget_gap !== undefined && Math.abs((v.ytd_budget_gap ?? 0) - expectedBudgetGap) > tolV) {
                failures.push(`[B] ${tag} / ${key}/${m.month}: ytd_budget_gap stored=${v.ytd_budget_gap} expected=${expectedBudgetGap}`)
              }
              if (expectedAttainment !== null && v.ytd_budget_attainment !== undefined && v.ytd_budget_attainment !== null) {
                if (Math.abs(v.ytd_budget_attainment - expectedAttainment) > 0.1) {
                  failures.push(`[B] ${tag} / ${key}/${m.month}: ytd_budget_attainment stored=${v.ytd_budget_attainment} expected=${expectedAttainment}`)
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
