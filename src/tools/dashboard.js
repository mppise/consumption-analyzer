// @story STORY-005 | dashboard
// @intent generates a self-contained single-file HTML dashboard with sticky top nav,
//         two views (Industry, Accounts), an L1/L2/L3 drill drawer, and zero internet dependency;
//         Bootstrap CSS/JS/Icons + Chart.js inlined from node_modules
// @gap 2026-06-29 Full-Year ACV/Budget/Consumed derived from L3 contract month records
//      (projected_annual_* fields stamped on every month by --transform);
//      customerAnnualBudget() and l1AnnualBudget() replaced by l3 walk helpers; variance field names updated to ytd_* prefix

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

// ── Semantic color constants — Option M: Deep Sea ─────────────────────────────
const C_ACV      = '#8ecae6'  // pale sky
const C_BUDGET   = '#2a9d8f'  // deep sea teal
const C_CONSUMED = '#ff8c69'  // salmon
const C_PCT      = '#1d4ed8'
const C_PROJ_CONSUMED = '#ff8c69'  // matches consumed

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

// ── Insight prefix parser ─────────────────────────────────────────────────────
// Strips leading [insight] or [action] prefix and returns { type, text, html }
// type: 'insight' | 'action' | 'unknown'
// html: ready-to-embed span with icon badge + text
const INSIGHT_ICON = 'bi-lightbulb'
const ACTION_ICON  = 'bi-lightning-charge-fill'
const INSIGHT_COLOR = '#ff8c69'  // wheat
const ACTION_COLOR  = '#2a9d8f'  // sage
const INSIGHT_BG    = '#fff5f2'
const ACTION_BG     = '#f0faf9'

function parseInsight(raw) {
  if (!raw) return { type: 'unknown', text: '', html: '' }
  const s = String(raw)
  let type = 'unknown', text = s
  if (s.startsWith('[insight]')) { type = 'insight'; text = s.slice(9).trimStart() }
  else if (s.startsWith('[action]')) { type = 'action';  text = s.slice(8).trimStart() }
  const icon  = type === 'action' ? ACTION_ICON  : type === 'insight' ? INSIGHT_ICON  : 'bi-info-circle'
  const color = type === 'action' ? ACTION_COLOR : type === 'insight' ? INSIGHT_COLOR : '#94a3b8'
  const badge = type !== 'unknown'
    ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${color};background:${color}18;padding:1px 5px;margin-right:6px;vertical-align:middle;flex-shrink:0"><i class="bi ${icon}" style="font-size:10px"></i>${type}</span>`
    : ''
  const html = `${badge}<span class="insight-text" style="font-size:13.5px;color:#0f172a;line-height:1.4">${esc(text)}</span>`
  return { type, text, html }
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
// ytd_annual_contract_value is a monthly ACV portion — sum across YTD months per L3+year.
function l3Totals(l3) {
  let acv = 0, budget = 0, consumed = 0
  const c = l3.contract ?? {}
  for (const year of Object.keys(c)) {
    if (year === 'contract_insights') continue
    const ytdMonths = (c[year] ?? []).filter(mo => isYtd(year, mo.month))
    if (!ytdMonths.length) continue
    acv      += ytdMonths.reduce((s, mo) => s + (mo.ytd_annual_contract_value   ?? 0), 0)
    budget   += ytdMonths.reduce((s, mo) => s + (mo.ytd_budget_contract_value   ?? 0), 0)
    consumed += ytdMonths.reduce((s, mo) => s + (mo.ytd_consumed_contract_value ?? 0), 0)
  }
  return { acv, budget, consumed }
}

function l2Totals(l2) {
  let acv = 0, budget = 0, consumed = 0
  for (const l3 of l2.solutions_l3 ?? []) {
    const t = l3Totals(l3)
    acv += t.acv; budget += t.budget; consumed += t.consumed
  }
  return { acv, budget, consumed }
}

function l1Totals(l1) {
  let acv = 0, budget = 0, consumed = 0
  for (const l2 of l1.solutions_l2 ?? []) {
    const t = l2Totals(l2)
    acv += t.acv; budget += t.budget; consumed += t.consumed
  }
  return { acv, budget, consumed }
}

function customerTotals(customer) {
  let acv = 0, budget = 0, consumed = 0
  for (const l1 of customer.solutions_l1 ?? []) {
    const t = l1Totals(l1)
    acv += t.acv; budget += t.budget; consumed += t.consumed
  }
  return { acv, budget, consumed }
}

function attPct(budget, consumed) {
  return budget > 0 ? (consumed / budget * 100) : null
}

// ── Projected aggregation from L3 projected_annual_* fields ──────────────────
// Projected ACV:      extrapolate YTD ACV to full year: (ytdAcv / monthsElapsed) * 12
//                     monthsElapsed derived from _reportingMonth (YYYYMM → last 2 digits)
// Projected Budget:   max(projected_annual_budget_contract_value) per L3 per year
// Projected Consumed: max(projected_annual_consumed_contract_value) per L3 per year
// @contract input: l3 node → output: { annualAcv, annualBudget, annualConsumed }
function l3AnnualTotals(l3) {
  let annualAcv = 0, annualBudget = 0, annualConsumed = 0
  const monthsElapsed = _reportingMonth ? (_reportingMonth % 100) : 12
  const c = l3.contract ?? {}
  for (const year of Object.keys(c)) {
    if (year === 'contract_insights') continue
    const months = (c[year] ?? [])
    if (!months.length) continue
    const ytdMonths = months.filter(mo => isYtd(year, mo.month))
    const ytdAcv = ytdMonths.reduce((s, mo) => s + (mo.ytd_annual_contract_value ?? 0), 0)
    annualAcv      += monthsElapsed > 0 ? Math.round(ytdAcv / monthsElapsed * 12 * 100) / 100 : 0
    annualBudget   += Math.max(...months.map(mo => mo.projected_annual_budget_contract_value      ?? 0))
    annualConsumed += Math.max(...months.map(mo => mo.projected_annual_consumed_contract_value    ?? 0))
  }
  return { annualAcv, annualBudget, annualConsumed }
}

// @contract input: l2 node → output: { annualAcv, annualBudget, annualConsumed }
function l2AnnualTotals(l2) {
  let annualAcv = 0, annualBudget = 0, annualConsumed = 0
  for (const l3 of l2.solutions_l3 ?? []) {
    const t = l3AnnualTotals(l3)
    annualAcv += t.annualAcv; annualBudget += t.annualBudget; annualConsumed += t.annualConsumed
  }
  return { annualAcv, annualBudget, annualConsumed }
}

// @contract input: l1 node → output: { annualAcv, annualBudget, annualConsumed }
function l1AnnualTotals(l1) {
  let annualAcv = 0, annualBudget = 0, annualConsumed = 0
  for (const l2 of l1.solutions_l2 ?? []) {
    for (const l3 of l2.solutions_l3 ?? []) {
      const t = l3AnnualTotals(l3)
      annualAcv += t.annualAcv; annualBudget += t.annualBudget; annualConsumed += t.annualConsumed
    }
  }
  return { annualAcv, annualBudget, annualConsumed }
}

// @contract input: customer node → output: { annualAcv, annualBudget, annualConsumed }
function customerAnnualTotals(customer) {
  let annualAcv = 0, annualBudget = 0, annualConsumed = 0
  for (const l1 of customer.solutions_l1 ?? []) {
    const t = l1AnnualTotals(l1)
    annualAcv += t.annualAcv; annualBudget += t.annualBudget; annualConsumed += t.annualConsumed
  }
  return { annualAcv, annualBudget, annualConsumed }
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


// ── Health color ───────────────────────────────────────────────────────────────
function healthColor(att) {
  if (att == null) return '#64748b'
  return att >= 80 ? '#2a9d8f' : att >= 50 ? '#f0a500' : '#e76f51'
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

// ── Build ACCOUNTS VIEW HTML ───────────────────────────────────────────────────
// @contract input: customers[] → output: HTML string
function buildAccountsView(customers) {
  // Change 1: light theme for tabs
  const tabs = customers.map((cust, idx) => {
    const t = customerTotals(cust)
    const att = attPct(t.budget, t.consumed)
    const isFirst = idx === 0
    return `<button onclick="showCustomer(${idx})" class="cust-tab" data-cust="${idx}"
  style="padding:10px 20px;background:${isFirst ? '#e0f2fe' : 'transparent'};border:none;border-bottom:${isFirst ? '3px solid #e0f2fe' : '3px solid transparent'};color:${isFirst ? '#0e7490' : 'rgba(255,255,255,0.8)'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
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
      const saInsights = (l1.solution_architecture_insights ?? [])
      const saRows = saInsights.map(text => {
        const pi = parseInsight(text)
        return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 10px;margin-bottom:4px;border-left:3px solid ${pi.type === 'action' ? ACTION_COLOR : INSIGHT_COLOR};background:${pi.type === 'action' ? ACTION_BG : INSIGHT_BG}">
          <i class="bi ${pi.type === 'action' ? ACTION_ICON : INSIGHT_ICON}" style="font-size:11px;color:${pi.type === 'action' ? ACTION_COLOR : INSIGHT_COLOR};flex-shrink:0;margin-top:2px"></i>
          <span style="font-size:13px;color:#0f172a;line-height:1.4" class="insight-text">${esc(pi.text)}</span>
        </div>`
      }).join('') || `<div style="font-size:11px;color:#94a3b8;font-style:italic;padding:6px 0">No solution insights</div>`
      const l1Annual = l1AnnualTotals(l1)

      return `<div style="border:1px solid #e2e8f0;min-width:200px;flex:1;max-width:320px;overflow:hidden">
  <!-- Card header: bar chart style -->
  <div onclick="openL1(${custIdx},${l1Idx})" style="cursor:pointer;background:#f8fafc;padding:16px;border-bottom:1px solid #e2e8f0">
    <div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Solution Area</div>
    <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:10px">${esc(l1.name)}</div>
    <div style="font-size:22px;font-weight:400;color:#0f172a;line-height:1">${la != null ? pct(la) : '—'}</div>
    <div style="font-size:11px;color:#94a3b8;margin-bottom:14px">YTD Budget Attainment</div>
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#ff8c69;margin-bottom:3px"><span>YTD Consumed</span><span>${usd(lt.consumed)}</span></div>
      <div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#ff8c69;width:${la != null ? Math.min(100, la).toFixed(1) : 0}%"></div></div>
    </div>
    <div style="margin-bottom:4px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#2a9d8f;margin-bottom:3px"><span>YTD Budget</span><span>${usd(lt.budget)}</span></div>
      <div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#2a9d8f;width:100%"></div></div>
    </div>
    <div style="font-size:12px;color:#94a3b8;margin-top:6px">YTD ACV: ${usd(lt.acv)}</div>
    <div style="font-size:11px;color:#64748b;margin-top:6px;padding-top:6px;border-top:1px solid #e2e8f0"><span style="color:#64748b">Projected Consumed: </span><strong style="color:${C_PROJ_CONSUMED}">${usd(l1Annual.annualConsumed)}</strong> · <span style="color:#64748b">Projected Budget: </span><strong style="color:#2a9d8f">${usd(l1Annual.annualBudget)}</strong> · <span style="color:#64748b">Projected ACV: </span><strong style="color:#8ecae6">${usd(l1Annual.annualAcv)}</strong></div>
  </div>
  <!-- Card body: Solution insights -->
  <div style="padding:12px 14px;background:white">
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;font-weight:700;color:#0f172a;margin-bottom:6px">Solution Insights and Actions</div>
    ${saRows}
  </div>
</div>`
    }).join('')

    // EA insight rows at customer level (Step 3)
    const eaInsightRows = (cust.enterprise_architecture_insights ?? []).map(text => {
      const pi = parseInsight(text)
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;margin-bottom:4px;border-left:3px solid ${pi.type === 'action' ? ACTION_COLOR : INSIGHT_COLOR};background:${pi.type === 'action' ? ACTION_BG : INSIGHT_BG}">
        <i class="bi ${pi.type === 'action' ? ACTION_ICON : INSIGHT_ICON}" style="font-size:13px;color:${pi.type === 'action' ? ACTION_COLOR : INSIGHT_COLOR};flex-shrink:0;margin-top:2px"></i>
        <span style="font-size:14px;color:#0f172a;line-height:1.5" class="insight-text">${esc(pi.text)}</span>
      </div>`
    }).join('')
    const annual = customerAnnualTotals(cust)

    return `<div id="cust-panel-${custIdx}" style="display:${custIdx === 0 ? 'block' : 'none'};padding:0">
  <div style="padding:16px 48px 12px;background:#e0f2fe;border-bottom:1px solid #bae6fd">
    <div style="font-size:22px;font-weight:800;color:#0e7490;line-height:1">${esc(cust.customer)}</div>
    <div style="font-size:12px;color:#0e7490;margin-top:4px">${esc(cust.industry ?? '')}</div>
  </div>
  <div style="padding:32px 48px 40px">
  <div style="display:flex;align-items:flex-start;gap:32px;margin-bottom:40px;padding-bottom:32px;border-bottom:1px solid #cbd5e1">
    <!-- Donut: 30% width -->
    <div style="flex:0 0 30%;text-align:center">
      <canvas id="acct-bar-${custIdx}" width="225" height="225" style="display:block;margin:0 auto"></canvas>
      <div style="font-size:13px;margin-top:6px"><span style="color:#64748b">YTD Consumed: </span><span style="color:#ff8c69;font-weight:700">${usd(t.consumed)}</span></div>
      <div style="font-size:13px"><span style="color:#64748b">YTD Budget: </span><span style="color:#2a9d8f;font-weight:700">${usd(t.budget)}</span></div>
      <div style="font-size:13px"><span style="color:#64748b">YTD ACV: </span><span style="color:#8ecae6;font-weight:700">${usd(t.acv)}</span></div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid #e2e8f0">
        <div style="font-size:11px;color:#64748b;margin-bottom:2px"><span style="color:#64748b">Projected Consumed: </span><strong style="color:${C_PROJ_CONSUMED}">${usd(annual.annualConsumed)}</strong></div>
        <div style="font-size:11px;color:#64748b;margin-bottom:2px"><span style="color:#64748b">Projected Budget: </span><strong style="color:#2a9d8f">${usd(annual.annualBudget)}</strong></div>
        <div style="font-size:11px;color:#64748b"><span style="color:#64748b">Projected ACV: </span><strong style="color:#8ecae6">${usd(annual.annualAcv)}</strong></div>
      </div>
    </div>
    <!-- EA insights: 70% width -->
    <div style="flex:1;min-width:0">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#0f172a;margin-bottom:12px">EA Insights and Actions</div>
      ${eaInsightRows || '<div style="font-size:13px;color:#94a3b8;font-style:italic">No insights available</div>'}
    </div>
  </div>
  <!-- Solution area cards -->
  <div style="margin-bottom:32px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:12px">Solution Areas</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px">${l1Tiles}</div>
  </div>
  </div>
</div>`
  }).join('\n')

  return `<div style="padding:0 32px;border-bottom:2px solid #0e7490;display:flex;gap:0;overflow-x:auto;background:#0e7490">${tabs}</div>
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
    let totalBudget = 0, totalConsumed = 0, totalAnnualAcv = 0
    for (const c of indCustomers) { const t = customerTotals(c); totalBudget += t.budget; totalConsumed += t.consumed; totalAnnualAcv += customerAnnualTotals(c).annualAcv }
    const att = attPct(totalBudget, totalConsumed)
    const isFirst = idx === 0
    return `<button onclick="showIndustry(${idx})" class="ind-tab" data-ind="${idx}"
  style="padding:10px 20px;background:${isFirst ? '#e0f2fe' : 'transparent'};border:none;border-bottom:${isFirst ? '3px solid #e0f2fe' : '3px solid transparent'};color:${isFirst ? '#0e7490' : 'rgba(255,255,255,0.8)'};font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap">
  ${esc(ind.industry)}<span style="display:block;font-size:10px;font-weight:400;color:#8ecae6;margin-top:2px">${usd(totalAnnualAcv)} proj ACV</span>
</button>`
  }).join('')

  const panels = indInsights.map((ind, indIdx) => {
    const indCustomers = customers.filter(c => c.industry === ind.industry)
    let totalAcv = 0, totalBudget = 0, totalConsumed = 0
    let totalAnnualAcv = 0, totalAnnualBudget = 0, totalAnnualConsumed = 0
    for (const c of indCustomers) {
      const t = customerTotals(c)
      totalAcv += t.acv; totalBudget += t.budget; totalConsumed += t.consumed
      const ann = customerAnnualTotals(c)
      totalAnnualAcv += ann.annualAcv; totalAnnualBudget += ann.annualBudget; totalAnnualConsumed += ann.annualConsumed
    }
    const att = attPct(totalBudget, totalConsumed)

    const insightRows = (ind.summary ?? []).map(text => {
      const pi = parseInsight(text)
      return `<div style="display:flex;gap:8px;align-items:flex-start;padding:8px 10px;margin-bottom:4px;border-left:3px solid ${pi.type === 'action' ? ACTION_COLOR : INSIGHT_COLOR};background:${pi.type === 'action' ? ACTION_BG : INSIGHT_BG}">
        <i class="bi ${pi.type === 'action' ? ACTION_ICON : INSIGHT_ICON}" style="font-size:13px;color:${pi.type === 'action' ? ACTION_COLOR : INSIGHT_COLOR};flex-shrink:0;margin-top:2px"></i>
        <span style="font-size:14px;color:#0f172a;line-height:1.5" class="insight-text">${esc(pi.text)}</span>
      </div>`
    }).join('')

    return `<div id="ind-panel-${indIdx}" style="display:${indIdx === 0 ? 'block' : 'none'};padding:0">
  <div style="padding:16px 48px 12px;background:#e0f2fe;border-bottom:1px solid #bae6fd">
    <div style="font-size:22px;font-weight:800;color:#0e7490">${esc(ind.industry)}</div>
    <div style="font-size:12px;color:#0e7490;margin-top:2px"><strong>${indCustomers.length}</strong> customer${indCustomers.length !== 1 ? 's' : ''}</div>
  </div>
  <div style="padding:24px 48px 40px">
  <div style="display:flex;gap:32px;flex-wrap:wrap;margin-bottom:32px;padding:16px;background:#f8fafc;border:1px solid #e2e8f0">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">YTD Consumed</div>
      <div style="font-size:16px;font-weight:700;color:#ff8c69">${usd(totalConsumed)}</div>
    </div>
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">YTD Budget</div>
      <div style="font-size:16px;font-weight:700;color:#2a9d8f">${usd(totalBudget)}</div>
    </div>
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">YTD ACV</div>
      <div style="font-size:16px;font-weight:700;color:#8ecae6">${usd(totalAcv)}</div>
    </div>
    <div style="border-left:1px solid #e2e8f0;padding-left:32px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">Projected Consumed</div>
      <div style="font-size:16px;font-weight:700;color:${C_PROJ_CONSUMED}">${usd(totalAnnualConsumed)}</div>
    </div>
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">Projected Budget</div>
      <div style="font-size:16px;font-weight:700;color:#2a9d8f">${usd(totalAnnualBudget)}</div>
    </div>
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">Projected ACV</div>
      <div style="font-size:16px;font-weight:700;color:#8ecae6">${usd(totalAnnualAcv)}</div>
    </div>
    <div style="border-left:1px solid #e2e8f0;padding-left:32px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">YTD Att%</div>
      <div style="font-size:16px;font-weight:700;color:#0f172a">${att != null ? Math.ceil(att) + '%' : '—'}</div>
    </div>
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">Proj Att%</div>
      <div style="font-size:16px;font-weight:700;color:#0f172a">${totalAnnualBudget > 0 ? Math.round(totalAnnualConsumed / totalAnnualBudget * 100) + '%' : '—'}</div>
    </div>
  </div>
  <div style="margin-bottom:32px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#94a3b8;margin-bottom:16px">Budget vs Consumed by Customer</div>
    <div style="display:flex;flex-wrap:wrap;gap:40px;align-items:flex-start;padding:0 16px">
      ${indCustomers.map((c, i) => {
        const ct = customerTotals(c)
        const cann = customerAnnualTotals(c)
        const att = ct.budget > 0 ? (ct.consumed / ct.budget * 100) : null
        return `<div style="text-align:center;padding:0 12px">
          <canvas id="ind-donut-${indIdx}-${i}" width="225" height="225" style="display:block;margin:0 auto"></canvas>
          <div style="font-size:12px;font-weight:600;color:#0f172a;margin-top:8px">${esc(c.customer)}</div>
          <div style="font-size:12px"><span style="color:#64748b">YTD Consumed: </span><span style="color:#ff8c69;font-weight:700">${usd(ct.consumed)}</span></div>
          <div style="font-size:12px"><span style="color:#64748b">YTD Budget: </span><span style="color:#2a9d8f;font-weight:700">${usd(ct.budget)}</span></div>
          <div style="font-size:12px"><span style="color:#64748b">YTD ACV: </span><span style="color:#8ecae6;font-weight:700">${usd(ct.acv)}</span></div>
          <div style="font-size:11px;margin-top:4px;padding-top:4px;border-top:1px solid #e2e8f0"><span style="color:#64748b">Projected Consumed: </span><span style="color:${C_PROJ_CONSUMED};font-weight:700">${usd(cann.annualConsumed)}</span></div>
          <div style="font-size:11px"><span style="color:#64748b">Projected Budget: </span><span style="color:#2a9d8f;font-weight:700">${usd(cann.annualBudget)}</span></div>
          <div style="font-size:11px"><span style="color:#64748b">Projected ACV: </span><span style="color:#8ecae6;font-weight:700">${usd(cann.annualAcv)}</span></div>
        </div>`
      }).join('')}
    </div>
  </div>
  <div style="margin-bottom:32px;border-top:1px solid #cbd5e1;padding-top:24px">
    <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#a78bfa;margin-bottom:16px">Industry Insights</div>
    ${insightRows || '<div style="font-size:13px;color:#94a3b8;font-style:italic">No insights available</div>'}
  </div>
  </div>
</div>`
  }).join('\n')

  // Change 1: light theme tab strip; Change 6: renderIndChart called directly (no setTimeout)
  return `<div style="padding:0 32px;border-bottom:2px solid #0e7490;display:flex;gap:0;overflow-x:auto;background:#0e7490">${tabs}</div>
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
      const l1Ann = l1AnnualTotals(l1)
      const l1Att = attPct(l1t.budget, l1t.consumed)

      // L1 drawer data: L2 tiles (metrics only — SA insights now live at L1, shown in Accounts view)
      const l2Tiles = (l1.solutions_l2 ?? []).map((l2, l2Idx) => {
        const t = l2Totals(l2)
        const ann = l2AnnualTotals(l2)
        const a = attPct(t.budget, t.consumed)
        return { name: l2.name, attainment: a, budget: t.budget, consumed: t.consumed, acv: t.acv,
                 annualConsumed: ann.annualConsumed, annualBudget: ann.annualBudget, annualAcv: ann.annualAcv,
                 l2Idx, saInsights: [] }
      })

      drawerData[l1Key] = {
        custName: cust.customer,
        l1Name: l1.name,
        l1Attainment: l1Att,
        l1Budget: l1t.budget,
        l1Consumed: l1t.consumed,
        l1AnnualConsumed: l1Ann.annualConsumed,
        l1AnnualBudget: l1Ann.annualBudget,
        l1AnnualAcv: l1Ann.annualAcv,
        eaInsights: cust.enterprise_architecture_insights ?? [],
        l2Tiles,
      }

      ;(l1.solutions_l2 ?? []).forEach((l2, l2Idx) => {
        const l2Key = `c${custIdx}-l1${l1Idx}-l2${l2Idx}`

        const l3List = (l2.solutions_l3 ?? []).map((l3, l3Idx) => {
          const t = l3Totals(l3)
          const ann = l3AnnualTotals(l3)
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
              chartBudget.push(mo.ytd_budget_contract_value ?? 0)
              chartConsumed.push(mo.ytd_consumed_contract_value ?? 0)
              chartAttainment.push(mo.variances?.ytd_budget_attainment ?? null)
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
            annualConsumed: ann.annualConsumed,
            annualBudget: ann.annualBudget,
            annualAcv: ann.annualAcv,
            contractInsights: l3.contract?.contract_insights ?? [],
          }
        })

        drawerData[l2Key] = {
          custName: cust.customer,
          l1Name: l1.name,
          l2Name: l2.name,
          saInsights: [],
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
    const labels = [], budget = [], consumed = [], acv = [], projAtt = []
    for (const c of indCustomers) {
      const t = customerTotals(c)
      const ann = customerAnnualTotals(c)
      labels.push(c.customer)
      budget.push(t.budget)
      consumed.push(t.consumed)
      acv.push(t.acv)
      projAtt.push(ann.annualBudget > 0 ? Math.round(ann.annualConsumed / ann.annualBudget * 100) : null)
    }
    return { labels, budget, consumed, acv, projAtt }
  })
}

// ── Build ACCT_BAR_DATA and L1_BAR_DATA for browser ──────────────────────────
function buildAcctBarData(customers) {
  return customers.map((cust, custIdx) => {
    const t = customerTotals(cust)
    const ann = customerAnnualTotals(cust)
    const att = attPct(t.budget, t.consumed)
    const projAtt = ann.annualBudget > 0 ? Math.round(ann.annualConsumed / ann.annualBudget * 100) : null
    return { budget: t.budget, consumed: t.consumed, acv: t.acv, attainment: att, projAtt }
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
  let portProjAcv = 0, portProjBudget = 0, portProjConsumed = 0
  for (const c of customers) {
    const t = customerTotals(c)
    portAcv += t.acv; portBudget += t.budget; portConsumed += t.consumed
    const ann = customerAnnualTotals(c)
    portProjAcv += ann.annualAcv; portProjBudget += ann.annualBudget; portProjConsumed += ann.annualConsumed
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
</style>
</head>
<body>

<!-- TOP NAV -->
<div id="topnav" style="position:sticky;top:0;z-index:200;background:#0f172a;border-bottom:2px solid #1e293b;display:flex;align-items:center;justify-content:space-between;padding:0 32px;height:52px">
  <div style="display:flex;align-items:center;gap:24px">
    <span style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff">SAP Portfolio Briefing</span>
    <span style="color:#334155">|</span>
    <span style="font-size:11px;color:#94a3b8">${esc(rmDisplay)} · ${esc(fy)}</span>
    <span style="color:#334155">|</span>
  </div>
  <div style="display:flex;gap:0">
    <button id="tab-industry" onclick="showView('industry')" style="padding:0 20px;height:52px;background:transparent;border:none;border-bottom:2px solid #8ecae6;color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer">INDUSTRY</button>
    <button id="tab-accounts" onclick="showView('accounts')" style="padding:0 20px;height:52px;background:transparent;border:none;border-bottom:2px solid transparent;color:#64748b;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer">ACCOUNTS</button>
  </div>
  <div style="display:flex;gap:16px;font-size:11px">
    <span style="color:#94a3b8">YTD Consumed <strong style="color:#ff8c69">${esc(usd(portConsumed))}</strong></span>
    <span style="color:#94a3b8">YTD Budget <strong style="color:#2a9d8f">${esc(usd(portBudget))}</strong></span>
    <span style="color:#94a3b8">YTD ACV <strong style="color:#8ecae6">${esc(usd(portAcv))}</strong></span>
    <span style="color:#334155">|</span>
    <span style="color:#94a3b8">Proj Consumed <strong style="color:${C_PROJ_CONSUMED}">${esc(usd(portProjConsumed))}</strong></span>
    <span style="color:#94a3b8">Proj Budget <strong style="color:#2a9d8f">${esc(usd(portProjBudget))}</strong></span>
    <span style="color:#94a3b8">Proj ACV <strong style="color:#8ecae6">${esc(usd(portProjAcv))}</strong></span>
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
  return att >= 80 ? '#2a9d8f' : att >= 50 ? '#f0a500' : '#e76f51';
}
function escHtml(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function trunc(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n-1) + '\\u2026' : s;
}
function renderInsight(raw) {
  if (!raw) return '';
  var s = String(raw), type = 'unknown', text = s;
  if (s.indexOf('[insight]') === 0) { type = 'insight'; text = s.slice(9).trimStart(); }
  else if (s.indexOf('[action]') === 0) { type = 'action'; text = s.slice(8).trimStart(); }
  var icon  = type === 'action'  ? 'bi-lightning-charge-fill' : type === 'insight' ? 'bi-lightbulb' : 'bi-info-circle';
  var color = type === 'action'  ? '#2a9d8f' : type === 'insight' ? '#ff8c69' : '#8ecae6';
  var badge = type !== 'unknown'
    ? '<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:' + color + ';background:' + color + '18;padding:1px 5px;margin-right:6px;vertical-align:middle;flex-shrink:0"><i class="bi ' + icon + '" style="font-size:10px"></i>' + type + '</span>'
    : '';
  return badge + '<span class="insight-text" style="font-size:13.5px;color:#0f172a;line-height:1.4">' + escHtml(text) + '</span>';
}

// ── View tabs ─────────────────────────────────────────────────────────────────
function showView(v) {
  currentView = v;
  ['accounts','industry'].forEach(function(name) {
    var el = document.getElementById('view-' + name);
    if (el) el.style.display = name === v ? 'block' : 'none';
    var tab = document.getElementById('tab-' + name);
    if (tab) {
      tab.style.borderBottom = name === v ? '2px solid #8ecae6' : '2px solid transparent';
      tab.style.color = name === v ? '#ffffff' : '#64748b';
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
    btn.style.background = active ? '#e0f2fe' : 'transparent';
    btn.style.borderBottom = active ? '3px solid #e0f2fe' : '3px solid transparent';
    btn.style.color = active ? '#0e7490' : 'rgba(255,255,255,0.8)';
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
    btn.style.background = active ? '#e0f2fe' : 'transparent';
    btn.style.borderBottom = active ? '3px solid #e0f2fe' : '3px solid transparent';
    btn.style.color = active ? '#0e7490' : 'rgba(255,255,255,0.8)';
  });
  document.querySelectorAll('[id^="ind-panel-"]').forEach(function(el) {
    el.style.display = 'none';
  });
  var panel = document.getElementById('ind-panel-' + idx);
  if (panel) panel.style.display = 'block';
  // Change 6: call renderIndChart directly — no setTimeout
  renderIndChart(idx);
}

// ── Account bar chart (Change 5) ─────────────────────────────────────────────
function renderAcctBar(custIdx) {
  var canvas = document.getElementById('acct-bar-' + custIdx);
  var d = ACCT_BAR_DATA[custIdx];
  if (!d) return;
  renderDonut(canvas, d.budget, d.consumed, d.acv, 225, d.projAtt ?? null);
}

// ── Shared donut renderer ─────────────────────────────────────────────────────
// projAtt: projected budget attainment % (integer or null) — shown below YTD att in small grey text
function renderDonut(canvas, budget, consumed, acv, size, projAtt) {
  if (!canvas) return;
  if (canvas._donutChart) { try { canvas._donutChart.destroy(); } catch(e){} canvas._donutChart = null; }
  size = size || 120;
  canvas.width  = size;
  canvas.height = size;
  var remaining = Math.max(0, budget - consumed);
  var att = budget > 0 ? Math.round(consumed / budget * 100) : null;
  var attLabel = att != null ? att + '%' : '—';
  var projLabel = projAtt != null ? projAtt + '%' : null;
  var pctFontSize  = Math.floor(size * 0.17);  // large   — attainment %
  var labelFont    = Math.floor(size * 0.07);  // xxsmall — "YTD" / "Projected"
  var projFontSize = Math.floor(size * 0.11);  // xsmall  — projected %

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

      if (projLabel) {
        // 4 lines: attLabel / YTD / projLabel / Projected
        // Total block height = pctFontSize + labelFont + projFontSize + labelFont + gaps
        var gap = Math.floor(size * 0.025);
        var totalH = pctFontSize + gap + labelFont + gap * 1.5 + projFontSize + gap + labelFont;
        var y = cy - totalH / 2;

        // Line 1: attainment % — large black non-bold
        y += pctFontSize / 2;
        ctx2.fillStyle = '#0f172a';
        ctx2.font = pctFontSize + 'px -apple-system,BlinkMacSystemFont,sans-serif';
        ctx2.fillText(attLabel, cx, y);
        y += pctFontSize / 2 + gap;

        // Line 2: "YTD" — xsmall blue
        y += labelFont / 2;
        ctx2.fillStyle = '#93c5fd';
        ctx2.font = labelFont + 'px -apple-system,BlinkMacSystemFont,sans-serif';
        ctx2.fillText('YTD', cx, y);
        y += labelFont / 2 + gap * 1.5;

        // Line 3: projected % — small grey
        y += projFontSize / 2;
        ctx2.fillStyle = '#8ecae6';
        ctx2.font = projFontSize + 'px -apple-system,BlinkMacSystemFont,sans-serif';
        ctx2.fillText(projLabel, cx, y);
        y += projFontSize / 2 + gap;

        // Line 4: "Projected" — xsmall grey
        y += labelFont / 2;
        ctx2.fillStyle = '#cbd5e1';
        ctx2.font = labelFont + 'px -apple-system,BlinkMacSystemFont,sans-serif';
        ctx2.fillText('Projected', cx, y);
      } else {
        ctx2.fillStyle = '#0f172a';
        ctx2.font = pctFontSize + 'px -apple-system,BlinkMacSystemFont,sans-serif';
        ctx2.fillText(attLabel, cx, cy);
      }
      ctx2.restore();
    }
  };

  canvas._donutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels: ['Consumed', 'Remaining'],
      datasets: [{
        data: [consumed > 0 ? consumed : 0, remaining > 0 ? remaining : (budget > 0 ? budget : 1)],
        backgroundColor: ['#ff8c69', '#e8edf2'],
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
    renderDonut(canvas, d.budget, d.consumed, d.acv || 0, 113);
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
    renderDonut(canvas, d.budget[i] || 0, d.consumed[i] || 0, d.acv ? (d.acv[i] || 0) : 0, 225, d.projAtt ? (d.projAtt[i] ?? null) : null);
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
        { type: 'line', label: 'Consumed',    data: data.consumed,   borderColor: '#ff8c69', backgroundColor: 'transparent', yAxisID: 'y', tension: 0.3, pointRadius: 3, pointBackgroundColor: '#ff8c69' },
        { type: 'line', label: 'Budget',      data: data.budget,     borderColor: '#2a9d8f', backgroundColor: 'transparent', yAxisID: 'y', tension: 0.3, pointRadius: 3, pointBackgroundColor: '#2a9d8f' },
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

  // L2 cards: metrics only
  var l2CardHtml = data.l2Tiles.map(function(tile) {
    var attPctVal = tile.budget > 0 ? (tile.consumed / tile.budget * 100) : null;
    var consumedBarW = attPctVal != null ? Math.min(100, attPctVal).toFixed(1) : 0;
    return '<div style="border:1px solid #e2e8f0;min-width:200px;flex:1;max-width:320px;overflow:hidden">'
      + '<div onclick="openL2(' + custIdx + ',' + l1Idx + ',' + tile.l2Idx + ')" style="cursor:pointer;background:#f8fafc;padding:14px 16px">'
      + '<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px">Sub-Solution Area</div>'
      + '<div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:8px">' + escHtml(tile.name) + '</div>'
      + '<div style="font-size:22px;font-weight:400;color:#0f172a;line-height:1">' + (attPctVal != null ? attPctVal.toFixed(1) + '%' : '—') + '</div>'
      + '<div style="font-size:11px;color:#94a3b8;margin-bottom:12px">Budget Attainment</div>'
      + '<div style="margin-bottom:8px">'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;color:#ff8c69;margin-bottom:3px"><span>Consumed</span><span style="font-weight:700">' + fmtUsd(tile.consumed) + '</span></div>'
      + '<div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#ff8c69;width:' + consumedBarW + '%"></div></div>'
      + '</div>'
      + '<div style="margin-bottom:4px">'
      + '<div style="display:flex;justify-content:space-between;font-size:12px;color:#2a9d8f;margin-bottom:3px"><span>Budget</span><span style="font-weight:700">' + fmtUsd(tile.budget) + '</span></div>'
      + '<div style="height:6px;background:#e2e8f0"><div style="height:6px;background:#2a9d8f;width:100%"></div></div>'
      + '</div>'
      + '<div style="font-size:12px;color:#8ecae6;font-weight:700;margin-top:6px;margin-bottom:8px">ACV: ' + fmtUsd(tile.acv || 0) + '</div>'
      + '<div style="padding-top:8px;border-top:1px solid #e2e8f0">'
      + '<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Projected</div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#ff8c69;margin-bottom:2px"><span>Consumed</span><span style="font-weight:700">' + fmtUsd(tile.annualConsumed) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#2a9d8f;margin-bottom:2px"><span>Budget</span><span style="font-weight:700">' + fmtUsd(tile.annualBudget) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#8ecae6"><span>ACV</span><span style="font-weight:700">' + fmtUsd(tile.annualAcv) + '</span></div>'
      + '</div>'
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
    + ' <span style="color:#cbd5e1">›</span> <strong style="color:#ff8c69">' + escHtml(data.l2Name) + '</strong>'
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
      + (active ? '#ff8c69' : 'transparent') + ';background:' + (active ? '#f1f5f9' : 'transparent') + '">'
      + '<div style="font-size:10px;font-weight:600;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px">Solution</div>'
      + '<div style="font-size:12px;font-weight:700;color:#0f172a;margin-bottom:6px;line-height:1.3">' + escHtml(trunc(l3.lprName, 26)) + '</div>'
      + '<div style="font-size:18px;font-weight:400;color:#0f172a;line-height:1">' + (l3Att != null ? l3Att.toFixed(1) + '%' : '—') + '</div>'
      + '<div style="font-size:10px;color:#94a3b8;margin-bottom:8px">Budget Attainment</div>'
      + '<div style="margin-bottom:5px">'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#ff8c69;margin-bottom:2px"><span>Consumed</span><span style="font-weight:700">' + fmtUsd(l3.consumed) + '</span></div>'
      + '<div style="height:4px;background:#e2e8f0"><div style="height:4px;background:#ff8c69;width:' + l3BarW + '%"></div></div>'
      + '</div>'
      + '<div style="margin-bottom:4px">'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#2a9d8f;margin-bottom:2px"><span>Budget</span><span style="font-weight:700">' + fmtUsd(l3.budget) + '</span></div>'
      + '<div style="height:4px;background:#e2e8f0"><div style="height:4px;background:#2a9d8f;width:100%"></div></div>'
      + '</div>'
      + '<div style="font-size:11px;color:#8ecae6;font-weight:700;margin-bottom:6px">ACV: ' + fmtUsd(l3.acv) + '</div>'
      + '<div style="padding-top:6px;border-top:1px solid #e2e8f0">'
      + '<div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Projected</div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#ff8c69;margin-bottom:2px"><span>Consumed</span><span style="font-weight:700">' + fmtUsd(l3.annualConsumed) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#2a9d8f;margin-bottom:2px"><span>Budget</span><span style="font-weight:700">' + fmtUsd(l3.annualBudget) + '</span></div>'
      + '<div style="display:flex;justify-content:space-between;font-size:11px;color:#8ecae6"><span>ACV</span><span style="font-weight:700">' + fmtUsd(l3.annualAcv) + '</span></div>'
      + '</div>'
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
    el.style.borderLeft = active ? '3px solid #ff8c69' : '3px solid transparent';
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
    var t = s.indexOf('[action]') === 0 ? 'action' : 'insight';
    var bg = t === 'action' ? '#f0faf9' : '#fff5f2';
    var border = t === 'action' ? '#2a9d8f' : '#ff8c69';
    return '<div style="padding:8px 10px;margin-bottom:4px;border-left:3px solid ' + border + ';background:' + bg + ';line-height:1.4">' + renderInsight(s) + '</div>';
  }).join('') || '<div style="font-size:13px;color:#8ecae6;font-style:italic;padding:8px 0">No contract insights</div>';

  // Change 4: metric order Consumed first, then Budget, then ACV, then Attainment
  // Change 5: L2 bar canvas
  var l2BarKey = custIdx + '-' + l1Idx + '-' + l2Idx + '-' + l3Idx;
  panel.innerHTML = '<div style="margin-bottom:12px">'
    + '<div style="font-size:16px;font-weight:700;color:#0f172a;margin-bottom:2px">' + escHtml(l3.lprName) + '</div>'
    + '<div style="font-size:11px;color:#64748b">' + escHtml(l3.lprId) + '</div>'
    + '</div>'
    + '<div style="position:relative;height:180px;margin-bottom:16px"><canvas id="chart-l3" style="height:180px;width:100%"></canvas></div>'
    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700;color:#0f172a;margin-bottom:12px">Contract Insights and Actions</div>'
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

  process.stderr.write(`warn: generating HTML dashboard…\n`)
  const html = buildHtml(portfolio, bootstrapCss, bootstrapJs, iconsCss, chartJs, nunitoCss)

  try {
    writeFileSync(outputPath, html, 'utf8')
  } catch (err) {
    throw new ProcessingError(`failed to write ${outputPath}: ${err.message}`)
  }

  process.stdout.write(`${outputPath}\n`)
  process.stderr.write(`warn: dashboard written — ${Buffer.byteLength(html, 'utf8')} bytes\n`)
}
