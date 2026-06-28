// @story STORY-005 | dashboard
// @intent generates "The Briefing" — a self-contained single-file HTML dashboard with sticky portfolio header,
//         industry filter strip, customer card grid (exec/EA modes), and L3 detail drawer; zero internet dependency;
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

// ── Semantic color constants (ux:visual-system) ───────────────────────────────
const C_ACV      = '#9ca3af'  // grey       — annual_contract_value
const C_BUDGET   = '#16a34a'  // green      — budget_contract_value
const C_CONSUMED = '#ea580c'  // orange     — consumed_contract_value
const C_PCT      = '#1d4ed8'  // royal blue — percentages / budget_attainment

// ── Asset paths (node_modules) ────────────────────────────────────────────────
const NM = path.join(__dirname, '..', '..', 'node_modules')
const BOOTSTRAP_CSS_PATH  = path.join(NM, 'bootstrap', 'dist', 'css', 'bootstrap.min.css')
const BOOTSTRAP_JS_PATH   = path.join(NM, 'bootstrap', 'dist', 'js', 'bootstrap.bundle.min.js')
const BOOTSTRAP_ICONS_CSS = path.join(NM, 'bootstrap-icons', 'font', 'bootstrap-icons.min.css')
const BOOTSTRAP_ICONS_WOFF2 = path.join(NM, 'bootstrap-icons', 'font', 'fonts', 'bootstrap-icons.woff2')
const CHARTJS_PATH        = path.join(NM, 'chart.js', 'dist', 'chart.umd.js')

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
        acv      += mo.annual_contract_value   ?? 0
        budget   += mo.budget_contract_value   ?? 0
        consumed += mo.consumed_contract_value ?? 0
      }
    }
  }
  return { acv, budget, consumed }
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

// ── Reporting month to display string ────────────────────────────────────────
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

// ── Icon legend HTML (shared across all insight section headers) ──────────
const ICON_LEGEND_HTML = `<div class="ins-legend" style="display:none;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:4px 0;border-bottom:1px solid #f1f5f9">
  <span style="font-size:9px;color:#94a3b8"><i class="bi bi-exclamation-triangle-fill" style="color:#f59e0b"></i> Risk</span>
  <span style="font-size:9px;color:#94a3b8"><i class="bi bi-graph-up-arrow" style="color:#16a34a"></i> Growth</span>
  <span style="font-size:9px;color:#94a3b8"><i class="bi bi-diagram-3" style="color:#2563eb"></i> Integration</span>
  <span style="font-size:9px;color:#94a3b8"><i class="bi bi-calendar-check" style="color:#0891b2"></i> Renewal</span>
  <span style="font-size:9px;color:#94a3b8"><i class="bi bi-lightning-charge-fill" style="color:#2563eb"></i> Action</span>
  <span style="font-size:9px;color:#94a3b8"><i class="bi bi-bar-chart-line" style="color:#64748b"></i> Adoption</span>
  <span style="font-size:9px;color:#94a3b8"><i class="bi bi-info-circle" style="color:#94a3b8"></i> Info</span>
</div>`

// ── Server-side insight bullets renderer (for pre-rendered HTML) ───────────
function renderInsightBullets(insights) {
  if (!insights || insights.length === 0) {
    return `<div class="ins-body" style="display:none"><div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0">
  <i class="bi bi-dash-circle" style="color:#94a3b8;flex-shrink:0;font-size:12px;margin-top:1px"></i>
  <span style="font-size:11px;color:#94a3b8;font-style:italic">Run --analyze to generate insights</span>
</div></div>`
  }
  const bullets = insights.map((p, i) => {
    const rule = pickIcon(p)
    const sep = i < insights.length - 1 ? ';border-bottom:1px solid #f1f5f9' : ''
    return `<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0${sep}">
  <i class="bi ${rule.icon}" style="color:${rule.color};flex-shrink:0;font-size:12px;margin-top:1px"></i>
  <span style="font-size:11px;color:#475569;line-height:1.5">${esc(p)}</span>
</div>`
  }).join('')
  return `<div class="ins-body" style="display:none">${bullets}</div>`
}

// ── ZONE 1: Portfolio header bar ──────────────────────────────────────────────
// @contract input: portfolio object, totals {acv,budget,consumed} → output: HTML string
function buildPortfolioHeader(portfolio, totals) {
  const fy  = portfolio.fiscal_year ?? 'FY—'
  const rm  = reportingMonthDisplay(portfolio.reporting_month)
  const attainment = totals.budget > 0 ? (totals.consumed / totals.budget * 100) : null

  return `<div style="position:sticky;top:0;z-index:100;background:#1e293b;padding:10px 24px;display:flex;align-items:center;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    <span style="color:white;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;font-weight:600">SAP Portfolio Briefing</span>
    <span style="color:#64748b">·</span>
    <span style="color:#94a3b8;font-size:13px">${esc(rm)}</span>
    <span style="color:#64748b">·</span>
    <span style="color:#94a3b8;font-size:13px">${esc(fy)}</span>
  </div>
  <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
    <span style="font-size:11px"><span style="color:#94a3b8">ACV </span><span style="color:${C_ACV};font-weight:600">${usd(totals.acv)}</span></span>
    <span style="font-size:11px"><span style="color:#94a3b8">Budget </span><span style="color:${C_BUDGET};font-weight:600">${usd(totals.budget)}</span></span>
    <span style="font-size:11px"><span style="color:#94a3b8">Consumed </span><span style="color:${C_CONSUMED};font-weight:600">${usd(totals.consumed)}</span></span>
    <span style="color:${C_PCT};font-size:18px;font-weight:700">${pct(attainment)}</span>
  </div>
</div>`
}

// ── ZONE 2: Industry strip ─────────────────────────────────────────────────────
// @contract input: industry_insights[] → output: HTML string
function buildIndustryStrip(indInsights) {
  const cards = indInsights.map((ind, idx) => {
    const ac = ind.aggregated_contracts ?? {}
    const indAcv      = ac.annual_contract_value   ?? 0
    const indBudget   = ac.budget_contract_value   ?? 0
    const indConsumed = ac.consumed_contract_value ?? 0
    const indAtt      = indBudget > 0 ? (indConsumed / indBudget * 100) : null
    const summaryInsights = ind.summary ?? []
    const insightBullets = summaryInsights.length > 0
      ? summaryInsights.map((p, i) => {
          const rule = pickIcon(p)
          const sep = i < summaryInsights.length - 1 ? ';border-bottom:1px solid #f1f5f9' : ''
          return `<div style="display:flex;gap:6px;align-items:flex-start;padding:4px 0${sep}">
  <i class="bi ${rule.icon}" style="color:${rule.color};flex-shrink:0;font-size:11px;margin-top:1px"></i>
  <span style="font-size:10px;color:#475569;line-height:1.4">${esc(p)}</span>
</div>`
        }).join('')
      : `<div style="font-size:10px;color:#94a3b8;font-style:italic">No insights available</div>`

    return `<div class="industry-card" data-industry-idx="${idx}" onclick="filterByIndustry(${idx})"
  style="cursor:pointer;padding:12px 16px;background:white;border:1px solid #e2e8f0;min-width:260px;flex-shrink:0">
  <div style="font-size:13px;font-weight:600;color:#1e293b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">${esc(ind.industry)}</div>
  <div style="font-size:11px;color:${C_ACV};margin-bottom:2px">ACV ${usd(indAcv)}</div>
  <div style="font-size:11px;color:${C_BUDGET};margin-bottom:2px">Budget ${usd(indBudget)}</div>
  <div style="font-size:11px;color:${C_CONSUMED};margin-bottom:4px">Consumed ${usd(indConsumed)}</div>
  <div style="font-size:16px;font-weight:700;color:${C_PCT};margin-bottom:4px">${pct(indAtt)}</div>
  <div style="border-top:1px solid #e2e8f0;margin-top:8px;padding-top:8px">${insightBullets}</div>
</div>`
  }).join('')

  const showAll = `<div id="industry-all" onclick="filterByIndustry(null)"
  style="cursor:pointer;padding:8px 14px;background:white;border:2px solid #1e293b;font-size:11px;font-weight:600;letter-spacing:0.05em;color:#1e293b;display:flex;align-items:center;flex-shrink:0">
  SHOW ALL
</div>`

  return `<div style="background:#f8fafc;border-bottom:2px solid #e2e8f0;padding:12px 24px;display:flex;gap:12px;overflow-x:auto;align-items:flex-start">
  ${showAll}
  ${cards}
</div>`
}

// ── Customer card body — executive mode ───────────────────────────────────────
// @contract input: cust object, custIdx int → output: HTML string (card body only)
function buildCustomerCardExec(cust, custIdx) {
  const totals = customerTotals(cust)
  const attainment = totals.budget > 0 ? (totals.consumed / totals.budget * 100) : null

  // L1 chips (exec mode — no action on click)
  const l1Chips = (cust.solutions_l1 ?? []).map((l1, l1Idx) => {
    const t = l1Totals(l1)
    const att = t.budget > 0 ? (t.consumed / t.budget * 100) : null
    return `<span class="l1-chip" style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;cursor:default;background:white;display:inline-block">
  ${esc(l1.name)} <span style="color:${C_PCT}">${pct(att)}</span>
</span>`
  }).join('')

  return `<div style="padding:0;overflow:hidden">
  <!-- Card header -->
  <div style="background:#1e293b;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="color:white;font-size:14px;font-weight:600">${esc(cust.customer)}</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-top:2px">${esc(cust.industry ?? '')}</div>
    </div>
    <div style="text-align:right">
      <div style="color:${C_PCT};font-size:22px;font-weight:700">${pct(attainment)}</div>
      <div style="color:#64748b;font-size:9px">budget attainment</div>
    </div>
  </div>
  <!-- Card body -->
  <div style="padding:16px">
    <!-- Mini chart (HL contract numbers) -->
    <div style="height:56px;position:relative">
      <canvas id="minichart-${custIdx}" style="height:56px;width:100%"></canvas>
    </div>
    <!-- Metric pills (HL contract numbers) -->
    <div style="font-size:11px;margin-top:8px">
      <span style="color:${C_ACV}">ACV: ${usd(totals.acv)}</span>
      <span style="color:#94a3b8"> · </span>
      <span style="color:${C_BUDGET}">Budget: ${usd(totals.budget)}</span>
      <span style="color:#94a3b8"> · </span>
      <span style="color:${C_CONSUMED}">Consumed: ${usd(totals.consumed)}</span>
    </div>
    <!-- L1 chips (solution areas with attainment %) -->
    <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">
      ${l1Chips}
    </div>
    <!-- Account insights (collapsed, last) -->
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0">
      <div onclick="toggleInsights(this)" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px">
        <span>Account Insights</span>
        <span class="ins-toggle" style="font-size:12px;color:#94a3b8">&#9654;</span>
      </div>
      ${ICON_LEGEND_HTML}
      ${renderInsightBullets(cust.account_insights)}
    </div>
  </div>
</div>`
}

// ── L1 detail block (EA mode inline expansion) ────────────────────────────────
// @contract input: cust object, custIdx int, l1 object, l1Idx int → output: HTML string
function buildL1DetailBlock(cust, custIdx, l1, l1Idx) {
  const l2Chips = (l1.solutions_l2 ?? []).map((l2, l2Idx) => {
    const t = l2Totals(l2)
    const att = t.budget > 0 ? (t.consumed / t.budget * 100) : null
    return `<span class="l2-chip" onclick="openDrawer(${custIdx},${l1Idx},${l2Idx})"
  style="padding:3px 8px;border:1px solid #cbd5e1;font-size:10px;cursor:pointer;background:white;display:inline-block">
  ${esc(l2.name)} <span style="color:${C_PCT}">${pct(att)}</span>
</span>`
  }).join('')

  const t = l1Totals(l1)
  const l1Att = t.budget > 0 ? (t.consumed / t.budget * 100) : null

  return `<div id="l1detail-${custIdx}-${l1Idx}" style="display:none;margin-top:12px;padding:12px;background:#f8fafc;border-top:2px solid #1e293b">
  <!-- L1 name + contract totals -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div style="font-size:12px;font-weight:600;color:#1e293b;text-transform:uppercase">${esc(l1.name)}</div>
    <div style="font-size:10px;color:#64748b">
      <span style="color:${C_BUDGET}">Budget: ${usd(t.budget)}</span>
      <span style="color:#94a3b8"> · </span>
      <span style="color:${C_CONSUMED}">Consumed: ${usd(t.consumed)}</span>
      <span style="color:#94a3b8"> · </span>
      <span style="color:${C_PCT}">${pct(l1Att)}</span>
    </div>
  </div>
  <!-- L2 chips (solution sub-areas) -->
  <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">
    ${l2Chips}
  </div>
  <!-- EA insights (collapsed, last) -->
  <div onclick="toggleInsights(this)" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px">
    <span>EA Insights</span>
    <span class="ins-toggle" style="font-size:12px;color:#94a3b8">&#9654;</span>
  </div>
  ${ICON_LEGEND_HTML}
  ${renderInsightBullets(l1.enterprise_architecture_insights)}
</div>`
}

// ── Customer card body — EA mode ──────────────────────────────────────────────
// @contract input: cust object, custIdx int → output: HTML string (card body only)
function buildCustomerCardEA(cust, custIdx) {
  const totals = customerTotals(cust)
  const attainment = totals.budget > 0 ? (totals.consumed / totals.budget * 100) : null

  // L1 chips with toggleL1 onclick + l1 detail blocks
  const l1Section = (cust.solutions_l1 ?? []).map((l1, l1Idx) => {
    const t = l1Totals(l1)
    const att = t.budget > 0 ? (t.consumed / t.budget * 100) : null
    const chip = `<span class="l1-chip" data-l1chip="${custIdx}" data-l1idx="${l1Idx}"
  onclick="toggleL1(${custIdx},${l1Idx},event)"
  style="padding:4px 8px;border:1px solid #e2e8f0;font-size:11px;cursor:pointer;background:white;display:inline-block">
  ${esc(l1.name)} <span style="color:${C_PCT}">${pct(att)}</span>
</span>`
    const detail = buildL1DetailBlock(cust, custIdx, l1, l1Idx)
    return chip + detail
  }).join('')

  return `<div style="padding:0;overflow:hidden">
  <!-- Card header -->
  <div style="background:#1e293b;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <div style="color:white;font-size:14px;font-weight:600">${esc(cust.customer)}</div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-top:2px">${esc(cust.industry ?? '')}</div>
    </div>
    <div style="text-align:right">
      <div style="color:${C_PCT};font-size:22px;font-weight:700">${pct(attainment)}</div>
      <div style="color:#64748b;font-size:9px">budget attainment</div>
    </div>
  </div>
  <!-- Card body -->
  <div style="padding:16px">
    <!-- Mini chart (HL contract numbers) -->
    <div style="height:56px;position:relative">
      <canvas id="minichart-${custIdx}" style="height:56px;width:100%"></canvas>
    </div>
    <!-- Metric pills (HL contract numbers) -->
    <div style="font-size:11px;margin-top:8px">
      <span style="color:${C_ACV}">ACV: ${usd(totals.acv)}</span>
      <span style="color:#94a3b8"> · </span>
      <span style="color:${C_BUDGET}">Budget: ${usd(totals.budget)}</span>
      <span style="color:#94a3b8"> · </span>
      <span style="color:${C_CONSUMED}">Consumed: ${usd(totals.consumed)}</span>
    </div>
    <!-- L1 chips + detail blocks (solution areas with attainment %) -->
    <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px">
      ${l1Section}
    </div>
    <!-- Account insights (collapsed, last) -->
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e2e8f0">
      <div onclick="toggleInsights(this)" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:8px">
        <span>Account Insights</span>
        <span class="ins-toggle" style="font-size:12px;color:#94a3b8">&#9654;</span>
      </div>
      ${ICON_LEGEND_HTML}
      ${renderInsightBullets(cust.account_insights)}
    </div>
  </div>
</div>`
}

// ── ZONE 4: Drawer data builder ───────────────────────────────────────────────
// @contract input: customers[], reportingMonth int → output: { drawerData, miniChartData }
function buildDrawerData(customers, reportingMonth) {
  const drawerData = {}    // keyed "c{custIdx}-l1{l1Idx}-l2{l2Idx}"
  const miniChartData = [] // indexed by custIdx

  customers.forEach((cust, custIdx) => {
    const totals = customerTotals(cust)
    miniChartData.push({ acv: totals.acv, budget: totals.budget, consumed: totals.consumed })

    ;(cust.solutions_l1 ?? []).forEach((l1, l1Idx) => {
      ;(l1.solutions_l2 ?? []).forEach((l2, l2Idx) => {
        const key = `c${custIdx}-l1${l1Idx}-l2${l2Idx}`

        // Collect saInsights at L2 level from first L3 that has them
        let l2SaInsights = []
        for (const l3 of l2.solutions_l3 ?? []) {
          const sa = l3.solution_architecture_insights ?? []
          if (sa.length > 0) { l2SaInsights = sa; break }
        }

        const l3List = (l2.solutions_l3 ?? []).map((l3) => {
          const contractData = l3.contract ?? {}
          const contractInsights = contractData.contract_insights ?? []

          // Build chart data filtered to <= reportingMonth
          const chartLabels = [], chartBudget = [], chartConsumed = [], chartAttainment = []
          const yearKeys = Object.keys(contractData).filter(k => k !== 'contract_insights').sort()
          let totalAcv = 0, totalBudget = 0, totalConsumed = 0
          for (const yr of yearKeys) {
            for (const mo of contractData[yr] ?? []) {
              totalAcv      += mo.annual_contract_value   ?? 0
              totalBudget   += mo.budget_contract_value   ?? 0
              totalConsumed += mo.consumed_contract_value ?? 0
              const yyyymm = monthToYYYYMM(yr, mo.month)
              if (yyyymm === null) continue
              if (reportingMonth && yyyymm > reportingMonth) continue
              chartLabels.push(`${mo.month} ${yr}`)
              chartBudget.push(mo.budget_contract_value ?? 0)
              chartConsumed.push(mo.consumed_contract_value ?? 0)
              chartAttainment.push(mo.variances?.budget_attainment ?? null)
            }
          }

          // Compute L3 attainment from chart data
          const filteredBudget   = chartBudget.reduce((s, v) => s + v, 0)
          const filteredConsumed = chartConsumed.reduce((s, v) => s + v, 0)
          const attainment       = filteredBudget > 0 ? (filteredConsumed / filteredBudget * 100) : null

          return {
            lprId: l3.lpr_id ?? '',
            lprName: l3.lpr_name ?? '',
            attainment,
            totals: { acv: totalAcv, budget: totalBudget, consumed: totalConsumed },
            contractInsights,
            chartData: { labels: chartLabels, budget: chartBudget, consumed: chartConsumed, attainment: chartAttainment }
          }
        })

        drawerData[key] = {
          custName: cust.customer ?? '',
          l1Name: l1.name ?? '',
          l2Name: l2.name ?? '',
          saInsights: l2SaInsights,
          l3List
        }
      })
    })
  })

  return { drawerData, miniChartData }
}

// ── ZONE 3: drawer HTML shell ─────────────────────────────────────────────────
function buildDrawerShell() {
  return `<div id="drawer" style="position:fixed;bottom:0;left:0;right:0;height:0;background:white;border-top:3px solid #1e293b;overflow:hidden;transition:height 0.2s ease;z-index:200">
  <!-- Drawer header -->
  <div style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:10px 24px;display:flex;align-items:center;gap:12px;justify-content:space-between">
    <div id="drawer-breadcrumb" style="font-size:12px;color:#64748b"></div>
    <span onclick="closeDrawer()" style="font-size:20px;cursor:pointer;color:#64748b;line-height:1">&times;</span>
  </div>
  <!-- Solution architecture insights (L2 level) -->
  <div id="drawer-sa-insights" style="padding:8px 24px;border-bottom:1px solid #e2e8f0;background:#f8fafc;font-size:11px;display:none"></div>
  <!-- Drawer body -->
  <div style="display:flex;height:calc(65vh - 44px);overflow:hidden">
    <!-- L3 tab list -->
    <div id="drawer-tabs" style="width:200px;border-right:1px solid #e2e8f0;overflow-y:auto;flex-shrink:0"></div>
    <!-- L3 content panel -->
    <div id="drawer-panel" style="flex:1;overflow-y:auto;padding:16px"></div>
  </div>
</div>`
}

// ── Global mode toggle ────────────────────────────────────────────────────────
function buildModeToggle() {
  return `<div style="position:fixed;top:48px;right:16px;z-index:9999;display:flex;border:2px solid #1e293b;background:white">
  <button id="btn-exec" onclick="setMode('exec')" style="padding:6px 14px;font-size:10px;font-weight:600;letter-spacing:0.06em;cursor:pointer;border:none;background:#1e293b;color:white;text-transform:uppercase">Executive</button>
  <button id="btn-ea"   onclick="setMode('ea')"   style="padding:6px 14px;font-size:10px;font-weight:600;letter-spacing:0.06em;cursor:pointer;border:none;background:transparent;color:#1e293b;text-transform:uppercase">EA</button>
</div>`
}

// ── Main HTML builder ─────────────────────────────────────────────────────────
// @contract input: portfolio object + asset strings → output: complete HTML string
function buildHtml(portfolio, bootstrapCss, bootstrapJs, iconsCss, chartJs) {
  const customers     = portfolio.customers ?? []
  const indInsights   = portfolio.industry_insights ?? []
  const reportingMonth = portfolio.reporting_month ? parseInt(String(portfolio.reporting_month), 10) : null

  // Portfolio-level aggregated totals (all customers)
  let portAcv = 0, portBudget = 0, portConsumed = 0
  for (const c of customers) {
    const t = customerTotals(c)
    portAcv      += t.acv
    portBudget   += t.budget
    portConsumed += t.consumed
  }
  const portTotals = { acv: portAcv, budget: portBudget, consumed: portConsumed }

  // Pre-render card arrays
  const execCards = customers.map((c, i) => buildCustomerCardExec(c, i))
  const eaCards   = customers.map((c, i) => buildCustomerCardEA(c, i))

  // Drawer data + mini chart data
  const { drawerData, miniChartData } = buildDrawerData(customers, reportingMonth)

  // Industry → customer index map
  const industryCustomerMap = indInsights.map(ind =>
    customers.map((c, ci) => c.industry === ind.industry ? ci : -1).filter(i => i >= 0)
  )

  // JSON embed helper — escapes </script> in string content
  function jsonEmbed(v) {
    return JSON.stringify(v).replace(/<\/script>/gi, '<\\/script>')
  }

  const COLORS_JSON                = JSON.stringify({ C_ACV, C_BUDGET, C_CONSUMED, C_PCT })
  const CUSTOMER_CARDS_EXEC_JSON   = jsonEmbed(execCards)
  const CUSTOMER_CARDS_EA_JSON     = jsonEmbed(eaCards)
  const L3_DRAWER_DATA_JSON        = jsonEmbed(drawerData)
  const MINI_CHART_DATA_JSON       = jsonEmbed(miniChartData)
  const INDUSTRY_CUSTOMER_MAP_JSON = JSON.stringify(industryCustomerMap)
  const REPORTING_MONTH_JSON       = JSON.stringify(reportingMonth ?? null)
  // ICON_RULES for browser-side renderInsightBullets
  const ICON_RULES_JSON = jsonEmbed(ICON_RULES)

  const headerHtml      = buildPortfolioHeader(portfolio, portTotals)
  const industryHtml    = buildIndustryStrip(indInsights)
  const drawerShellHtml = buildDrawerShell()
  const modeToggleHtml  = buildModeToggle()

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAP Portfolio Briefing — ${esc(portfolio.fiscal_year ?? '')}</title>
<style>${bootstrapCss}</style>
<style>${iconsCss}</style>
<style>
*, *::before, *::after { border-radius: 0 !important; box-shadow: none !important; }
body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; }
.cust-card { background: white; border: 1px solid #e2e8f0; }
.l3-tab:hover { background: #f8fafc !important; }
.industry-card:hover { border-color: #94a3b8 !important; }
.l1-chip:hover { background: #f1f5f9 !important; }
.l2-chip:hover { background: #f1f5f9 !important; }
</style>
</head>
<body>

${headerHtml}
${modeToggleHtml}
${industryHtml}

<!-- Zone 3: Customer grid -->
<div id="customer-grid" style="padding:24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px"></div>

${drawerShellHtml}

<script>${chartJs}</script>
<script>${bootstrapJs}</script>
<script>
// ── Embedded data constants ────────────────────────────────────────────────
const COLORS                = ${COLORS_JSON};
const CUSTOMER_CARDS_EXEC   = ${CUSTOMER_CARDS_EXEC_JSON};
const CUSTOMER_CARDS_EA     = ${CUSTOMER_CARDS_EA_JSON};
const L3_DRAWER_DATA        = ${L3_DRAWER_DATA_JSON};
const MINI_CHART_DATA       = ${MINI_CHART_DATA_JSON};
const INDUSTRY_CUSTOMER_MAP = ${INDUSTRY_CUSTOMER_MAP_JSON};
const REPORTING_MONTH       = ${REPORTING_MONTH_JSON};
const ICON_RULES_DATA       = ${ICON_RULES_JSON};

// ── State ──────────────────────────────────────────────────────────────────
var currentMode      = 'exec';
var selectedIndustry = null;
var selectedL1       = null;   // {custIdx, l1Idx}
var drawerState      = null;   // {custIdx, l1Idx, l2Idx, l3Idx}

// ── Utility ────────────────────────────────────────────────────────────────
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
function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function renderInsightBullets(insights) {
  if (!insights || insights.length === 0) {
    return '<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0">'
      + '<i class="bi bi-dash-circle" style="color:#94a3b8;flex-shrink:0;font-size:12px;margin-top:1px"></i>'
      + '<span style="font-size:11px;color:#94a3b8;font-style:italic">Run --analyze to generate insights</span>'
      + '</div>';
  }
  function pickIconRule(text) {
    var lower = text.toLowerCase();
    for (var r of ICON_RULES_DATA) {
      for (var kw of r.keywords) {
        if (lower.includes(kw)) return r;
      }
    }
    return { icon: 'bi-info-circle', color: '#94a3b8' };
  }
  return insights.map(function(p, i) {
    var rule = pickIconRule(p);
    var sep = i < insights.length - 1 ? ';border-bottom:1px solid #f1f5f9' : '';
    return '<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0' + sep + '">'
      + '<i class="bi ' + rule.icon + '" style="color:' + rule.color + ';flex-shrink:0;font-size:12px;margin-top:1px"></i>'
      + '<span style="font-size:11px;color:#475569;line-height:1.5">' + esc(p) + '</span>'
      + '</div>';
  }).join('');
}

// ── Icon legend HTML (browser constant) ───────────────────────────────────
var BROWSER_ICON_LEGEND_HTML = '<div class="ins-legend" style="display:none;flex-wrap:wrap;gap:6px;margin-bottom:8px;padding:4px 0;border-bottom:1px solid #f1f5f9">'
  + '<span style="font-size:9px;color:#94a3b8"><i class="bi bi-exclamation-triangle-fill" style="color:#f59e0b"></i> Risk</span>'
  + '<span style="font-size:9px;color:#94a3b8"><i class="bi bi-graph-up-arrow" style="color:#16a34a"></i> Growth</span>'
  + '<span style="font-size:9px;color:#94a3b8"><i class="bi bi-diagram-3" style="color:#2563eb"></i> Integration</span>'
  + '<span style="font-size:9px;color:#94a3b8"><i class="bi bi-calendar-check" style="color:#0891b2"></i> Renewal</span>'
  + '<span style="font-size:9px;color:#94a3b8"><i class="bi bi-lightning-charge-fill" style="color:#2563eb"></i> Action</span>'
  + '<span style="font-size:9px;color:#94a3b8"><i class="bi bi-bar-chart-line" style="color:#64748b"></i> Adoption</span>'
  + '<span style="font-size:9px;color:#94a3b8"><i class="bi bi-info-circle" style="color:#94a3b8"></i> Info</span>'
  + '</div>';

// ── Insight section expand/collapse ───────────────────────────────────────
function toggleInsights(headerEl) {
  var legend = headerEl.nextElementSibling;
  var body = legend.nextElementSibling;
  var arrow = headerEl.querySelector('.ins-toggle');
  var isOpen = body.style.display !== 'none';
  legend.style.display = isOpen ? 'none' : 'flex';
  body.style.display = isOpen ? 'none' : 'block';
  arrow.innerHTML = isOpen ? '&#9654;' : '&#9660;';
}

// ── Mode toggle ────────────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  selectedL1 = null;
  document.getElementById('btn-exec').style.background = mode === 'exec' ? '#1e293b' : 'transparent';
  document.getElementById('btn-exec').style.color      = mode === 'exec' ? 'white'   : '#1e293b';
  document.getElementById('btn-ea').style.background   = mode === 'ea'   ? '#1e293b' : 'transparent';
  document.getElementById('btn-ea').style.color        = mode === 'ea'   ? 'white'   : '#1e293b';
  closeDrawer();
  renderGrid();
}

// ── Industry filter ────────────────────────────────────────────────────────
function filterByIndustry(idx) {
  selectedIndustry = idx;
  document.querySelectorAll('.industry-card').forEach(function(el, i) {
    el.style.borderColor = i === idx ? '#1e293b' : '#e2e8f0';
    el.style.borderWidth = i === idx ? '2px'     : '1px';
    el.style.background  = i === idx ? '#f0f9ff' : 'white';
  });
  var allBtn = document.getElementById('industry-all');
  if (allBtn) {
    allBtn.style.borderColor = idx === null ? '#1e293b' : '#e2e8f0';
    allBtn.style.background  = idx === null ? '#f0f9ff' : 'white';
  }
  renderGrid();
}

// ── Grid renderer ──────────────────────────────────────────────────────────
function renderGrid() {
  var grid = document.getElementById('customer-grid');
  var cards = currentMode === 'exec' ? CUSTOMER_CARDS_EXEC : CUSTOMER_CARDS_EA;
  var indices = selectedIndustry === null
    ? cards.map(function(_, i) { return i; })
    : INDUSTRY_CUSTOMER_MAP[selectedIndustry];
  if (!indices) indices = [];
  console.log('[renderGrid] mode=' + currentMode + ' selectedIndustry=' + selectedIndustry + ' cards=' + cards.length + ' indices=' + indices.length);
  grid.innerHTML = indices.map(function(i) {
    return '<div class="cust-card" data-cust-idx="' + i + '">' + cards[i] + '</div>';
  }).join('');
  setTimeout(function() { indices.forEach(function(i) { renderMiniChart(i); }); }, 0);
}

// ── Mini chart ─────────────────────────────────────────────────────────────
function renderMiniChart(custIdx) {
  var canvas = document.getElementById('minichart-' + custIdx);
  if (!canvas) return;
  if (canvas._chart) { canvas._chart.destroy(); }
  var d = MINI_CHART_DATA[custIdx];
  if (!d) return;
  canvas._chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: [''],
      datasets: [
        { label: 'ACV',      data: [d.acv],      backgroundColor: COLORS.C_ACV,      barThickness: 10 },
        { label: 'Budget',   data: [d.budget],   backgroundColor: COLORS.C_BUDGET,   barThickness: 10 },
        { label: 'Consumed', data: [d.consumed], backgroundColor: COLORS.C_CONSUMED, barThickness: 10 }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) { return ' ' + fmtUsd(ctx.raw); } } }
      },
      scales: { x: { display: false }, y: { display: false } },
      animation: false
    }
  });
}

// ── L1 toggle (EA mode) ────────────────────────────────────────────────────
function toggleL1(custIdx, l1Idx, event) {
  if (currentMode !== 'ea') return;
  event.stopPropagation();
  var detailId = 'l1detail-' + custIdx + '-' + l1Idx;
  var detail = document.getElementById(detailId);
  if (!detail) return;
  if (detail.style.display === 'block') {
    detail.style.display = 'none';
    selectedL1 = null;
    // reset chip
    var chip = document.querySelector('[data-l1chip="' + custIdx + '"][data-l1idx="' + l1Idx + '"]');
    if (chip) { chip.style.background = 'white'; chip.style.color = '#1e293b'; chip.style.borderColor = '#e2e8f0'; }
  } else {
    // hide all other L1 details in this card
    document.querySelectorAll('[id^="l1detail-' + custIdx + '-"]').forEach(function(el) { el.style.display = 'none'; });
    // reset all chips in this card
    document.querySelectorAll('[data-l1chip="' + custIdx + '"]').forEach(function(el) {
      el.style.background = 'white'; el.style.color = '#1e293b'; el.style.borderColor = '#e2e8f0';
    });
    detail.style.display = 'block';
    selectedL1 = { custIdx: custIdx, l1Idx: l1Idx };
    var chip2 = document.querySelector('[data-l1chip="' + custIdx + '"][data-l1idx="' + l1Idx + '"]');
    if (chip2) { chip2.style.background = '#1e293b'; chip2.style.color = 'white'; chip2.style.borderColor = '#1e293b'; }
  }
}

// ── Drawer ─────────────────────────────────────────────────────────────────
function openDrawer(custIdx, l1Idx, l2Idx) {
  drawerState = { custIdx: custIdx, l1Idx: l1Idx, l2Idx: l2Idx, l3Idx: 0 };
  var key  = 'c' + custIdx + '-l1' + l1Idx + '-l2' + l2Idx;
  var data = L3_DRAWER_DATA[key];
  if (!data) return;

  document.getElementById('drawer-breadcrumb').innerHTML =
    esc(data.custName) +
    ' <span style="color:#94a3b8">›</span> ' +
    esc(data.l1Name) +
    ' <span style="color:#94a3b8">›</span> ' +
    '<strong style="color:#1e293b">' + esc(data.l2Name) + '</strong>';

  // Render solution architecture insights at L2 level (above tabs)
  var saDiv = document.getElementById('drawer-sa-insights');
  if (data.saInsights && data.saInsights.length > 0) {
    saDiv.style.display = 'block';
    saDiv.innerHTML = '<div style="font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:4px">SOLUTION INSIGHTS</div>'
      + renderInsightBullets(data.saInsights);
  } else {
    saDiv.style.display = 'none';
  }

  document.getElementById('drawer-tabs').innerHTML = data.l3List.map(function(l3, i) {
    var isActive = i === 0;
    return '<div class="l3-tab" data-l3idx="' + i + '" onclick="selectL3(' + i + ')"'
      + ' style="padding:10px 12px;font-size:11px;cursor:pointer;border-bottom:1px solid #f1f5f9;'
      + (isActive ? 'background:#1e293b;color:white' : 'background:white;color:#1e293b') + '">'
      + esc(l3.lprName.length > 28 ? l3.lprName.slice(0, 27) + '…' : l3.lprName)
      + '<div style="font-size:10px;margin-top:2px;color:' + (isActive ? 'white' : COLORS.C_PCT) + '">'
      + fmtPct(l3.attainment) + '</div></div>';
  }).join('');

  renderL3Panel(0, data);
  document.getElementById('drawer').style.height = '65vh';
}

function selectL3(l3Idx) {
  if (!drawerState) return;
  drawerState.l3Idx = l3Idx;
  var key  = 'c' + drawerState.custIdx + '-l1' + drawerState.l1Idx + '-l2' + drawerState.l2Idx;
  var data = L3_DRAWER_DATA[key];
  document.querySelectorAll('.l3-tab').forEach(function(el, i) {
    el.style.background = i === l3Idx ? '#1e293b' : 'white';
    el.style.color      = i === l3Idx ? 'white'   : '#1e293b';
    var pct_el = el.querySelector('div');
    if (pct_el) pct_el.style.color = i === l3Idx ? 'white' : COLORS.C_PCT;
  });
  renderL3Panel(l3Idx, data);
}

function renderL3Panel(l3Idx, data) {
  var l3 = data.l3List[l3Idx];
  if (!l3) return;
  var panel = document.getElementById('drawer-panel');
  var totals = l3.totals || { acv: 0, budget: 0, consumed: 0 };
  var attainmentVal = totals.budget > 0 ? (totals.consumed / totals.budget * 100) : null;
  panel.innerHTML =
    '<div style="font-size:13px;font-weight:600;color:#1e293b">' + esc(l3.lprName) + '</div>'
    + '<div style="font-size:10px;color:#94a3b8;margin-bottom:8px">' + esc(l3.lprId) + '</div>'
    + '<div style="display:flex;gap:16px;padding:8px 0;margin-bottom:8px;border-bottom:1px solid #e2e8f0;font-size:11px">'
    +   '<span style="color:#9ca3af">ACV: <strong>' + fmtUsd(totals.acv) + '</strong></span>'
    +   '<span style="color:#16a34a">Budget: <strong>' + fmtUsd(totals.budget) + '</strong></span>'
    +   '<span style="color:#ea580c">Consumed: <strong>' + fmtUsd(totals.consumed) + '</strong></span>'
    +   '<span style="color:#1d4ed8">Attainment: <strong>' + fmtPct(attainmentVal) + '</strong></span>'
    + '</div>'
    + '<div style="position:relative;height:160px"><canvas id="chart-drawer" style="height:160px;width:100%"></canvas></div>'
    + '<hr style="margin:12px 0;border:none;border-top:1px solid #e2e8f0">'
    + '<div onclick="toggleInsights(this)" style="cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;margin-bottom:6px">'
    +   '<span>Contract Insights</span>'
    +   '<span class="ins-toggle" style="font-size:12px;color:#94a3b8">&#9660;</span>'
    + '</div>'
    + BROWSER_ICON_LEGEND_HTML.replace('display:none', 'display:flex')
    + '<div class="ins-body" style="display:block">' + renderInsightBullets(l3.contractInsights) + '</div>';
  setTimeout(function() { renderDrawerChart(l3.chartData); }, 0);
}

function renderDrawerChart(chartData) {
  var canvas = document.getElementById('chart-drawer');
  if (!canvas) return;
  if (canvas._chart) { canvas._chart.destroy(); }
  if (!chartData || !chartData.labels || chartData.labels.length === 0) return;
  canvas._chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: chartData.labels,
      datasets: [
        { type:'line', label:'Budget',   data: chartData.budget,     borderColor: COLORS.C_BUDGET,   backgroundColor:'transparent', yAxisID:'y',  tension:0.3, pointRadius:3 },
        { type:'line', label:'Consumed', data: chartData.consumed,   borderColor: COLORS.C_CONSUMED, backgroundColor:'transparent', yAxisID:'y',  tension:0.3, pointRadius:3 },
        { type:'bar',  label:'Attainment%', data: chartData.attainment, backgroundColor:'rgba(99,102,241,0.2)', yAxisID:'y2' }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: function(ctx) {
          return ctx.dataset.yAxisID === 'y2' ? fmtPct(ctx.raw) : ' ' + fmtUsd(ctx.raw);
        }}}
      },
      scales: {
        y:  { position:'left',  ticks:{ callback: function(v){ return fmtUsd(v); }, font:{size:9} }, grid:{color:'#f1f5f9'} },
        y2: { position:'right', min:0, max:120, ticks:{ callback: function(v){ return v+'%'; }, font:{size:9} }, grid:{drawOnChartArea:false} },
        x:  { ticks:{ font:{size:9} }, grid:{color:'#f1f5f9'} }
      }
    }
  });
}

function closeDrawer() {
  document.getElementById('drawer').style.height = '0';
  drawerState = null;
}

// ── Boot: render all cards (show all) ──────────────────────────────────────
renderGrid();
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

  process.stderr.write(`warn: generating The Briefing HTML dashboard…\n`)
  const html = buildHtml(portfolio, bootstrapCss, bootstrapJs, iconsCss, chartJs)

  try {
    writeFileSync(outputPath, html, 'utf8')
  } catch (err) {
    throw new ProcessingError(`failed to write ${outputPath}: ${err.message}`)
  }

  process.stdout.write(`${outputPath}\n`)
  process.stderr.write(`warn: dashboard written — ${Buffer.byteLength(html, 'utf8')} bytes\n`)
}
