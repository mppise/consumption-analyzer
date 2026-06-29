// @story STORY-005 | dashboard
// @intent generates "The Signal Board" — a self-contained single-file HTML dashboard with sticky top nav,
//         three views (Signals, Accounts, Industry), an L1/L2/L3 drill drawer, and zero internet dependency;
//         Bootstrap CSS/JS/Icons + Chart.js inlined from node_modules

import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// ── Error classes ──────────────────────────────────────────────────────────────
export class UserError extends Error {
  constructor(msg) { super(msg); this.name = 'UserError'; this.exitCode = 1 }
}
export class ProcessingError extends Error {
  constructor(msg) { super(msg); this.name = 'ProcessingError'; this.exitCode = 2 }
}

// ── Semantic color constants ───────────────────────────────────────────────────
const C_ACV      = '#9ca3af'
const C_BUDGET   = '#16a34a'
const C_CONSUMED = '#ea580c'
const C_PCT      = '#1d4ed8'

// ── Level accent colours ───────────────────────────────────────────────────────
const LEVEL_COLOR = {
  INDUSTRY: '#a78bfa',
  ACCOUNT:  '#f472b6',
  EA:       '#34d399',
  SOLUTION: '#fb923c',
  CONTRACT: '#94a3b8',
}

// ── Asset paths (node_modules) ────────────────────────────────────────────────
const NM = path.join(__dirname, '..', '..', 'node_modules')
const BOOTSTRAP_CSS_PATH  = path.join(NM, 'bootstrap', 'dist', 'css', 'bootstrap.min.css')
const BOOTSTRAP_JS_PATH   = path.join(NM, 'bootstrap', 'dist', 'js', 'bootstrap.bundle.min.js')
const BOOTSTRAP_ICONS_CSS = path.join(NM, 'bootstrap-icons', 'font', 'bootstrap-icons.min.css')
const BOOTSTRAP_ICONS_WOFF2 = path.join(NM, 'bootstrap-icons', 'font', 'fonts', 'bootstrap-icons.woff2')
const CHARTJS_PATH        = path.join(NM, 'chart.js', 'dist', 'chart.umd.js')
const NUNITO_400 = path.join(NM, '@fontsource', 'nunito-sans', 'files', 'nunito-sans-latin-400-normal.woff2')
const NUNITO_600 = path.join(NM, '@fontsource', 'nunito-sans', 'files', 'nunito-sans-latin-600-normal.woff2')
const NUNITO_700 = path.join(NM, '@fontsource', 'nunito-sans', 'files', 'nunito-sans-latin-700-normal.woff2')

// ── HTML escape ───────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── USD abbreviated formatter ─────────────────────────────────────────────────
function usd(n) {
  if (n == null || isNaN(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n < 0 ? '-' : '') + '$' + (Math.abs(n) / 1_000_000).toFixed(1) + 'M'
  if (a >= 1_000) return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n) / 1_000) + 'K'
  return '$' + Math.round(n).toLocaleString('en-US')
}

// ── Percentage formatter (1 decimal) ─────────────────────────────────────────
function pct(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toFixed(1) + '%'
}

// ── Load and patch Bootstrap Icons CSS so fonts are base64 data URIs ─────────
function loadIconsCss() {
  let css = readFileSync(BOOTSTRAP_ICONS_CSS, 'utf8')
  const woff2 = readFileSync(BOOTSTRAP_ICONS_WOFF2)
  const b64 = woff2.toString('base64')
  css = css.replace(
    /url\("fonts\/bootstrap-icons\.woff2[^"]*"\)\s*format\("woff2"\)/,
    `url("data:font/woff2;base64,${b64}") format("woff2")`
  )
  css = css.replace(/,\s*url\("fonts\/bootstrap-icons\.woff[^"]*"\)\s*format\("woff"\)/, '')
  return css
}

function loadNunitoCss() {
  const b400 = readFileSync(NUNITO_400).toString('base64')
  const b600 = readFileSync(NUNITO_600).toString('base64')
  const b700 = readFileSync(NUNITO_700).toString('base64')
  return `
@font-face { font-family:'Nunito Sans'; font-weight:400; font-style:normal; src:url("data:font/woff2;base64,${b400}") format("woff2"); }
@font-face { font-family:'Nunito Sans'; font-weight:600; font-style:normal; src:url("data:font/woff2;base64,${b600}") format("woff2"); }
@font-face { font-family:'Nunito Sans'; font-weight:700; font-style:normal; src:url("data:font/woff2;base64,${b700}") format("woff2"); }
.insight-text { font-family:'Nunito Sans',sans-serif; font-size:13.5px; letter-spacing:0.01em; line-height:1.55; }
`
}

// ── YTD filter — set once at build time from portfolio.reporting_month ────────
// All aggregation helpers use this to exclude future months from totals.
let _reportingMonth = null  // YYYYMM integer, e.g. 202605

function isYtd(year, monthAbbr) {
  if (!_reportingMonth) return true  // no filter if not set
  const m = MONTH_ABBR_TO_NUM[monthAbbr]
  if (!m) return true
  return parseInt(`${year}${m}`, 10) <= _reportingMonth
}

// ── Aggregation helpers ───────────────────────────────────────────────────────
function customerTotals(customer) {
  let acv = 0, budget = 0, consumed = 0
  for (const l1 of customer.solutions_l1 ?? []) {
    for (const l2 of l1.solutions_l2 ?? []) {
      for (const l3 of l2.solutions_l3 ?? []) {
        const c = l3.contract ?? {}
        for (const year of Object.keys(c)) {
          if (year === 'contract_insights') continue
          for (const mo of c[year] ?? []) {
            if (!isYtd(year, mo.month)) continue
            acv      += mo.annual_contract_value   ?? 0
            budget   += mo.budget_contract_value   ?? 0
            consumed += mo.consumed_contract_value ?? 0
          }
        }
      }
    }
  }
  return { acv, budget, consumed }
}

function l1Totals(l1) {
  let acv = 0, budget = 0, consumed = 0
  for (const l2 of l1.solutions_l2 ?? []) {
    for (const l3 of l2.solutions_l3 ?? []) {
      const c = l3.contract ?? {}
      for (const year of Object.keys(c)) {
        if (year === 'contract_insights') continue
        for (const mo of c[year] ?? []) {
          if (!isYtd(year, mo.month)) continue
          acv      += mo.annual_contract_value   ?? 0
          budget   += mo.budget_contract_value   ?? 0
          consumed += mo.consumed_contract_value ?? 0
        }
      }
    }
  }
  return { acv, budget, consumed }
}

function l2Totals(l2) {
  let acv = 0, budget = 0, consumed = 0
  for (const l3 of l2.solutions_l3 ?? []) {
    const c = l3.contract ?? {}
    for (const year of Object.keys(c)) {
      if (year === 'contract_insights') continue
      for (const mo of c[year] ?? []) {
        if (!isYtd(year, mo.month)) continue
        acv      += mo.annual_contract_value   ?? 0
        budget   += mo.budget_contract_value   ?? 0
        consumed += mo.consumed_contract_value ?? 0
      }
    }
  }
  return { acv, budget, consumed }
}

function l3Totals(l3) {
  let acv = 0, budget = 0, consumed = 0
  const c = l3.contract ?? {}
  for (const year of Object.keys(c)) {
    if (year === 'contract_insights') continue
    for (const mo of c[year] ?? []) {
      if (!isYtd(year, mo.month)) continue
      acv      += mo.annual_contract_value   ?? 0
      budget   += mo.budget_contract_value   ?? 0
      consumed += mo.consumed_contract_value ?? 0
    }
  }
  return { acv, budget, consumed }
}

function attPct(budget, consumed) {
  return budget > 0 ? (consumed / budget * 100) : null
}

// ── Month string to YYYYMM integer ────────────────────────────────────────────
const MONTH_ABBR_TO_NUM = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12'
}
function monthToYYYYMM(year, monthAbbr) {
  const m = MONTH_ABBR_TO_NUM[monthAbbr]
  if (!m) return null
  return parseInt(`${year}${m}`, 10)
}

function reportingMonthDisplay(rm) {
  if (!rm) return '—'
  const s = String(rm)
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  if (s.length === 6) return `${mo[parseInt(s.slice(4), 10) - 1]} ${s.slice(0,4)}`
  return s
}

// ── Icon rules for insight bullets ───────────────────────────────────────────
const ICON_RULES = [
  { keywords: ['risk', 'gap', 'critical', 'warning', 'behind', 'below', 'miss', 'dormant', 'exposure'], icon: 'bi-exclamation-triangle-fill', color: '#f59e0b' },
  { keywords: ['opportunit', 'growth', 'expand', 'increase', 'upsell', 'accelerat'], icon: 'bi-graph-up-arrow', color: '#16a34a' },
  { keywords: ['integrat', 'connect', 'platform', 'btp', 'suite'], icon: 'bi-diagram-3', color: '#3b82f6' },
  { keywords: ['renew', 'contract', 'expir', 'end of'], icon: 'bi-calendar-check', color: '#0891b2' },
  { keywords: ['action', 'recommend', 'priorit', 'next step', 'engage'], icon: 'bi-lightning-charge-fill', color: '#1d4ed8' },
  { keywords: ['adopt', 'usage', 'consumption', 'utiliz', 'activat'], icon: 'bi-bar-chart-line', color: '#64748b' },
]

function pickIcon(text) {
  const lower = text.toLowerCase()
  for (const rule of ICON_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule
    }
  }
  return { icon: 'bi-info-circle', color: '#94a3b8' }
}

// ── Health color ───────────────────────────────────────────────────────────────
function healthColor(att) {
  if (att == null) return '#64748b'
  return att >= 80 ? '#22c55e' : att >= 50 ? '#f59e0b' : '#ef4444'
}

// ── Truncate string ───────────────────────────────────────────────────────────
function trunc(s, n) {
  if (!s) return ''
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

// ── JSON embed helper — escapes </script> ────────────────────────────────────
function jsonEmbed(v) {
  return JSON.stringify(v).replace(/<\/script>/gi, '<\\/script>')
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVER-SIDE BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Build flat signals array ───────────────────────────────────────────────────
// @contract input: portfolio → output: array of signal entry objects grouped:
//   first all INDUSTRY signals, then per-customer: ACCOUNT → EA → SOLUTION → CONTRACT
function buildSignals(portfolio) {
  const customers = portfolio.customers ?? []
  const signals = []

  // 1. Industry insights (first, as their own section)
  for (const ind of portfolio.industry_insights ?? []) {
    for (const text of ind.summary ?? []) {
      signals.push({
        level: 'INDUSTRY',
        text,
        context: esc(ind.industry),
        custIdx: null,
        l1Idx: null,
        l2Idx: null,
        l3Idx: null,
        attainment: null,
        industryName: ind.industry,
      })
    }
  }

  // 2. Per-customer: ACCOUNT → EA → SOLUTION → CONTRACT
  customers.forEach((cust, custIdx) => {
    const t = customerTotals(cust)
    const att = attPct(t.budget, t.consumed)

    // ACCOUNT insights for this customer
    for (const text of cust.account_insights ?? []) {
      signals.push({
        level: 'ACCOUNT',
        text,
        context: `${esc(cust.customer)} · ${att != null ? pct(att) : '—'}`,
        custIdx,
        l1Idx: null,
        l2Idx: null,
        l3Idx: null,
        attainment: att,
      })
    }

    // EA insights for this customer
    ;(cust.solutions_l1 ?? []).forEach((l1, l1Idx) => {
      const lt = l1Totals(l1)
      const la = attPct(lt.budget, lt.consumed)
      for (const text of l1.enterprise_architecture_insights ?? []) {
        signals.push({
          level: 'EA',
          text,
          context: `${esc(cust.customer)} · ${esc(l1.name)} · ${la != null ? pct(la) : '—'}`,
          custIdx,
          l1Idx,
          l2Idx: null,
          l3Idx: null,
          attainment: la,
        })
      }
    })

    // SOLUTION insights for this customer
    ;(cust.solutions_l1 ?? []).forEach((l1, l1Idx) => {
      ;(l1.solutions_l2 ?? []).forEach((l2, l2Idx) => {
        const lt = l2Totals(l2)
        const la = attPct(lt.budget, lt.consumed)
        const seen = new Set()
        for (const l3 of l2.solutions_l3 ?? []) {
          for (const text of l3.solution_architecture_insights ?? []) {
            if (seen.has(text)) continue
            seen.add(text)
            signals.push({
              level: 'SOLUTION',
              text,
              context: `${esc(cust.customer)} · ${esc(l2.name)} · ${la != null ? pct(la) : '—'}`,
              custIdx,
              l1Idx,
              l2Idx,
              l3Idx: null,
              attainment: la,
            })
          }
        }
      })
    })

    // CONTRACT insights for this customer
    ;(cust.solutions_l1 ?? []).forEach((l1, l1Idx) => {
      ;(l1.solutions_l2 ?? []).forEach((l2, l2Idx) => {
        ;(l2.solutions_l3 ?? []).forEach((l3, l3Idx) => {
          const lt = l3Totals(l3)
          const la = attPct(lt.budget, lt.consumed)
          for (const text of l3.contract?.contract_insights ?? []) {
            signals.push({
              level: 'CONTRACT',
              text,
              context: `${esc(cust.customer)} · ${esc(l3.lpr_name)} · ${la != null ? pct(la) : '—'}`,
              custIdx,
              l1Idx,
              l2Idx,
              l3Idx,
              attainment: la,
            })
          }
        })
      })
    })
  })

  return signals
}

// ── Build signal expansion HTML for a single signal ───────────────────────────
// @contract input: signal entry, customers[] → output: HTML string for the expansion div
function buildSignalExpansion(sig, customers) {
  const lc = LEVEL_COLOR[sig.level]

  if (sig.level === 'CONTRACT') {
    const cust = customers[sig.custIdx]
    const l1   = cust?.solutions_l1?.[sig.l1Idx]
    const l2   = l1?.solutions_l2?.[sig.l2Idx]
    const l3   = l2?.solutions_l3?.[sig.l3Idx]
    if (!l3) return ''
    const t = l3Totals(l3)
    const att = attPct(t.budget, t.consumed)
    // Build sparkline data (all months in contract, no filter)
    const sparkLabels = [], sparkConsumed = []
    const contract = l3.contract ?? {}
    for (const yr of Object.keys(contract).filter(k => k !== 'contract_insights').sort()) {
      for (const mo of contract[yr] ?? []) {
        sparkLabels.push(`${mo.month}`)
        sparkConsumed.push(mo.consumed_contract_value ?? 0)
      }
    }
    const sparkData = JSON.stringify({ labels: sparkLabels, consumed: sparkConsumed }).replace(/"/g, '&quot;')
    return `<div style="display:flex;gap:32px;align-items:flex-start">
  <div>
    <div style="font-size:11px;color:#64748b;margin-bottom:4px">LPR</div>
    <div style="font-size:14px;font-weight:600;color:#0f172a">${esc(l3.lpr_name)}</div>
    <div style="font-size:24px;font-weight:800;color:${healthColor(att)};margin-top:8px">${att != null ? pct(att) : '—'}</div>
    <div style="font-size:13px;color:#94a3b8;margin-top:2px">Budget Attainment</div>
    <div style="font-size:13px;color:#64748b;margin-top:8px">Budget <span style="color:#22c55e;font-weight:600">${usd(t.budget)}</span></div>
    <div style="font-size:13px;color:#64748b">Consumed <span style="color:#fb923c;font-weight:600">${usd(t.consumed)}</span></div>
  </div>
  <div style="flex:1;min-width:0">
    <div style="font-size:13px;color:#94a3b8;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em">Consumed over time</div>
    <canvas data-sparkline="${sparkData}" style="height:60px;width:100%;max-width:300px;display:block"></canvas>
  </div>
</div>`
  }

  if (sig.level === 'SOLUTION') {
    const cust = customers[sig.custIdx]
    const l1   = cust?.solutions_l1?.[sig.l1Idx]
    const l2   = l1?.solutions_l2?.[sig.l2Idx]
    if (!l2) return ''
    const t = l2Totals(l2)
    const att = attPct(t.budget, t.consumed)
    const l3Names = (l2.solutions_l3 ?? []).map(l3 => esc(l3.lpr_name)).join(', ')
    return `<div>
  <div style="font-size:11px;color:#64748b;margin-bottom:4px">Solution Area</div>
  <div style="font-size:14px;font-weight:600;color:#0f172a">${esc(l2.name)}</div>
  <div style="font-size:24px;font-weight:800;color:${healthColor(att)};margin-top:8px">${att != null ? pct(att) : '—'}</div>
  <div style="font-size:13px;color:#94a3b8;margin-top:2px">Budget Attainment</div>
  <div style="font-size:13px;color:#64748b;margin-top:8px">Budget <span style="color:#22c55e;font-weight:600">${usd(t.budget)}</span> · Consumed <span style="color:#fb923c;font-weight:600">${usd(t.consumed)}</span></div>
  <div style="font-size:13px;color:#64748b;margin-top:8px">Products: ${l3Names || '—'}</div>
</div>`
  }

  if (sig.level === 'EA') {
    const cust = customers[sig.custIdx]
    const l1   = cust?.solutions_l1?.[sig.l1Idx]
    if (!l1) return ''
    const t = l1Totals(l1)
    const att = attPct(t.budget, t.consumed)
    const budgetWidth = 100
    const consumedWidth = t.budget > 0 ? Math.min(100, (t.consumed / t.budget) * 100) : 0
    return `<div>
  <div style="font-size:11px;color:#64748b;margin-bottom:4px">Solution Area</div>
  <div style="font-size:14px;font-weight:600;color:#0f172a">${esc(l1.name)}</div>
  <div style="font-size:24px;font-weight:800;color:${healthColor(att)};margin-top:8px">${att != null ? pct(att) : '—'}</div>
  <div style="font-size:13px;color:#94a3b8;margin-top:2px">Budget Attainment</div>
  <div style="margin-top:16px;max-width:400px">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#22c55e;margin-bottom:3px"><span>Budget</span><span>${usd(t.budget)}</span></div>
    <div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#22c55e;width:${budgetWidth}%"></div></div>
    <div style="display:flex;justify-content:space-between;font-size:13px;color:#fb923c;margin-bottom:3px;margin-top:8px"><span>Consumed</span><span>${usd(t.consumed)}</span></div>
    <div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#fb923c;width:${consumedWidth.toFixed(1)}%"></div></div>
  </div>
</div>`
  }

  if (sig.level === 'ACCOUNT') {
    const cust = customers[sig.custIdx]
    if (!cust) return ''
    const t = customerTotals(cust)
    const att = attPct(t.budget, t.consumed)
    return `<div>
  <div style="font-size:14px;font-weight:600;color:#0f172a">${esc(cust.customer)}</div>
  <div style="font-size:11px;color:#64748b;margin-bottom:12px">${esc(cust.industry ?? '')}</div>
  <div style="font-size:24px;font-weight:800;color:${healthColor(att)}">${att != null ? pct(att) : '—'}</div>
  <div style="font-size:13px;color:#94a3b8;margin-top:2px">Budget Attainment</div>
  <div style="font-size:13px;color:#64748b;margin-top:8px">
    Consumed <span style="color:#fb923c;font-weight:600">${usd(t.consumed)}</span> ·
    Budget <span style="color:#22c55e;font-weight:600">${usd(t.budget)}</span> ·
    ACV <span style="color:#9ca3af;font-weight:600">${usd(t.acv)}</span>
  </div>
  <div style="margin-top:12px">
    <span onclick="showView('accounts');showCustomer(${sig.custIdx})" style="font-size:12px;color:#f472b6;cursor:pointer;text-decoration:underline">→ View in Accounts</span>
  </div>
</div>`
  }

  if (sig.level === 'INDUSTRY') {
    // Aggregate across all customers in the same industry
    const indName = sig.industryName
    const indCustomers = customers.filter(c => c.industry === indName)
    let totalBudget = 0, totalConsumed = 0
    for (const c of indCustomers) {
      const t = customerTotals(c)
      totalBudget += t.budget
      totalConsumed += t.consumed
    }
    const att = attPct(totalBudget, totalConsumed)
    const custRows = indCustomers.map((c, i) => {
      const t = customerTotals(c)
      const ca = attPct(t.budget, t.consumed)
      return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #e2e8f0;font-size:11px">
  <span style="color:#64748b">${esc(c.customer)}</span>
  <span style="color:${healthColor(ca)};font-weight:600">${ca != null ? pct(ca) : '—'}</span>
</div>`
    }).join('')
    return `<div>
  <div style="font-size:14px;font-weight:600;color:#0f172a">${esc(indName)}</div>
  <div style="font-size:24px;font-weight:800;color:${healthColor(att)};margin-top:8px">${att != null ? pct(att) : '—'}</div>
  <div style="font-size:13px;color:#94a3b8;margin-top:2px">Industry Attainment</div>
  <div style="font-size:13px;color:#64748b;margin-top:8px">Budget <span style="color:#22c55e;font-weight:600">${usd(totalBudget)}</span> · Consumed <span style="color:#fb923c;font-weight:600">${usd(totalConsumed)}</span></div>
  <div style="margin-top:16px;min-width:240px">${custRows}</div>
</div>`
  }

  return ''
}

// ── Build SIGNALS VIEW HTML ────────────────────────────────────────────────────
// @contract input: signals[], customers[] → output: HTML string
// Change 3: grouped by customer with industry section header first
function buildSignalsView(signals, customers) {
  // Change 1: light theme colours in filter bar
  const filterBar = `<div style="padding:12px 32px;border-bottom:1px solid #cbd5e1;display:flex;gap:8px;align-items:center;background:#ffffff">
  <span style="font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;margin-right:8px">Filter:</span>
  <button onclick="filterSignals('ALL')" class="sig-filter" data-filter="ALL" style="padding:4px 12px;background:#0f172a;color:#ffffff;border:1px solid #0f172a;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer">ALL</button>
  <button onclick="filterSignals('INDUSTRY')" class="sig-filter" data-filter="INDUSTRY" style="padding:4px 12px;background:transparent;color:#64748b;border:1px solid #cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer">INDUSTRY</button>
  <button onclick="filterSignals('ACCOUNT')" class="sig-filter" data-filter="ACCOUNT" style="padding:4px 12px;background:transparent;color:#64748b;border:1px solid #cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer">ACCOUNT</button>
  <button onclick="filterSignals('EA')" class="sig-filter" data-filter="EA" style="padding:4px 12px;background:transparent;color:#64748b;border:1px solid #cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer">EA</button>
  <button onclick="filterSignals('SOLUTION')" class="sig-filter" data-filter="SOLUTION" style="padding:4px 12px;background:transparent;color:#64748b;border:1px solid #cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer">SOLUTION</button>
  <button onclick="filterSignals('CONTRACT')" class="sig-filter" data-filter="CONTRACT" style="padding:4px 12px;background:transparent;color:#64748b;border:1px solid #cbd5e1;font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;cursor:pointer">CONTRACT</button>
</div>`

  // Separate industry signals from customer signals
  const industrySigs = signals.filter(s => s.level === 'INDUSTRY')
  const customerSigs = signals.filter(s => s.level !== 'INDUSTRY')

  // Build industry section
  let html = ''

  // Industry section header
  if (industrySigs.length > 0) {
    html += `<div class="ind-section-header" style="padding:8px 32px;background:#ede9fe;border-bottom:1px solid #c4b5fd">
  <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6d28d9">Industry Signals</span>
</div>`
    for (const sig of industrySigs) {
      const lc = LEVEL_COLOR[sig.level] ?? '#94a3b8'
      const expandContent = buildSignalExpansion(sig, customers)
      html += `<div class="signal-row" data-level="${sig.level}" data-cust="null" data-l1="null" data-l2="null" data-l3="null"
  onclick="toggleSignal(this)"
  style="border-left:3px solid ${lc};border-bottom:1px solid #f1f5f9;padding:16px 32px;cursor:pointer;display:flex;align-items:baseline;justify-content:space-between;gap:24px;background:#ffffff">
  <div style="display:flex;align-items:baseline;gap:16px;flex:1;min-width:0">
    <span style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${lc};flex-shrink:0;width:72px">${sig.level}</span>
    <span style="font-size:13.5px;font-weight:400;color:#0f172a;line-height:1.4" class="insight-text">${esc(sig.text)}</span>
  </div>
  <div style="font-size:11px;color:#64748b;flex-shrink:0;text-align:right;white-space:nowrap">${sig.context}</div>
</div>
<div class="signal-expand" data-level="${sig.level}" style="display:none;background:#f1f5f9;border-left:3px solid ${lc};border-bottom:1px solid #cbd5e1;padding:16px 32px 16px 121px">
  ${expandContent}
</div>`
    }
  }

  // Group customer signals by custIdx
  const custGroups = new Map()
  for (const sig of customerSigs) {
    const ci = sig.custIdx
    if (!custGroups.has(ci)) custGroups.set(ci, [])
    custGroups.get(ci).push(sig)
  }

  // Render per-customer groups in customer order
  for (const [custIdx, custSignals] of custGroups) {
    const cust = customers[custIdx]
    if (!cust) continue
    const t = customerTotals(cust)
    const att = attPct(t.budget, t.consumed)
    const attStr = att != null ? pct(att) : '—'
    const indStr = esc(cust.industry ?? '')

    html += `<div class="cust-group-header" data-cust="${custIdx}"
  style="padding:8px 32px;background:#e2e8f0;border-bottom:1px solid #cbd5e1;border-top:1px solid #cbd5e1;display:flex;align-items:center;justify-content:space-between">
  <span style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#0f172a">${esc(cust.customer)}</span>
  <span style="font-size:11px;color:#64748b">${indStr}</span>
</div>`

    for (const sig of custSignals) {
      const lc = LEVEL_COLOR[sig.level] ?? '#94a3b8'
      const l1Attr = sig.l1Idx != null ? sig.l1Idx : 'null'
      const l2Attr = sig.l2Idx != null ? sig.l2Idx : 'null'
      const l3Attr = sig.l3Idx != null ? sig.l3Idx : 'null'
      const expandContent = buildSignalExpansion(sig, customers)
      html += `<div class="signal-row" data-level="${sig.level}" data-cust="${custIdx}" data-l1="${l1Attr}" data-l2="${l2Attr}" data-l3="${l3Attr}"
  onclick="toggleSignal(this)"
  style="border-left:3px solid ${lc};border-bottom:1px solid #f1f5f9;padding:16px 32px;cursor:pointer;display:flex;align-items:baseline;justify-content:space-between;gap:24px;background:#ffffff">
  <div style="display:flex;align-items:baseline;gap:16px;flex:1;min-width:0">
    <span style="font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${lc};flex-shrink:0;width:72px">${sig.level}</span>
    <span style="font-size:13.5px;font-weight:400;color:#0f172a;line-height:1.4" class="insight-text">${esc(sig.text)}</span>
  </div>
  <div style="font-size:11px;color:#64748b;flex-shrink:0;text-align:right;white-space:nowrap">${sig.context}</div>
</div>
<div class="signal-expand" data-level="${sig.level}" style="display:none;background:#f1f5f9;border-left:3px solid ${lc};border-bottom:1px solid #cbd5e1;padding:16px 32px 16px 121px">
  ${expandContent}
</div>`
    }
  }

  return filterBar + `<div id="signals-list">${html}</div>`
}

// ── Build ACCOUNTS VIEW HTML ───────────────────────────────────────────────────
// @contract input: customers[] → output: HTML string
function buildAccountsView(customers) {
  // Change 1: light theme for tabs
  const tabs = customers.map((cust, idx) => {
    const t = customerTotals(cust)
    const att = attPct(t.budget, t.consumed)
    const isFirst = idx === 0
    return `<button onclick="showCustomer(${idx})" class="cust-tab" data-cust="${idx}"
  style="padding:8px 20px;background:${isFirst ? '#f1f5f9' : 'transparent'};border:1px solid #cbd5e1;color:${isFirst ? '#0f172a' : '#64748b'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
  ${esc(cust.customer)}
</button>`
  }).join('')

  const panels = customers.map((cust, custIdx) => {
    const t = customerTotals(cust)
    const att = attPct(t.budget, t.consumed)
    // Change 5: replace metric bars with canvas — data embedded in ACCT_BAR_DATA
    // Canvas will be initialized by renderAcctBar(custIdx) called from showCustomer()

    // Change 2: font-size:24px for customer name; Change 4: attainment inline next to name
    // Change 4: metric priority Consumed > Budget > ACV
    // L1 tiles — card format: donut header + EA insights body
    const l1Tiles = (cust.solutions_l1 ?? []).map((l1, l1Idx) => {
      const lt = l1Totals(l1)
      const la = attPct(lt.budget, lt.consumed)
      const eaInsights = (l1.enterprise_architecture_insights ?? [])
      const eaRows = eaInsights.map(text =>
        `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #e2e8f0">
          <i class="bi ${pickIcon(text)}" style="font-size:11px;flex-shrink:0;margin-top:2px"></i>
          <span style="font-size:13.5px;color:#0f172a;line-height:1.4" class="insight-text">${esc(text)}</span>
        </div>`
      ).join('') || `<div style="font-size:11px;color:#94a3b8;font-style:italic;padding:6px 0">No EA insights</div>`

      return `<div style="border:1px solid #e2e8f0;min-width:200px;flex:1;max-width:320px;overflow:hidden">
  <!-- Card header: bar chart style -->
  <div onclick="openL1(${custIdx},${l1Idx})" style="cursor:pointer;background:#f8fafc;padding:16px;border-bottom:1px solid #e2e8f0">
    <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Solution Area</div>
    <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:10px">${esc(l1.name)}</div>
    <div style="font-size:22px;font-weight:800;color:#60a5fa;line-height:1">${la != null ? pct(la) : '—'}</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">Budget Attainment</div>
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#22c55e;margin-bottom:3px"><span>Budget</span><span>${usd(lt.budget)}</span></div>
      <div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#22c55e;width:100%"></div></div>
    </div>
    <div style="margin-bottom:4px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#fb923c;margin-bottom:3px"><span>Consumed</span><span>${usd(lt.consumed)}</span></div>
      <div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#fb923c;width:${la != null ? Math.min(100, la).toFixed(1) : 0}%"></div></div>
    </div>
    <div style="font-size:12px;color:#94a3b8;margin-top:6px">ACV: ${usd(lt.acv)}</div>
  </div>
  <!-- Card body: EA insights -->
  <div style="padding:12px 14px;background:white">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#34d399;margin-bottom:6px">EA Insights</div>
    ${eaRows}
  </div>
</div>`
    }).join('')

    // Account insight rows — Change 1: light theme
    const accountInsightRows = (cust.account_insights ?? []).map(text => {
      return `<div style="padding:12px 0;border-bottom:1px solid #e2e8f0;border-left:3px solid #f472b6;padding-left:12px;font-size:15px;color:#0f172a;line-height:1.4" class="insight-text">${esc(text)}</div>`
    }).join('')

    // Change 2: font-size:24px for customer name heading (was 48px)
    // Change 4: attainment inline next to name at 18px font-weight:700
    // Change 5: canvas for account bar replacing 3 metric bars
    return `<div id="cust-panel-${custIdx}" style="display:${custIdx === 0 ? 'block' : 'none'};padding:40px 48px">
  <div style="display:flex;align-items:baseline;gap:16px;margin-bottom:4px">
    <div style="font-size:24px;font-weight:800;color:#0f172a;line-height:1">${esc(cust.customer)}</div>
  </div>
  <div style="font-size:13px;color:#64748b;margin-bottom:32px">${esc(cust.industry ?? '')}</div>
  <div style="display:flex;align-items:flex-start;gap:32px;margin-bottom:40px;padding-bottom:32px;border-bottom:1px solid #cbd5e1">
    <!-- Donut: 30% width -->
    <div style="flex:0 0 30%;text-align:center">
      <canvas id="acct-bar-${custIdx}" width="180" height="180" style="display:block;margin:0 auto"></canvas>
      <div style="font-size:13px;color:#22c55e;margin-top:6px">Budget: ${usd(t.budget)}</div>
      <div style="font-size:13px;color:#fb923c">Consumed: ${usd(t.consumed)}</div>
      <div style="font-size:13px;color:#94a3b8">ACV: ${usd(t.acv)}</div>
    </div>
    <!-- Account insights: 70% width -->
    <div style="flex:1;min-width:0">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#f472b6;margin-bottom:12px">Account Insights</div>
      ${accountInsightRows || '<div style="font-size:13px;color:#94a3b8;font-style:italic">No insights available</div>'}
    </div>
  </div>
  <!-- Solution area cards -->
  <div style="margin-bottom:32px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:12px">Solution Areas</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${l1Tiles}</div>
  </div>
</div>`
  }).join('\n')

  // Change 1: light theme tab strip
  return `<div style="padding:12px 32px;border-bottom:1px solid #cbd5e1;display:flex;gap:0;overflow-x:auto;background:#f8fafc">${tabs}</div>
<div id="accounts-panels">${panels}</div>`
}

// ── Build INDUSTRY VIEW HTML ───────────────────────────────────────────────────
// @contract input: indInsights[], customers[] → output: HTML string
function buildIndustryView(indInsights, customers) {
  if (indInsights.length === 0) {
    return `<div style="padding:40px 48px;color:#94a3b8;font-size:14px">No industry insights available.</div>`
  }

  // Change 1: light theme tabs
  const tabs = indInsights.map((ind, idx) => {
    const indCustomers = customers.filter(c => c.industry === ind.industry)
    let totalBudget = 0, totalConsumed = 0
    for (const c of indCustomers) { const t = customerTotals(c); totalBudget += t.budget; totalConsumed += t.consumed }
    const att = attPct(totalBudget, totalConsumed)
    const isFirst = idx === 0
    return `<button onclick="showIndustry(${idx})" class="ind-tab" data-ind="${idx}"
  style="padding:8px 20px;background:${isFirst ? '#f1f5f9' : 'transparent'};border:1px solid #cbd5e1;color:${isFirst ? '#0f172a' : '#64748b'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
  ${esc(ind.industry)}
</button>`
  }).join('')

  const panels = indInsights.map((ind, indIdx) => {
    const indCustomers = customers.filter(c => c.industry === ind.industry)
    let totalBudget = 0, totalConsumed = 0
    for (const c of indCustomers) { const t = customerTotals(c); totalBudget += t.budget; totalConsumed += t.consumed }
    const att = attPct(totalBudget, totalConsumed)

    // Change 1: light theme insight rows
    const insightRows = (ind.summary ?? []).map(text => {
      return `<div style="padding:12px 0;border-bottom:1px solid #e2e8f0;border-left:3px solid #a78bfa;padding-left:12px;font-size:15px;color:#0f172a;line-height:1.4" class="insight-text">${esc(text)}</div>`
    }).join('')

    const ac = ind.aggregated_contracts ?? {}
    const indAcv = ac.annual_contract_value ?? 0

    // Change 2: font-size:24px for industry name heading (was 48px)
    // Change 6: fixed-height wrapper for canvas; canvas has absolute positioning
    return `<div id="ind-panel-${indIdx}" style="display:${indIdx === 0 ? 'block' : 'none'};padding:40px 48px">
  <div style="font-size:24px;font-weight:800;color:#0f172a">${esc(ind.industry)}</div>
  <div style="font-size:13px;color:#64748b;margin-bottom:32px">${indCustomers.length} customer${indCustomers.length !== 1 ? 's' : ''} · ACV ${usd(indAcv)}</div>
  <div style="margin-bottom:32px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:16px">Budget vs Consumed by Customer</div>
    <div style="display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start;padding:0 16px">
      ${indCustomers.map((c, i) => {
        const ct = customerTotals(c)
        const att = ct.budget > 0 ? (ct.consumed / ct.budget * 100) : null
        return `<div style="text-align:center;padding:0 12px">
          <canvas id="ind-donut-${indIdx}-${i}" width="160" height="160" style="display:block;margin:0 auto"></canvas>
          <div style="font-size:12px;font-weight:600;color:#0f172a;margin-top:8px">${esc(c.customer)}</div>
          <div style="font-size:13px;color:#22c55e">Budget: ${usd(ct.budget)}</div>
          <div style="font-size:13px;color:#fb923c">Consumed: ${usd(ct.consumed)}</div>
          <div style="font-size:13px;color:#94a3b8">ACV: ${usd(ct.acv)}</div>
        </div>`
      }).join('')}
    </div>
  </div>
  <div style="margin-bottom:32px;border-top:1px solid #cbd5e1;padding-top:24px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#a78bfa;margin-bottom:16px">Industry Insights</div>
    ${insightRows || '<div style="font-size:13px;color:#94a3b8;font-style:italic">No insights available</div>'}
  </div>
</div>`
  }).join('\n')

  // Change 1: light theme tab strip; Change 6: renderIndChart called directly (no setTimeout)
  return `<div style="padding:12px 32px;border-bottom:1px solid #cbd5e1;display:flex;gap:0;overflow-x:auto;background:#f8fafc">${tabs}</div>
<div id="industry-panels">${panels}</div>`
}

// ── Build DRAWER DATA ─────────────────────────────────────────────────────────
// @contract input: customers[], reportingMonth → output: { drawerData, l3ChartData }
function buildDrawerData(customers, reportingMonth) {
  const drawerData = {}   // keyed "c{c}-l1{l1}" and "c{c}-l1{l1}-l2{l2}"
  const l3ChartData = {}  // keyed "c{c}-l1{l1}-l2{l2}-l3{l3}"

  customers.forEach((cust, custIdx) => {
    ;(cust.solutions_l1 ?? []).forEach((l1, l1Idx) => {
      const l1Key = `c${custIdx}-l1${l1Idx}`
      const l1t = l1Totals(l1)
      const l1Att = attPct(l1t.budget, l1t.consumed)

      // EA-level drawer data: L2 tiles with solution insights embedded
      const l2Tiles = (l1.solutions_l2 ?? []).map((l2, l2Idx) => {
        const t = l2Totals(l2)
        const a = attPct(t.budget, t.consumed)
        // collect unique saInsights from first L3 that has them (all L3s under an L2 share the same SA insights)
        const saInsights = []
        const seen = new Set()
        for (const l3 of l2.solutions_l3 ?? []) {
          for (const s of l3.solution_architecture_insights ?? []) {
            if (!seen.has(s)) { seen.add(s); saInsights.push(s) }
          }
          if (saInsights.length > 0) break
        }
        return { name: l2.name, attainment: a, budget: t.budget, consumed: t.consumed, acv: t.acv, l2Idx, saInsights }
      })

      drawerData[l1Key] = {
        custName: cust.customer,
        l1Name: l1.name,
        l1Attainment: l1Att,
        l1Budget: l1t.budget,
        l1Consumed: l1t.consumed,
        eaInsights: l1.enterprise_architecture_insights ?? [],
        l2Tiles,
      }

      ;(l1.solutions_l2 ?? []).forEach((l2, l2Idx) => {
        const l2Key = `c${custIdx}-l1${l1Idx}-l2${l2Idx}`

        // Collect solution_architecture_insights from L3s (deduplicate)
        const seenSa = new Set()
        const saInsights = []
        for (const l3 of l2.solutions_l3 ?? []) {
          for (const s of l3.solution_architecture_insights ?? []) {
            if (!seenSa.has(s)) { seenSa.add(s); saInsights.push(s) }
          }
        }

        const l3List = (l2.solutions_l3 ?? []).map((l3, l3Idx) => {
          const t = l3Totals(l3)
          const att = attPct(t.budget, t.consumed)

          // Chart data filtered to <= reportingMonth
          const chartLabels = [], chartBudget = [], chartConsumed = [], chartAttainment = []
          const contract = l3.contract ?? {}
          for (const yr of Object.keys(contract).filter(k => k !== 'contract_insights').sort()) {
            for (const mo of contract[yr] ?? []) {
              const yyyymm = monthToYYYYMM(yr, mo.month)
              if (yyyymm === null) continue
              if (reportingMonth && yyyymm > reportingMonth) continue
              chartLabels.push(`${mo.month} ${yr}`)
              chartBudget.push(mo.budget_contract_value ?? 0)
              chartConsumed.push(mo.consumed_contract_value ?? 0)
              chartAttainment.push(mo.variances?.budget_attainment ?? null)
            }
          }

          l3ChartData[`${l2Key}-l3${l3Idx}`] = {
            labels: chartLabels,
            budget: chartBudget,
            consumed: chartConsumed,
            attainment: chartAttainment,
          }

          return {
            lprId: l3.lpr_id ?? '',
            lprName: l3.lpr_name ?? '',
            attainment: att,
            budget: t.budget,
            consumed: t.consumed,
            acv: t.acv,
            contractInsights: l3.contract?.contract_insights ?? [],
          }
        })

        drawerData[l2Key] = {
          custName: cust.customer,
          l1Name: l1.name,
          l2Name: l2.name,
          saInsights,
          l3List,
        }
      })
    })
  })

  return { drawerData, l3ChartData }
}

// ── Build IND_CHART_DATA ───────────────────────────────────────────────────────
function buildIndChartData(indInsights, customers) {
  return indInsights.map(ind => {
    const indCustomers = customers.filter(c => c.industry === ind.industry)
    const labels = [], budget = [], consumed = [], acv = []
    for (const c of indCustomers) {
      const t = customerTotals(c)
      labels.push(c.customer)
      budget.push(t.budget)
      consumed.push(t.consumed)
      acv.push(t.acv)
    }
    return { labels, budget, consumed, acv }
  })
}

// ── Build ACCT_BAR_DATA and L1_BAR_DATA for browser ──────────────────────────
function buildAcctBarData(customers) {
  return customers.map((cust, custIdx) => {
    const t = customerTotals(cust)
    const att = attPct(t.budget, t.consumed)
    return { budget: t.budget, consumed: t.consumed, acv: t.acv, attainment: att }
  })
}

function buildL1BarData(customers) {
  const data = {}
  customers.forEach((cust, custIdx) => {
    ;(cust.solutions_l1 ?? []).forEach((l1, l1Idx) => {
      const t = l1Totals(l1)
      data[`${custIdx}-${l1Idx}`] = { budget: t.budget, consumed: t.consumed }
    })
  })
  return data
}

// ── Build L2_BAR_DATA for drawer ──────────────────────────────────────────────
function buildL2BarData(customers) {
  const data = {}
  customers.forEach((cust, custIdx) => {
    ;(cust.solutions_l1 ?? []).forEach((l1, l1Idx) => {
      ;(l1.solutions_l2 ?? []).forEach((l2, l2Idx) => {
        ;(l2.solutions_l3 ?? []).forEach((l3, l3Idx) => {
          const t = l3Totals(l3)
          data[`${custIdx}-${l1Idx}-${l2Idx}-${l3Idx}`] = { budget: t.budget, consumed: t.consumed }
        })
      })
    })
  })
  return data
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN HTML BUILDER
// ═══════════════════════════════════════════════════════════════════════════════

// @contract input: portfolio object + asset strings → output: complete HTML string
function buildHtml(portfolio, bootstrapCss, bootstrapJs, iconsCss, chartJs, nunitoCss = '') {
  const customers      = portfolio.customers ?? []
  const indInsights    = portfolio.industry_insights ?? []
  const reportingMonth = portfolio.reporting_month ? parseInt(String(portfolio.reporting_month), 10) : null
  const rmDisplay      = reportingMonthDisplay(portfolio.reporting_month)
  const fy             = portfolio.fiscal_year ?? 'FY—'

  // Set YTD filter so all aggregation helpers exclude future months
  _reportingMonth = reportingMonth

  // Portfolio totals
  let portAcv = 0, portBudget = 0, portConsumed = 0
  for (const c of customers) {
    const t = customerTotals(c)
    portAcv += t.acv; portBudget += t.budget; portConsumed += t.consumed
  }
  const portAtt = attPct(portBudget, portConsumed)
  const portAttColor = healthColor(portAtt)

  // Build views
  const accountsHtml = buildAccountsView(customers)
  const industryHtml = buildIndustryView(indInsights, customers)

  // Build data for browser JS
  const { drawerData, l3ChartData } = buildDrawerData(customers, reportingMonth)
  const indChartData = buildIndChartData(indInsights, customers)
  const acctBarData  = buildAcctBarData(customers)
  const l1BarData    = buildL1BarData(customers)
  const l2BarData    = buildL2BarData(customers)

  // Portfolio meta for browser
  const portfolioMeta = {
    reportingMonth: rmDisplay,
    fiscalYear: fy,
    totalAcv: portAcv,
    totalBudget: portBudget,
    totalConsumed: portConsumed,
    totalAttainment: portAtt,
  }

  // Change 4: topnav pills reordered Consumed · Budget · ACV
  // Change 1: light theme throughout HTML

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAP Signal Board — ${esc(fy)}</title>
<style>${bootstrapCss}</style>
<style>${iconsCss}</style>
${nunitoCss ? `<style>${nunitoCss}</style>` : ''}
<style>
*, *::before, *::after { border-radius: 0 !important; box-shadow: none !important; }
body { margin: 0; background: #ffffff; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.signal-row:hover { background: #f1f5f9 !important; }
</style>
</head>
<body>

<!-- TOP NAV -->
<div id="topnav" style="position:sticky;top:0;z-index:200;background:#f8fafc;border-bottom:1px solid #cbd5e1;display:flex;align-items:center;justify-content:space-between;padding:0 32px;height:52px">
  <div style="display:flex;align-items:center;gap:24px">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#0f172a">SAP Portfolio Briefing</span>
    <span style="color:#cbd5e1">|</span>
    <span style="font-size:11px;color:#64748b">${esc(rmDisplay)} · ${esc(fy)}</span>
    <span style="color:#cbd5e1">|</span>
  </div>
  <div style="display:flex;gap:0">
    <button id="tab-industry" onclick="showView('industry')" style="padding:0 20px;height:52px;background:transparent;border:none;border-bottom:2px solid #0f172a;color:#0f172a;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer">INDUSTRY</button>
    <button id="tab-accounts" onclick="showView('accounts')" style="padding:0 20px;height:52px;background:transparent;border:none;border-bottom:2px solid transparent;color:#94a3b8;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer">ACCOUNTS</button>
  </div>
  <div style="display:flex;gap:16px;font-size:11px">
    <span style="color:#ea580c">Consumed <strong style="color:#fb923c">${esc(usd(portConsumed))}</strong></span>
    <span style="color:#16a34a">Budget <strong style="color:#22c55e">${esc(usd(portBudget))}</strong></span>
    <span style="color:#9ca3af">ACV <strong style="color:#9ca3af">${esc(usd(portAcv))}</strong></span>
  </div>
</div>

<!-- VIEW CONTAINERS -->
<div id="view-accounts" style="display:none">
${accountsHtml}
</div>
<div id="view-industry" style="display:block">
${industryHtml}
</div>

<!-- DRAWER -->
<div id="drawer" style="position:fixed;bottom:0;left:0;right:0;height:0;background:#f1f5f9;border-top:2px solid #cbd5e1;overflow:hidden;z-index:300;transition:height 0.15s ease">
  <div id="drawer-inner" style="height:100%;display:flex;flex-direction:column"></div>
</div>

<script>${chartJs}</script>
<script>${bootstrapJs}</script>
<script>
// ── Embedded data ─────────────────────────────────────────────────────────────
var DRAWER_DATA    = ${jsonEmbed(drawerData)};
var L3_CHART_DATA  = ${jsonEmbed(l3ChartData)};
var IND_CHART_DATA = ${jsonEmbed(indChartData)};
var PORTFOLIO_META = ${jsonEmbed(portfolioMeta)};
var ACCT_BAR_DATA  = ${jsonEmbed(acctBarData)};
var L1_BAR_DATA    = ${jsonEmbed(l1BarData)};
var L2_BAR_DATA    = ${jsonEmbed(l2BarData)};

// ── State ─────────────────────────────────────────────────────────────────────
var currentView    = 'industry';
var currentCust    = 0;
var currentInd     = 0;
var drawerState    = null;   // {custIdx, l1Idx} or {custIdx, l1Idx, l2Idx, l3Idx}
var indChartInst   = {};     // Chart.js instances for industry charts
var acctBarInst    = {};     // Chart.js instances for account bars
var l1BarInst      = {};     // Chart.js instances for L1 bars
var l2BarInst      = {};     // Chart.js instances for L2 bars

// ── Utilities ─────────────────────────────────────────────────────────────────
function fmtUsd(n) {
  if (n == null || isNaN(n)) return '—';
  var a = Math.abs(n);
  if (a >= 1e6) return (n < 0 ? '-' : '') + '$' + (Math.abs(n)/1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n < 0 ? '-' : '') + '$' + Math.round(Math.abs(n)/1e3) + 'K';
  return '$' + Math.round(n).toLocaleString('en-US');
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  return Number(v).toFixed(1) + '%';
}
function healthColor(att) {
  return att >= 80 ? '#22c55e' : att >= 50 ? '#f59e0b' : '#ef4444';
}
function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function trunc(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n-1) + '\\u2026' : s;
}

// ── View tabs ─────────────────────────────────────────────────────────────────
function showView(v) {
  currentView = v;
  ['signals','accounts','industry'].forEach(function(name) {
    var el = document.getElementById('view-' + name);
    if (el) el.style.display = name === v ? 'block' : 'none';
    var tab = document.getElementById('tab-' + name);
    if (tab) {
      tab.style.borderBottom = name === v ? '2px solid #0f172a' : '2px solid transparent';
      tab.style.color = name === v ? '#0f172a' : '#94a3b8';
    }
  });
  // Change 6: call renderIndChart directly — no setTimeout
  if (v === 'industry') {
    renderIndChart(currentInd);
  }
  closeDrawer();
}

// ── Customer switcher ─────────────────────────────────────────────────────────
function showCustomer(idx) {
  currentCust = idx;
  // Change 1: light theme active tab colours
  document.querySelectorAll('.cust-tab').forEach(function(btn) {
    var active = parseInt(btn.dataset.cust) === idx;
    btn.style.background = active ? '#f1f5f9' : 'transparent';
    btn.style.color = active ? '#0f172a' : '#64748b';
  });
  document.querySelectorAll('[id^="cust-panel-"]').forEach(function(el) {
    el.style.display = 'none';
  });
  var panel = document.getElementById('cust-panel-' + idx);
  if (panel) panel.style.display = 'block';
  // Change 5: initialize account bar and L1 bars
  setTimeout(function() {
    renderAcctBar(idx);

  }, 0);
}

// ── Industry switcher ─────────────────────────────────────────────────────────
function showIndustry(idx) {
  currentInd = idx;
  // Change 1: light theme active tab colours
  document.querySelectorAll('.ind-tab').forEach(function(btn) {
    var active = parseInt(btn.dataset.ind) === idx;
    btn.style.background = active ? '#f1f5f9' : 'transparent';
    btn.style.color = active ? '#0f172a' : '#64748b';
  });
  document.querySelectorAll('[id^="ind-panel-"]').forEach(function(el) {
    el.style.display = 'none';
  });
  var panel = document.getElementById('ind-panel-' + idx);
  if (panel) panel.style.display = 'block';
  // Change 6: call renderIndChart directly — no setTimeout
  renderIndChart(idx);
}

// ── Signal filter — Change 3: handle customer group headers and industry section ──
function filterSignals(level) {
  // Update button styles
  document.querySelectorAll('.sig-filter').forEach(function(b) {
    var active = b.dataset.filter === level;
    b.style.background = active ? '#0f172a' : 'transparent';
    b.style.color = active ? '#ffffff' : '#64748b';
    b.style.borderColor = active ? '#0f172a' : '#cbd5e1';
  });
  // Show/hide signal rows and collapse expansions
  document.querySelectorAll('.signal-row').forEach(function(el) {
    el.style.display = (level === 'ALL' || el.dataset.level === level) ? 'flex' : 'none';
  });
  document.querySelectorAll('.signal-expand').forEach(function(el) {
    el.style.display = 'none';
  });
  // Show/hide customer group headers based on whether any of their signals are visible
  document.querySelectorAll('.cust-group-header').forEach(function(header) {
    var custIdx = header.dataset.cust;
    var hasVisible = Array.from(document.querySelectorAll('.signal-row[data-cust="' + custIdx + '"]'))
      .some(function(r) { return r.style.display !== 'none'; });
    header.style.display = hasVisible ? 'flex' : 'none';
  });
  // Industry section header
  var indHeader = document.querySelector('.ind-section-header');
  if (indHeader) {
    var hasIndVisible = Array.from(document.querySelectorAll('.signal-row[data-level="INDUSTRY"]'))
      .some(function(r) { return r.style.display !== 'none'; });
    indHeader.style.display = hasIndVisible ? 'block' : 'none';
  }
}

// ── Signal toggle ─────────────────────────────────────────────────────────────
function toggleSignal(row) {
  var expand = row.nextElementSibling;
  var isOpen = expand.style.display !== 'none';
  document.querySelectorAll('.signal-expand').forEach(function(e) { e.style.display = 'none'; });
  if (!isOpen) {
    expand.style.display = 'block';
    var sparkCanvas = expand.querySelector('canvas[data-sparkline]');
    if (sparkCanvas && sparkCanvas.dataset.sparkline) {
      try {
        renderSparkline(sparkCanvas, JSON.parse(sparkCanvas.dataset.sparkline));
      } catch(e) {}
    }
  }
}

// ── Account bar chart (Change 5) ─────────────────────────────────────────────
function renderAcctBar(custIdx) {
  var canvas = document.getElementById('acct-bar-' + custIdx);
  var d = ACCT_BAR_DATA[custIdx];
  if (!d) return;
  renderDonut(canvas, d.budget, d.consumed, d.acv, 180);
}

// ── L1 bar charts (Change 5) ──────────────────────────────────────────────────
// ── Shared donut renderer — matches the spec image exactly ───────────────────
// size: canvas pixel size (square). budget/consumed/acv in dollars. showLabels: show Budget/Consumed/ACV lines below.
function renderDonut(canvas, budget, consumed, acv, size) {
  if (!canvas) return;
  if (canvas._donutChart) { try { canvas._donutChart.destroy(); } catch(e){} canvas._donutChart = null; }
  size = size || 120;
  canvas.width  = size;
  canvas.height = size;
  var remaining = Math.max(0, budget - consumed);
  var att = budget > 0 ? Math.round(consumed / budget * 100) : null;
  var attLabel = att != null ? att + '%' : '—';
  var attColor = '#60a5fa';
  var pctFontSize = Math.floor(size * 0.19);
  var pctOffsetY  = 0;

  // Inline plugin draws centre text on every render (including hover redraws)
  var centreTextPlugin = {
    id: 'centreText',
    afterDraw: function(chart) {
      var ctx2 = chart.ctx;
      var cx = chart.width  / 2;
      var cy = chart.height / 2;
      ctx2.save();
      ctx2.textAlign = 'center';
      ctx2.textBaseline = 'middle';
      ctx2.fillStyle = attColor;
      ctx2.font = 'bold ' + pctFontSize + 'px -apple-system,BlinkMacSystemFont,sans-serif';
      ctx2.fillText(attLabel, cx, cy);
      ctx2.restore();
    }
  };

  canvas._donutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Consumed', 'Remaining'],
      datasets: [{
        data: [consumed > 0 ? consumed : 0, remaining > 0 ? remaining : (budget > 0 ? budget : 1)],
        backgroundColor: ['#fb923c', '#e8edf2'],
        borderWidth: 0,
        hoverOffset: 0
      }]
    },
    options: {
      responsive: false,
      animation: { duration: 0 },
      cutout: '74%',
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return ctx.label + ': ' + fmtUsd(ctx.raw); } } }
      }
    },
    plugins: [centreTextPlugin]
  });
}

function renderL1Bars(custIdx) {
  var prefix = custIdx + '-';
  Object.keys(L1_BAR_DATA).forEach(function(key) {
    if (key.indexOf(prefix) !== 0) return;
    var parts = key.split('-');
    var l1Idx = parts[1];
    var canvas = document.getElementById('l1-bar-' + custIdx + '-' + l1Idx);
    var d = L1_BAR_DATA[key];
    if (!d) return;
    renderDonut(canvas, d.budget, d.consumed, d.acv || 0, 90);
  });
}

// ── Industry chart — Change 6: responsive:false, explicit pixel dims ──────────
function renderIndChart(idx) {
  var d = IND_CHART_DATA[idx];
  if (!d || !d.labels || d.labels.length === 0) return;
  (indChartInst[idx] || []);
  indChartInst[idx] = [];
  d.labels.forEach(function(label, i) {
    var canvas = document.getElementById('ind-donut-' + idx + '-' + i);
    if (!canvas) return;
    renderDonut(canvas, d.budget[i] || 0, d.consumed[i] || 0, d.acv ? (d.acv[i] || 0) : 0, 160);
  });
}

// ── L3 chart ──────────────────────────────────────────────────────────────────
var _drawerChart = null;
function renderL3Chart(data) {
  var canvas = document.getElementById('chart-l3');
  if (!canvas) return;
  if (_drawerChart) { try { _drawerChart.destroy(); } catch(e){} _drawerChart = null; }
  if (!data || !data.labels || data.labels.length === 0) {
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 18px -apple-system,BlinkMacSystemFont,sans-serif';
    ctx.fillText('No chart data available', canvas.width / 2, canvas.height / 2);
    return;
  }
  Chart.defaults.color = '#64748b';
  _drawerChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: data.labels,
      datasets: [
        { type: 'line', label: 'Budget',      data: data.budget,     borderColor: '#16a34a', backgroundColor: 'transparent', yAxisID: 'y', tension: 0.3, pointRadius: 3, pointBackgroundColor: '#16a34a' },
        { type: 'line', label: 'Consumed',    data: data.consumed,   borderColor: '#ea580c', backgroundColor: 'transparent', yAxisID: 'y', tension: 0.3, pointRadius: 3, pointBackgroundColor: '#ea580c' },
        { type: 'bar',  label: 'Attainment%', data: data.attainment, backgroundColor: 'rgba(167,139,250,0.25)', yAxisID: 'y2' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return ctx.dataset.yAxisID === 'y2' ? fmtPct(ctx.raw) : ' ' + fmtUsd(ctx.raw); } } }
      },
      scales: {
        y:  { position: 'left',  ticks: { color: '#64748b', font: { size: 9 }, callback: function(v){ return fmtUsd(v); } }, grid: { color: '#e2e8f0' }, border: { display: false } },
        y2: { position: 'right', min: 0, max: 150, ticks: { color: '#64748b', font: { size: 9 }, callback: function(v){ return v + '%'; } }, grid: { drawOnChartArea: false }, border: { display: false } },
        x:  { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: '#e2e8f0' }, border: { display: false } }
      }
    }
  });
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
var _sparkCharts = [];
function renderSparkline(canvas, data) {
  if (canvas._sparkChart) { try { canvas._sparkChart.destroy(); } catch(e){} canvas._sparkChart = null; }
  if (!data || !data.labels || data.labels.length === 0) return;
  canvas._sparkChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: data.labels,
      datasets: [{ data: data.consumed, borderColor: '#ea580c', backgroundColor: 'transparent', tension: 0.3, pointRadius: 0, borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 0 },
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}

// ── Drawer: open L1 view ──────────────────────────────────────────────────────
function openL1(custIdx, l1Idx) {
  drawerState = { custIdx: custIdx, l1Idx: l1Idx, level: 'l1' };
  var key  = 'c' + custIdx + '-l1' + l1Idx;
  var data = DRAWER_DATA[key];
  if (!data) return;

  var inner = document.getElementById('drawer-inner');
  var header = '<div style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:0 32px;height:44px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">'
    + '<span style="font-size:11px;color:#64748b">' + escHtml(data.custName) + ' <span style="color:#cbd5e1">›</span> <strong style="color:#34d399">' + escHtml(data.l1Name) + '</strong></span>'
    + '<button onclick="closeDrawer()" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;line-height:1">×</button>'
    + '</div>';

  // L2 cards: donut header (metrics) + solution insights body
  var l2CardHtml = data.l2Tiles.map(function(tile) {
    var saRows = (tile.saInsights || []).map(function(s) {
      return '<div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #e2e8f0">'
        + '<span style="font-size:13.5px;color:#0f172a;line-height:1.4" class="insight-text">' + escHtml(s) + '</span>'
        + '</div>';
    }).join('') || '<div style="font-size:11px;color:#94a3b8;font-style:italic;padding:5px 0">No solution insights</div>';

    var attPctVal = tile.budget > 0 ? (tile.consumed / tile.budget * 100) : null;
    var consumedBarW = attPctVal != null ? Math.min(100, attPctVal).toFixed(1) : 0;
    return '<div style="border:1px solid #e2e8f0;min-width:200px;flex:1;max-width:320px;overflow:hidden">'
      + '<div onclick="openL2(' + custIdx + ',' + l1Idx + ',' + tile.l2Idx + ')" style="cursor:pointer;background:#f8fafc;padding:14px 16px;border-bottom:1px solid #e2e8f0">'
      + '<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Sub-Solution Area</div>'
      + '<div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:8px">' + escHtml(tile.name) + '</div>'
      + '<div style="font-size:22px;font-weight:800;color:#60a5fa;line-height:1">' + (attPctVal != null ? attPctVal.toFixed(1) + '%' : '—') + '</div>'
      + '<div style="font-size:11px;color:#94a3b8;margin-bottom:12px">Budget Attainment</div>'
      + '<div style="margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;color:#22c55e;margin-bottom:3px"><span>Budget</span><span>' + fmtUsd(tile.budget) + '</span></div>'
      + '<div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#22c55e;width:100%"></div></div>'
      + '</div>'
      + '<div style="margin-bottom:4px">'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;color:#fb923c;margin-bottom:3px"><span>Consumed</span><span>' + fmtUsd(tile.consumed) + '</span></div>'
      + '<div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#fb923c;width:' + consumedBarW + '%"></div></div>'
      + '</div>'
      + '<div style="font-size:12px;color:#94a3b8;margin-top:6px">ACV: ' + fmtUsd(tile.acv || 0) + '</div>'
      + '</div>'
      + '<div style="padding:10px 14px;background:white">'
      + '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#fb923c;margin-bottom:5px">Solution Insights</div>'
      + saRows
      + '</div>'
      + '</div>';
  }).join('');

  var body = '<div style="flex:1;overflow-y:auto;padding:20px 24px">'
    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:12px">Sub-Solution Areas — click to drill in</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:8px">' + l2CardHtml + '</div>'
    + '</div>';

  inner.innerHTML = header + '<div style="display:flex;flex:1;overflow:hidden">' + body + '</div>';
  document.getElementById('drawer').style.height = '65vh';

}

// ── Drawer: open L2/L3 view ───────────────────────────────────────────────────
function openL2(custIdx, l1Idx, l2Idx) {
  drawerState = { custIdx: custIdx, l1Idx: l1Idx, l2Idx: l2Idx, l3Idx: 0, level: 'l2' };
  var l1Key = 'c' + custIdx + '-l1' + l1Idx;
  var l2Key = 'c' + custIdx + '-l1' + l1Idx + '-l2' + l2Idx;
  var l1Data = DRAWER_DATA[l1Key];
  var data   = DRAWER_DATA[l2Key];
  if (!data) return;

  var inner = document.getElementById('drawer-inner');

  // Change 1: light theme header
  var header = '<div style="background:#f8fafc;border-bottom:1px solid #cbd5e1;padding:0 32px;height:44px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">'
    + '<span style="font-size:11px;color:#64748b">'
    + escHtml(data.custName) + ' <span style="color:#cbd5e1">›</span> '
    + '<span onclick="openL1(' + custIdx + ',' + l1Idx + ')" style="cursor:pointer;color:#34d399">' + escHtml(data.l1Name) + '</span>'
    + ' <span style="color:#cbd5e1">›</span> <strong style="color:#fb923c">' + escHtml(data.l2Name) + '</strong>'
    + '</span>'
    + '<button onclick="closeDrawer()" style="background:none;border:none;color:#94a3b8;font-size:18px;cursor:pointer;line-height:1">×</button>'
    + '</div>';

  // Change 1: light theme L3 tabs; Change 2: donut + metrics above LPR name
  var l3Tabs = data.l3List.map(function(l3, i) {
    var active = i === 0;
    var l3Att = l3.budget > 0 ? (l3.consumed / l3.budget * 100) : null;
    var l3BarW = l3Att != null ? Math.min(100, l3Att).toFixed(1) : 0;
    return '<div class="l3-tab" data-l3idx="' + i + '" onclick="selectL3(' + i + ')"'
      + ' style="padding:12px;cursor:pointer;border-bottom:1px solid #e2e8f0;border-left:3px solid '
      + (active ? '#fb923c' : 'transparent') + ';background:' + (active ? '#f1f5f9' : 'transparent') + '">'
      + '<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">Solution</div>'
      + '<div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:6px;line-height:1.3">' + escHtml(trunc(l3.lprName, 26)) + '</div>'
      + '<div style="font-size:18px;font-weight:800;color:#60a5fa;line-height:1">' + (l3Att != null ? l3Att.toFixed(1) + '%' : '—') + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-bottom:8px">Budget Attainment</div>'
      + '<div style="margin-bottom:5px">'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#22c55e;margin-bottom:2px"><span>Budget</span><span>' + fmtUsd(l3.budget) + '</span></div>'
      + '<div style="height:4px;background:#e2e8f0"><div style="height:4px;background:#22c55e;width:100%"></div></div>'
      + '</div>'
      + '<div style="margin-bottom:4px">'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#fb923c;margin-bottom:2px"><span>Consumed</span><span>' + fmtUsd(l3.consumed) + '</span></div>'
      + '<div style="height:4px;background:#e2e8f0"><div style="height:4px;background:#fb923c;width:' + l3BarW + '%"></div></div>'
      + '</div>'
      + '<div style="font-size:11px;color:#94a3b8">ACV: ' + fmtUsd(l3.acv) + '</div>'
      + '</div>';
  }).join('');

  var body = '<div style="display:flex;flex:1;overflow:hidden">'
    + '<div id="drawer-l3-tabs" style="width:260px;border-right:1px solid #cbd5e1;overflow-y:auto;flex-shrink:0">' + l3Tabs + '</div>'
    + '<div id="drawer-l3-panel" style="flex:1;overflow-y:auto;padding:16px 24px"></div>'
    + '</div>';

  inner.innerHTML = header + body;
  document.getElementById('drawer').style.height = '65vh';
  renderL3PanelContent(0, data, custIdx, l1Idx, l2Idx);
}

function selectL3(l3Idx) {
  if (!drawerState) return;
  drawerState.l3Idx = l3Idx;
  var l2Key = 'c' + drawerState.custIdx + '-l1' + drawerState.l1Idx + '-l2' + drawerState.l2Idx;
  var data = DRAWER_DATA[l2Key];
  // Change 1: light theme tab highlight
  document.querySelectorAll('.l3-tab').forEach(function(el, i) {
    var active = i === l3Idx;
    el.style.background = active ? '#f1f5f9' : 'transparent';
    el.style.color = active ? '#0f172a' : '#64748b';
    el.style.borderLeft = active ? '3px solid #fb923c' : '3px solid transparent';
  });
  renderL3PanelContent(l3Idx, data, drawerState.custIdx, drawerState.l1Idx, drawerState.l2Idx);
}

function renderL3PanelContent(l3Idx, data, custIdx, l1Idx, l2Idx) {
  var l3 = data.l3List[l3Idx];
  if (!l3) return;
  var panel = document.getElementById('drawer-l3-panel');
  if (!panel) return;
  var att = l3.budget > 0 ? (l3.consumed / l3.budget * 100) : null;
  var budgetWidth = 100;
  var consumedWidth = l3.budget > 0 ? Math.min(100, (l3.consumed / l3.budget) * 100) : 0;

  // Change 1: light theme contract insights
  var insightRows = l3.contractInsights.map(function(s) {
    return '<div style="padding:10px 0;border-bottom:1px solid #e2e8f0;border-left:3px solid #94a3b8;padding-left:12px;font-size:13.5px;color:#0f172a;line-height:1.4" class="insight-text">' + escHtml(s) + '</div>';
  }).join('') || '<div style="font-size:13px;color:#94a3b8;font-style:italic;padding:8px 0">No contract insights</div>';

  // Change 4: metric order Consumed first, then Budget, then ACV, then Attainment
  // Change 5: L2 bar canvas
  var l2BarKey = custIdx + '-' + l1Idx + '-' + l2Idx + '-' + l3Idx;
  panel.innerHTML = '<div style="margin-bottom:12px">'
    + '<div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:2px">' + escHtml(l3.lprName) + '</div>'
    + '<div style="font-size:11px;color:#64748b">' + escHtml(l3.lprId) + '</div>'
    + '</div>'
    + '<div style="position:relative;height:180px;margin-bottom:16px"><canvas id="chart-l3" style="height:180px;width:100%"></canvas></div>'
    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#64748b;margin-bottom:12px">Contract Insights</div>'
    + insightRows;

  var chartKey = 'c' + custIdx + '-l1' + l1Idx + '-l2' + l2Idx + '-l3' + l3Idx;
  var chartData = L3_CHART_DATA[chartKey];
  setTimeout(function() {
    renderL3Chart(chartData);
  }, 0);
}

// ── Drawer close ──────────────────────────────────────────────────────────────
function closeDrawer() {
  document.getElementById('drawer').style.height = '0';
  drawerState = null;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  showIndustry(0);
  showCustomer(0);
});
</script>
</body>
</html>`
}

// ── run() — tool entry point ──────────────────────────────────────────────────
// @entry run(args, options) | --dashboard <portfolio.json>
// @contract input: args[0] = portfolio JSON path → output: HTML written to <dir>/<basename>-dashboard.html | errors: UserError (exit 1), ProcessingError (exit 2)
export async function run(args, options) {
  const inputPath = args[0]
  if (!inputPath) throw new UserError('--dashboard requires a portfolio JSON file path argument')
  if (!existsSync(inputPath)) throw new UserError(`file not found: ${inputPath}`)

  let portfolio
  try {
    const raw = readFileSync(inputPath, 'utf8')
    portfolio = JSON.parse(raw)
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new ProcessingError(`malformed JSON in ${inputPath}: ${err.message}`)
    }
    throw new ProcessingError(`failed to read ${inputPath}: ${err.message}`)
  }

  const baseName   = path.basename(inputPath, path.extname(inputPath))
  const outputPath = options?.output ?? path.join(path.dirname(inputPath), `${baseName}-dashboard.html`)

  process.stderr.write(`warn: loading assets from node_modules…\n`)
  let bootstrapCss = '', bootstrapJs = '', iconsCss = '', chartJs = ''
  try {
    bootstrapCss = readFileSync(BOOTSTRAP_CSS_PATH, 'utf8')
    process.stderr.write(`warn: Bootstrap CSS loaded (${Buffer.byteLength(bootstrapCss, 'utf8')} bytes)\n`)
  } catch (e) {
    process.stderr.write(`warn: Bootstrap CSS not found — run npm install to get bootstrap\n`)
  }
  try {
    bootstrapJs = readFileSync(BOOTSTRAP_JS_PATH, 'utf8')
    process.stderr.write(`warn: Bootstrap JS loaded (${Buffer.byteLength(bootstrapJs, 'utf8')} bytes)\n`)
  } catch (e) {
    process.stderr.write(`warn: Bootstrap JS not found\n`)
  }
  try {
    iconsCss = loadIconsCss()
    process.stderr.write(`warn: Bootstrap Icons loaded\n`)
  } catch (e) {
    process.stderr.write(`warn: Bootstrap Icons not found: ${e.message}\n`)
  }
  try {
    chartJs = readFileSync(CHARTJS_PATH, 'utf8')
    process.stderr.write(`warn: Chart.js loaded (${Buffer.byteLength(chartJs, 'utf8')} bytes)\n`)
  } catch (e) {
    process.stderr.write(`warn: Chart.js not found\n`)
  }

  let nunitoCss = ''
  try {
    nunitoCss = loadNunitoCss()
    process.stderr.write(`warn: Nunito Sans loaded\n`)
  } catch (e) {
    process.stderr.write(`warn: Nunito Sans not found: ${e.message}\n`)
  }

  process.stderr.write(`warn: generating The Signal Board HTML dashboard…\n`)
  const html = buildHtml(portfolio, bootstrapCss, bootstrapJs, iconsCss, chartJs, nunitoCss)

  try {
    writeFileSync(outputPath, html, 'utf8')
  } catch (err) {
    throw new ProcessingError(`failed to write ${outputPath}: ${err.message}`)
  }

  process.stdout.write(`${outputPath}\n`)
  process.stderr.write(`warn: dashboard written — ${Buffer.byteLength(html, 'utf8')} bytes\n`)
}
