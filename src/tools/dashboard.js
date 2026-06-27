// @story STORY-005 | dashboard
// @intent generates a self-contained HTML architectural intelligence companion — two role views: EA (Customer→SA→SubSA→Product) and Executive (Customer→SA summary). Zero runtime network calls. v3 data model: products nested under sub_solution_areas, no risk_level display, insight/recommendation/ea_action on product objects.
// @gap 2026-06-27 Portfolio structure changed from flat c.products[] to c.solution_areas[].sub_solution_areas[].products[]; product.name replaces product.logical_product; insight/recommendation/ea_action now on product object; risk_level/risk_reason display removed; industry field added to customer

import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const CHARTJS_URL      = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js'
const BOOTSTRAP_CSS_URL = 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css'
const BOOTSTRAP_ICONS_URL = 'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css'

export class UserError extends Error {
  constructor(msg) { super(msg); this.name = 'UserError'; this.exitCode = 1 }
}
export class ProcessingError extends Error {
  constructor(msg) { super(msg); this.name = 'ProcessingError'; this.exitCode = 2 }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return ''
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function usd(n) {
  if (n == null || isNaN(n)) return '—'
  const a = Math.abs(n)
  if (a >= 1_000_000) return '$' + (n/1_000_000).toFixed(1) + 'M'
  if (a >= 1_000)     return '$' + (n/1_000).toFixed(0) + 'K'
  return '$' + Math.round(n).toLocaleString('en-US')
}

function pct(n) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toFixed(1) + '%'
}

function rc(p) {   // rag color
  if (p == null || isNaN(p)) return '#9ca3af'
  return p >= 90 ? '#16a34a' : p >= 75 ? '#d97706' : '#dc2626'
}

function rb(p) {   // rag background
  if (p == null || isNaN(p)) return '#f3f4f6'
  return p >= 90 ? '#dcfce7' : p >= 75 ? '#fef3c7' : '#fee2e2'
}

function rl(p) {   // rag label
  if (p == null || isNaN(p)) return 'NO DATA'
  return p >= 90 ? 'ON TRACK' : p >= 75 ? 'AT RISK' : 'CRITICAL'
}

function uc(u) {   // urgency color
  return u === 'IMMEDIATE' ? '#dc2626' : u === 'THIS_QUARTER' ? '#d97706' : '#6b7280'
}

function siIcon(t) {
  const m = {
    INTEGRATION_GAP:       '<i class="bi bi-lightning-charge-fill"></i>',
    DEPENDENCY_BLOCK:      '<i class="bi bi-link-45deg"></i>',
    ADOPTION_PLATEAU:      '<i class="bi bi-pause-circle-fill"></i>',
    RENEWAL_RISK:          '<i class="bi bi-exclamation-triangle-fill"></i>',
    EXPANSION_OPPORTUNITY: '<i class="bi bi-rocket-takeoff-fill"></i>',
  }
  return m[t] ?? '<i class="bi bi-circle-fill"></i>'
}
function siColor(t) {
  return { INTEGRATION_GAP:'#7c3aed', DEPENDENCY_BLOCK:'#dc2626', ADOPTION_PLATEAU:'#d97706', RENEWAL_RISK:'#dc2626', EXPANSION_OPPORTUNITY:'#16a34a' }[t] ?? '#6b7280'
}
function lcColor(p) {
  return { GREENFIELD:'#2563eb', EXPANDING:'#16a34a', PLATEAUED:'#d97706', CONTRACTING:'#dc2626', CONSOLIDATING:'#7c3aed' }[p] ?? '#6b7280'
}

function arrow(d) {
  return d === 'up'   ? '<i class="bi bi-arrow-up-short" style="color:#16a34a;font-size:1.1rem;font-weight:900"></i>'
       : d === 'down' ? '<i class="bi bi-arrow-down-short" style="color:#dc2626;font-size:1.1rem;font-weight:900"></i>'
       : '<i class="bi bi-arrow-right-short" style="color:#9ca3af;font-size:1.1rem"></i>'
}

function md(s) {   // markdown → html
  if (!s) return ''
  let h = esc(s)
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
  h = h.replace(/((?:^|\n)[ \t]*[-•][ \t]+.+)+/g, m => {
    const items = m.trim().split(/\n/).map(l => { const t=l.replace(/^[ \t]*[-•][ \t]+/,'').trim(); return t?'<li>'+t+'</li>':'' }).filter(Boolean).join('')
    return '<ul>'+items+'</ul>'
  })
  h = '<p>'+h.replace(/\n\n+/g,'</p><p>')+'</p>'
  h = h.replace(/([^>])\n([^<])/g,'$1<br>$2').replace(/<p>\s*<\/p>/g,'')
  return h
}

function sparkline(series, color='#2563eb', w=90, h=28) {
  const past = (series ?? []).slice(-6)
  if (past.length < 2) return `<svg width="${w}" height="${h}"></svg>`
  const pad=3, vals=past.map(m=>m.actual??0), max=Math.max(...vals)||1
  const pts = vals.map((v,i)=>((pad+i/(vals.length-1)*(w-pad*2)).toFixed(1))+','+(pad+(1-v/max)*(h-pad*2)).toFixed(1)).join(' ')
  return `<svg width="${w}" height="${h}" style="display:block"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
}

function attBar(p, maxW=140) {
  const fill = Math.min(100, Math.max(0, p ?? 0))
  return `<div class="att-bar-wrap">
    <div class="att-bar-track" style="max-width:${maxW}px"><div class="att-bar-fill" style="width:${fill}%;background:${rc(p)}"></div></div>
    <span style="font-size:.72rem;color:${rc(p)};font-weight:800;white-space:nowrap">${pct(p)}</span>
  </div>`
}

// ── ACV Waterfall helpers ─────────────────────────────────────────────────────
// Legend used wherever act/bud/acv values appear:
//   bi-circle-fill  Actual cACV  = consumed cACV YTD
//   bi-dash-lg      Budget cACV  = planned consumption YTD
//   bi-circle       ACV          = total contracted value (the ceiling)

const ACV_LEGEND = `<div style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:8px;align-items:center">
  <span style="display:flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;color:#475569"><i class="bi bi-circle-fill" style="color:#16a34a;font-size:.7rem"></i>Actual cACV</span>
  <span style="display:flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;color:#475569"><i class="bi bi-dash-lg" style="color:#64748b"></i>Budget cACV</span>
  <span style="display:flex;align-items:center;gap:5px;font-size:.68rem;font-weight:700;color:#475569"><i class="bi bi-circle" style="color:#6366f1;font-size:.7rem"></i>Contracted ACV</span>
</div>`

// Compact 3-tier stacked bar with legend — wider/bolder, icons on labels
function acvBar(actuals, budget, acv, maxW = 220) {
  if (!acv || acv <= 0) return attBar(budget > 0 ? (actuals / budget * 100) : null, maxW)
  const cap = Math.max(acv, actuals, budget)
  const budPct  = Math.min(100, (budget  / cap) * 100)
  const actPct  = Math.min(100, (actuals / cap) * 100)
  const attColor = rc(budget > 0 ? actuals / budget * 100 : null)
  return `<div style="margin-top:8px;max-width:${maxW}px">
    ${ACV_LEGEND}
    <div style="position:relative;height:12px;background:#f1f5f9;border-radius:6px;overflow:visible;margin-bottom:4px">
      <div style="position:absolute;left:0;top:0;height:100%;width:${budPct.toFixed(1)}%;background:#cbd5e1;border-radius:6px"></div>
      <div style="position:absolute;left:0;top:0;height:100%;width:${actPct.toFixed(1)}%;background:${attColor};border-radius:6px"></div>
      <div style="position:absolute;left:${budPct.toFixed(1)}%;top:-3px;height:18px;width:2.5px;background:#64748b;border-radius:2px"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:.72rem;font-weight:700;color:#475569;margin-top:4px">
      <span style="color:${attColor}"><i class="bi bi-circle-fill" style="font-size:.6rem"></i> ${usd(actuals)}</span>
      <span style="color:#64748b"><i class="bi bi-dash-lg"></i> ${usd(budget)}</span>
      <span style="color:#6366f1"><i class="bi bi-circle" style="font-size:.6rem"></i> ${usd(acv)}</span>
    </div>
  </div>`
}

// Full waterfall block for popup — larger, with legend and insight text
function acvWaterfall(actuals, budget, acv) {
  if (!acv || acv <= 0) return ''
  const cap = Math.max(acv, actuals, budget)
  const budPct = Math.min(100, (budget  / cap) * 100)
  const actPct = Math.min(100, (actuals / cap) * 100)
  const attColor = rc(budget > 0 ? actuals / budget * 100 : null)

  const budOfAcv = budget / acv * 100
  let paceInsight
  if (budOfAcv > 100) {
    paceInsight = `Budget exceeds contract value — the consumption plan was set more aggressively than the contract ceiling.`
  } else if (budOfAcv >= 80) {
    paceInsight = `Budget is ${budOfAcv.toFixed(0)}% of contract value — this contract assumed near-full utilization in the first year.`
  } else if (budOfAcv >= 50) {
    paceInsight = `Budget is ${budOfAcv.toFixed(0)}% of contract — a ramping consumption plan. Full contract value expected later in the year.`
  } else {
    paceInsight = `Budget is only ${budOfAcv.toFixed(0)}% of contract — either a conservative ramp plan or the contract was over-sized relative to near-term consumption intent.`
  }

  // Gap insight
  const actOfAcv = actuals / acv * 100
  const attOfBud = budget > 0 ? actuals / budget * 100 : null
  let gapInsight
  if (actOfAcv < 10) {
    gapInsight = `Only ${actOfAcv.toFixed(0)}% of contracted ACV is being consumed — renewal of the full contract value is at high risk.`
  } else if (attOfBud !== null && attOfBud < 60) {
    gapInsight = `${actOfAcv.toFixed(0)}% of contract consumed, but only ${attOfBud.toFixed(0)}% of budget attained — consumption is running significantly behind plan.`
  } else if (actuals > acv) {
    gapInsight = `Actual consumption exceeds contract value — over-consuming against the contract ceiling.`
  } else {
    gapInsight = `${actOfAcv.toFixed(0)}% of contract value consumed YTD.`
  }

  const row = (label, val, pct, color, bold = false) => `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:90px;font-size:.72rem;color:#64748b;flex-shrink:0;font-weight:${bold?'700':'400'}">${label}</div>
      <div style="flex:1;background:#f1f5f9;border-radius:4px;height:10px;position:relative;overflow:hidden">
        <div style="position:absolute;left:0;top:0;height:100%;width:${Math.min(100,pct).toFixed(1)}%;background:${color};border-radius:4px"></div>
      </div>
      <div style="width:72px;text-align:right;font-size:.78rem;font-weight:${bold?'800':'600'};color:${color};flex-shrink:0">${usd(val)}</div>
    </div>`

  return `<div style="margin-top:4px">
    ${row('Contracted ACV', acv, 100, '#e2e8f0')}
    ${row('YTD Budget', budget, budPct, '#94a3b8')}
    ${row('YTD Actual', actuals, actPct, attColor, true)}
    <div style="font-size:.78rem;color:#475569;margin-top:8px;line-height:1.5;padding:8px 10px;background:#f8fafc;border-radius:6px">${paceInsight}</div>
    <div style="font-size:.78rem;color:${actOfAcv < 15 ? '#dc2626' : '#475569'};margin-top:6px;line-height:1.5;padding:8px 10px;background:${actOfAcv < 15 ? '#fff5f5' : '#f8fafc'};border-radius:6px">${gapInsight}</div>
  </div>`
}


function custTrend(c) {
  // Traverse nested hierarchy: solution_areas → sub_solution_areas → products
  const map = {}
  for (const sa of c.solution_areas??[])
    for (const sub of sa.sub_solution_areas??[])
      for (const p of sub.products??[])
        for (const ms of p.monthly_series??[])
          map[ms.month]=(map[ms.month]??0)+(ms.actual??0)
  return Object.entries(map).sort((a,b)=>a[0].localeCompare(b[0])).map(([m,actual])=>({month:m,actual}))
}

// Helper: collect all products for a customer as a flat array (for exec ACV rollups)
function custAllProds(c) {
  const out = []
  for (const sa of c.solution_areas??[])
    for (const sub of sa.sub_solution_areas??[])
      for (const p of sub.products??[])
        out.push(p)
  return out
}

// ── Pre-render HTML blocks that JS will inject via innerHTML ──────────────────
// All HTML is generated at build time; JS only does show/hide and innerHTML swaps.

// ── Shared: SA → SubSA → Product hierarchy ────────────────────────────────────
// Used by both Exec and EA views. role='exec' = compact rows; role='ea' = rich cards.
// Returns HTML string rendering all SAs as header groups, each SubSA collapsible,
// products listed within SubSA sorted worst-attainment first.


// ── Inline SVG icons (Bootstrap Icons subset, self-contained/offline) ────────
const BI = {
  arrowUp:    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8 15a.5.5 0 0 0 .5-.5V2.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L7.5 2.707V14.5a.5.5 0 0 0 .5.5"/></svg>',
  arrowDown:  '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8 1a.5.5 0 0 1 .5.5v11.793l3.146-3.147a.5.5 0 0 1 .708.708l-4 4a.5.5 0 0 1-.708 0l-4-4a.5.5 0 0 1 .708-.708L7.5 13.293V1.5A.5.5 0 0 1 8 1"/></svg>',
  arrowRight: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1 8a.5.5 0 0 1 .5-.5h11.793l-3.147-3.146a.5.5 0 0 1 .708-.708l4 4a.5.5 0 0 1 0 .708l-4 4a.5.5 0 0 1-.708-.708L13.293 8.5H1.5A.5.5 0 0 1 1 8"/></svg>',
  lightning:  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M5.52.359A.5.5 0 0 1 6 0h4a.5.5 0 0 1 .491.592l-.895 4.473h3.904a.5.5 0 0 1 .353.854l-8 8a.5.5 0 0 1-.815-.504l.895-4.473H1.5a.5.5 0 0 1-.354-.854z"/></svg>',
  link:       '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1 1 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4 4 0 0 1-.128-1.287z"/><path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z"/></svg>',
  pause:      '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 3.5A1.5 1.5 0 0 1 7 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5m5 0A1.5 1.5 0 0 1 12 5v6a1.5 1.5 0 0 1-3 0V5a1.5 1.5 0 0 1 1.5-1.5"/></svg>',
  warning:    '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.15.15 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.2.2 0 0 1-.054.06.1.1 0 0 1-.066.017H1.146a.1.1 0 0 1-.066-.017.2.2 0 0 1-.054-.06.18.18 0 0 1 .002-.183L7.884 2.073a.15.15 0 0 1 .054-.057m1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767z"/><path d="M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0M7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0z"/></svg>',
  rocket:     '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8 0c-.176 0-.35.006-.523.017l-.064.007-.062.007a8 8 0 0 0-1.628.48 7 7 0 0 0-1.504.87 6.6 6.6 0 0 0-1.15 1.2 5.4 5.4 0 0 0-.765 1.498 4.5 4.5 0 0 0-.217 1.3 4 4 0 0 0 .065.718 4.4 4.4 0 0 0 .267.881l.002.003.013.03.031.066a5 5 0 0 0 .14.254 6 6 0 0 0 .22.319c.08.104.168.205.263.3a4.5 4.5 0 0 0 .616.477 5.3 5.3 0 0 0 .737.375 7 7 0 0 0 .836.27c.295.073.604.12.918.141A9 9 0 0 0 8 10a9 9 0 0 0 1.748-.173 7 7 0 0 0 .836-.27 5.3 5.3 0 0 0 .737-.375 4.5 4.5 0 0 0 .616-.477 4 4 0 0 0 .263-.3 6 6 0 0 0 .22-.319 5 5 0 0 0 .14-.254l.031-.066.013-.03.002-.003a4.4 4.4 0 0 0 .267-.881 4 4 0 0 0 .065-.718 4.5 4.5 0 0 0-.217-1.3 5.4 5.4 0 0 0-.765-1.498 6.6 6.6 0 0 0-1.15-1.2 7 7 0 0 0-1.504-.87A8 8 0 0 0 8.649.031L8.585.024 8.523.017A9 9 0 0 0 8 0M5.072 7.785c-.587-.235-1.08-.573-1.424-1.039l.868-.495c.22.296.529.543.908.707zm5.856 0 .648-1.074-.648-.37c.55-.164 1.01-.43 1.29-.826l.868.495c-.344.466-.837.804-1.424 1.039z"/></svg>',
  dotFill:    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="8" r="8"/></svg>',
  dot:        '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="currentColor" viewBox="0 0 16 16"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/></svg>',
  dash:       '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M2 8a.5.5 0 0 1 .5-.5h11a.5.5 0 0 1 0 1h-11A.5.5 0 0 1 2 8"/></svg>',
  chevronRight: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708"/></svg>',
  chevronDown:  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path fill-rule="evenodd" d="M1.646 4.646a.5.5 0 0 1 .708 0L8 10.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708"/></svg>',
  person:     '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6m2-3a2 2 0 1 1-4 0 2 2 0 0 1 4 0m4 8c0 1-1 1-1 1H3s-1 0-1-1 1-4 6-4 6 3 6 4m-1-.004c-.001-.246-.154-.986-.832-1.664C11.516 10.68 10.289 10 8 10s-3.516.68-4.168 1.332c-.678.678-.83 1.418-.832 1.664z"/></svg>',
  briefcase:  '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16"><path d="M6.5 1A1.5 1.5 0 0 0 5 2.5V3H1.5A1.5 1.5 0 0 0 0 4.5v8A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-8A1.5 1.5 0 0 0 14.5 3H11v-.5A1.5 1.5 0 0 0 9.5 1zm0 1h3a.5.5 0 0 1 .5.5V3H6v-.5a.5.5 0 0 1 .5-.5m1.886 6.914L15 7.151V12.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5V7.15l6.614 1.764a1.5 1.5 0 0 0 .772 0M1.5 4h13a.5.5 0 0 1 .5.5v1.616L8.129 7.948a.5.5 0 0 1-.258 0L1 6.116V4.5a.5.5 0 0 1 .5-.5"/></svg>',
}

function biArrow(dir, monthCount) {
  const tip = monthCount ? `title="Trend over last ${Math.min(3, monthCount)} reported month${Math.min(3, monthCount)!==1?'s':''}"` : ''
  if (dir === 'up')   return `<span style="color:#16a34a" ${tip}>${BI.arrowUp}</span>`
  if (dir === 'down') return `<span style="color:#dc2626" ${tip}>${BI.arrowDown}</span>`
  return `<span style="color:#9ca3af" ${tip}>${BI.arrowRight}</span>`
}

function biSignal(type) {
  const m = {
    INTEGRATION_GAP: BI.lightning,
    DEPENDENCY_BLOCK: BI.link,
    ADOPTION_PLATEAU: BI.pause,
    RENEWAL_RISK: BI.warning,
    EXPANSION_OPPORTUNITY: BI.rocket,
  }
  return m[type] ?? BI.dotFill
}

// ── Three-bar ACV row (updated to use SVG icons) ─────────────────────────────
function acvRow(actuals, budget, acv, maxW = 260) {
  if (!acv || acv <= 0) {
    // Fallback: simple attainment bar
    const pp = budget > 0 ? actuals / budget * 100 : null
    const fill = Math.min(100, Math.max(0, pp ?? 0))
    return `<div style="display:flex;align-items:center;gap:8px;margin-top:4px">
      <div style="flex:1;max-width:${maxW}px;background:#f1f5f9;border-radius:3px;height:8px;position:relative">
        <div style="height:8px;border-radius:3px;background:${rc(pp)};width:${fill.toFixed(1)}%"></div>
      </div>
      <span style="font-size:13px;font-weight:700;color:${rc(pp)}">${pct(pp)}</span>
    </div>`
  }
  const cap = Math.max(acv, actuals, budget)
  const budPct = Math.min(100, budget  / cap * 100)
  const actPct = Math.min(100, actuals / cap * 100)
  const attColor = rc(budget > 0 ? actuals / budget * 100 : null)
  return `<div style="margin-top:5px;max-width:${maxW}px">
    <div style="position:relative;height:10px;background:#e9ecef;border-radius:5px;overflow:visible">
      <div style="position:absolute;left:0;top:0;height:100%;width:${budPct.toFixed(1)}%;background:#adb5bd;border-radius:5px"></div>
      <div style="position:absolute;left:0;top:0;height:100%;width:${actPct.toFixed(1)}%;background:${attColor};border-radius:5px"></div>
      <div style="position:absolute;left:${budPct.toFixed(1)}%;top:-3px;height:16px;width:2px;background:#495057;border-radius:1px"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:3px;font-size:12px;font-weight:600;max-width:${maxW}px">
      <span style="color:${attColor};display:flex;align-items:center;gap:3px">${BI.dotFill} ${usd(actuals)}</span>
      <span style="color:#6c757d;display:flex;align-items:center;gap:3px">${BI.dash} ${usd(budget)}</span>
      <span style="color:#6366f1;display:flex;align-items:center;gap:3px">${BI.dot} ${usd(acv)}</span>
    </div>
  </div>`
}

// ── Compact ACV legend (shown once per section) ───────────────────────────────
const ACV_LEGEND_ROW = `<div style="display:flex;gap:16px;align-items:center;padding:4px 0 8px;border-bottom:1px solid #dee2e6;margin-bottom:4px">
  <span style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#495057">${BI.dotFill} <span style="color:#6c757d">Actual cACV consumed</span></span>
  <span style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#495057">${BI.dash} <span style="color:#6c757d">Budget cACV (YTD plan)</span></span>
  <span style="display:flex;align-items:center;gap:5px;font-size:12px;font-weight:600;color:#495057">${BI.dot} <span style="color:#6c757d">Contracted ACV (ceiling)</span></span>
</div>`

// ── Main HTML ─────────────────────────────────────────────────────────────────
function buildHtml(portfolio, chartjsScript, bootstrapCss, bootstrapIconsCss) {
  const fy = portfolio.fiscal_year ? `FY${portfolio.fiscal_year}` : 'FY—'
  const rm = (() => {
    const r = portfolio.reporting_month; if (!r) return '—'
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    const p = String(r).split('-')
    return p.length === 2 ? `${mo[parseInt(p[1],10)-1]} ${p[0]}` : r
  })()
  const customers = portfolio.customers ?? []
  const ai        = portfolio.ai_insights ?? {}
  const perCust   = ai.per_customer ?? {}
  const execAI    = ai.executive_view ?? {}
  const signals   = ai.architectural_signals ?? []
  const custHealthMap = {}
  for (const h of execAI.portfolio_health_by_customer ?? []) custHealthMap[h.customer_name] = h

  // ── Build the full data tree as HTML rows ─────────────────────────────────
  // Each row has a data-key attribute for JS selection routing
  // ── Color constants for consistent ACV/Budget/Actual display ─────────────
  // Actual cACV:  RAG color (green/amber/red based on attainment)
  // Budget cACV:  #6c757d (gray)
  // ACV contract: #6f42c1 (purple)
  const C_BUDGET = '#6c757d'
  const C_ACV    = '#6f42c1'

  // Inline money display: $$ prominent left, % plain right-aligned number
  function custMoneyLine(actuals, budget, acv, attPct) {
    const attColor = rc(attPct)
    return `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:6px">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
          <span style="font-size:26px;font-weight:900;color:${attColor};letter-spacing:-.02em;line-height:1">${usd(actuals)} <span style="font-size:13px;font-weight:600;color:${attColor}90">cACV</span></span>
          <span style="font-size:13px;color:${C_BUDGET};font-weight:600">${usd(budget)} <span style="font-size:11px;font-weight:500">budget</span></span>
          ${acv > 0 ? `<span style="font-size:13px;color:${C_ACV};font-weight:600">${usd(acv)} <span style="font-size:11px;font-weight:500">ACV</span></span>` : ''}
        </div>
      </div>
      <span style="font-size:16px;font-weight:800;color:${attColor};flex-shrink:0">${pct(attPct)}</span>
    </div>`
  }

  // SA header summary line — $$ first, % plain right
  function saMoneyLine(actuals, budget, acv, attPct) {
    const attColor = rc(attPct)
    return `<span style="font-size:14px;font-weight:700;color:${attColor}">${usd(actuals)}</span>
      <span style="font-size:12px;color:${C_BUDGET};font-weight:500;margin-left:6px">/ ${usd(budget)}</span>
      ${acv > 0 ? `<span style="font-size:12px;color:${C_ACV};font-weight:500;margin-left:6px">/ ${usd(acv)} ACV</span>` : ''}
      <span style="font-size:13px;font-weight:800;color:${attColor};margin-left:10px">${pct(attPct)}</span>`
  }

  // LPR stacked bar — wide (uses full available width via CSS variable)
  function lprBar(actuals, budget, acv) {
    if (!budget || budget <= 0) return ''
    const cap = Math.max(acv || 0, actuals, budget)
    const budPct = Math.min(100, budget  / cap * 100)
    const actPct = Math.min(100, actuals / cap * 100)
    const attColor = rc(actuals / budget * 100)
    const acvPct = acv > 0 ? Math.min(100, acv / cap * 100) : null

    return `<div class="lpr-bar-wrap">
      <div class="lpr-bar-track">
        ${acvPct ? `<div style="position:absolute;left:0;top:0;height:100%;width:${acvPct.toFixed(1)}%;background:${C_ACV}22;border-radius:5px;border-right:2px solid ${C_ACV}80"></div>` : ''}
        <div style="position:absolute;left:0;top:0;height:100%;width:${budPct.toFixed(1)}%;background:#dee2e6;border-radius:5px"></div>
        <div style="position:absolute;left:0;top:0;height:100%;width:${actPct.toFixed(1)}%;background:${attColor};border-radius:5px"></div>
        <div style="position:absolute;left:${budPct.toFixed(1)}%;top:-3px;height:18px;width:2.5px;background:#495057;border-radius:2px"></div>
      </div>
      <div class="lpr-bar-labels">
        <span style="color:${attColor};font-weight:700">${usd(actuals)}</span>
        <span style="color:${C_BUDGET};font-weight:500">/ ${usd(budget)}</span>
        ${acv > 0 ? `<span style="color:${C_ACV};font-weight:500;margin-left:4px">/ ${usd(acv)} ACV</span>` : ''}
      </div>
    </div>`
  }

  // Hierarchy: customer > sa (as section header) > sub-SA > lpr
  // v3: products live in sa.sub_solution_areas[].products[] — not in a flat c.products[]
  function buildTreeRows(role) {
    const pfx = role
    return customers.map((c, ci) => {
      const cAI        = perCust[c.customer_name] ?? {}
      const execH  = custHealthMap[c.customer_name] ?? {}
      const cp     = c.summary?.overall_attainment_pct
      const hLabel = execH.health ?? rl(cp)
      const hColor = { STRONG:'#16a34a', STABLE:'#1a6fb3', AT_RISK:'#d97706', CRITICAL:'#dc2626' }[hLabel] ?? rc(cp)
      const custKey = `${pfx}-c${ci}`
      // Collect ACV from nested products
      const custAcv = custAllProds(c).reduce((s,p) => s + (p.ytd_acv_act ?? 0), 0)
      const trend = custTrend(c)

      // Customer row — prominent header
      const industryTag = c.industry ? `<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:4px;background:#e9ecef;color:#6c757d;margin-left:4px">${esc(c.industry)}</span>` : ''
      const custRow = `<div class="tree-row tree-customer" data-key="${custKey}" data-ci="${ci}" onclick="selectRow(this,'${custKey}')">
        <div class="tree-indent-0">
          <div class="tree-expand-btn" onclick="event.stopPropagation();toggleTree('${custKey}')">${BI.chevronDown}</div>
        </div>
        <div class="tree-content">
          <div class="tree-main" style="flex-direction:column;align-items:flex-start;gap:4px">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span class="tree-name" style="font-size:18px;font-weight:800;color:#212529">${esc(c.customer_name)}</span>
              ${industryTag}
              <span style="width:11px;height:11px;border-radius:50%;background:${hColor};display:inline-block;flex-shrink:0" title="${esc(hLabel)}"></span>
            </div>
            ${custMoneyLine(c.summary?.total_ytd_actuals, c.summary?.total_ytd_target, custAcv, cp)}
          </div>
        </div>
      </div>`

      // SA sections — each SA is a non-clickable header divider + SubSA blocks
      const saBlocks = (c.solution_areas ?? []).map((sa, si) => {
        const saKey  = `${pfx}-c${ci}-sa${si}`
        // v3: ACV from sub_solution_areas products
        const saAcv = (sa.sub_solution_areas??[]).reduce((t,sub) =>
          t + (sub.products??[]).reduce((s,p) => s + (p.ytd_acv_act??0), 0), 0)

        const saHeader = `<div class="tree-sa-header" data-key="${saKey}" onclick="selectRow(this,'${saKey}')">
          <div class="tree-indent-1" style="padding-left:14px">
            <div class="tree-expand-btn" onclick="event.stopPropagation();toggleTree('${saKey}')">${BI.chevronDown}</div>
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
              <span style="font-size:15px;font-weight:700;color:#212529">${esc(sa.name)}</span>
              ${saMoneyLine(sa.ytd_actuals, sa.ytd_target, saAcv, sa.attainment_pct)}
            </div>
          </div>
        </div>`

        // v3: iterate sub_solution_areas directly — products are already grouped
        const lprBlocks = (sa.sub_solution_areas ?? []).map((sub, subi) => {
          const sortedProds = (sub.products??[]).slice().sort((a,b) => (a.ytd_attainment_pct ?? 999) - (b.ytd_attainment_pct ?? 999))
          if (!sortedProds.length) return ''

          const subKey = `${pfx}-c${ci}-sa${si}-sub${subi}`
          const subLabel = sub.name ? `<div class="tree-subsalabel" data-key="${subKey}" onclick="selectRow(this,'${subKey}')">
            <span class="tree-indent-2-inline"></span>
            <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#adb5bd">${esc(sub.name)}</span>
          </div>` : ''

          const lprRows = sortedProds.map((p, pi) => {
            const pp = p.ytd_attainment_pct
            const lprKey = `${pfx}-c${ci}-sa${si}-sub${subi}-lpr${pi}`
            const attColor = rc(pp)

            const mo3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

            // Build inline SVG: line chart + data table fused into one block.
            // Layout (top→bottom): chart area → month labels → Act row → Bud row → Att% row
            const series = (p.monthly_series ?? []).slice().sort((a,b)=>(a.month||'').localeCompare(b.month||''))
            const svgW = 500
            const chartH = 48   // height of the line chart area
            const rowH   = 16   // height of each text data row
            const lblY   = chartH + 14        // month label baseline
            const actY   = lblY + rowH        // Act row baseline
            const budY   = actY + rowH        // Bud row baseline
            const attY   = budY + rowH        // Att% row baseline
            const totalH = attY + 6           // total SVG height
            const padX   = 20

            const lineChartSvg = (() => {
              if (series.length < 1) return ''
              const vals = series.map(m => m.actual ?? 0)
              const maxVal = Math.max(...vals, 1)
              const xOf = i => padX + (series.length > 1 ? i / (series.length - 1) : 0.5) * (svgW - padX * 2)

              // Polyline points
              const pts = vals.map((v, i) => `${xOf(i).toFixed(1)},${(4 + (1 - v / maxVal) * (chartH - 8)).toFixed(1)}`).join(' ')

              // Per-column data
              const cols = series.map((m, i) => {
                const monthNum = parseInt(String(m.month ?? '').slice(4), 10)
                const lbl = mo3[(monthNum - 1) % 12] ?? ''
                const act = m.actual ?? 0
                const tgt = m.target ?? 0
                const att = tgt > 0 ? act / tgt * 100 : null
                const actColor = rc(att)
                const attColor3 = rc(att)
                return { x: xOf(i), lbl, act, tgt, att, actColor, attColor3 }
              })

              const monthLabels = cols.map(c =>
                `<text x="${c.x.toFixed(1)}" y="${lblY}" text-anchor="middle" font-size="12" font-weight="700" fill="#adb5bd">${c.lbl}</text>`
              ).join('')

              const actLabels = cols.map(c =>
                `<text x="${c.x.toFixed(1)}" y="${actY}" text-anchor="middle" font-size="11" font-weight="700" fill="${c.actColor}">${usd(c.act)}</text>`
              ).join('')

              const budLabels = cols.map(c =>
                `<text x="${c.x.toFixed(1)}" y="${budY}" text-anchor="middle" font-size="11" fill="#6c757d">${usd(c.tgt)}</text>`
              ).join('')

              const attLabels = cols.map(c =>
                `<text x="${c.x.toFixed(1)}" y="${attY}" text-anchor="middle" font-size="11" font-weight="700" fill="${rc(c.att)}">${c.att != null ? pct(c.att) : '—'}</text>`
              ).join('')

              // Row labels on the left
              const rowLabels = `
                <text x="0" y="${actY}" text-anchor="start" font-size="10" font-weight="700" fill="#adb5bd" letter-spacing="0.5">ACT</text>
                <text x="0" y="${budY}" text-anchor="start" font-size="10" font-weight="700" fill="#adb5bd" letter-spacing="0.5">BUD</text>
                <text x="0" y="${attY}" text-anchor="start" font-size="10" font-weight="700" fill="#adb5bd" letter-spacing="0.5">ATT%</text>`

              return `<svg viewBox="0 0 ${svgW} ${totalH}" width="100%" height="${totalH * 0.72}" style="display:block;overflow:visible">
                ${series.length >= 2 ? `<polyline points="${pts}" fill="none" stroke="${attColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
                ${vals.map((v, i) => `<circle cx="${xOf(i).toFixed(1)}" cy="${(4 + (1 - v / maxVal) * (chartH - 8)).toFixed(1)}" r="3" fill="${attColor}"/>`).join('')}
                ${monthLabels}
                <line x1="${padX}" y1="${lblY - 11}" x2="${svgW - padX}" y2="${lblY - 11}" stroke="#e9ecef" stroke-width="1"/>
                ${rowLabels}
                ${actLabels}
                ${budLabels}
                ${attLabels}
              </svg>`
            })()

            // Labeled bar — transparency layering: actual (opaque) → budget (semi) → ACV (light)
            // When actual > budget or ACV, darker actual color still visible through lighter overlays
            const labeledBar = (() => {
              const act = p.ytd_actuals ?? 0
              const bud = p.ytd_target ?? 0
              const acv = p.ytd_acv_act ?? 0
              // Cap is the largest value — bars scale relative to this
              const cap = Math.max(acv, act, bud, 1)
              const actPct = Math.min(100, act / cap * 100)
              const budPct = Math.min(100, bud / cap * 100)
              const acvPct = acv > 0 ? Math.min(100, acv / cap * 100) : null
              const attColor2 = rc(bud > 0 ? act / bud * 100 : null)

              return `<div style="margin:10px 0 6px;width:100%">
                <div style="position:relative;height:32px;border-radius:6px;overflow:hidden;background:#f1f3f5">
                  ${acvPct ? `<div style="position:absolute;left:0;top:0;height:100%;width:${acvPct.toFixed(1)}%;background:${C_ACV};opacity:0.9;border-radius:6px 0 0 6px"></div>` : ''}
                  <div style="position:absolute;left:0;top:0;height:100%;width:${budPct.toFixed(1)}%;background:#8fa0b5;opacity:0.6;border-radius:6px 0 0 6px"></div>
                  <div style="position:absolute;left:0;top:0;height:100%;width:${actPct.toFixed(1)}%;background:${attColor2};opacity:0.35;border-radius:6px 0 0 6px"></div>
                </div>
                <div style="display:flex;gap:12px;margin-top:4px;font-size:9px;font-weight:600">
                  <span style="color:${attColor2}">${BI.dotFill} ${usd(act)} actual</span>
                  <span style="color:#6c757d">${BI.dash} ${usd(bud)} budget</span>
                  ${acv > 0 ? `<span style="color:${C_ACV}">${BI.dot} ${usd(acv)} ACV</span>` : ''}
                </div>
              </div>`
            })()

            return `<div class="tree-row tree-lpr" data-key="${lprKey}" data-ci="${ci}" data-sa="${esc(sa.name)}" data-sub="${esc(sub.name??'')}" data-lpr="${esc(p.name??p.lpr??'')}" onclick="selectRow(this,'${lprKey}')">
              <div class="tree-indent-3"></div>
              <div class="tree-content" style="align-items:flex-start;gap:0">
                <!-- Left 30%: LPR name + attainment + recommendation -->
                <div style="width:28%;min-width:160px;padding-right:16px;flex-shrink:0">
                  <div style="display:flex;align-items:flex-start;gap:6px">
                    <span style="width:8px;height:8px;border-radius:50%;background:${attColor};display:inline-block;flex-shrink:0;margin-top:3px"></span>
                    <div>
                      <div class="tree-name" style="font-size:13px;font-weight:600;color:#212529;line-height:1.3">${esc(p.name??p.lpr??'')}</div>
                      <div style="font-size:13px;font-weight:800;color:${attColor};margin-top:2px">${pct(pp)}</div>
                      ${p.recommendation ? `<div style="font-size:12px;color:#495057;line-height:1.55;margin-top:6px">${esc(p.recommendation)}</div>` : ''}
                    </div>
                  </div>
                </div>
                <!-- Right 70%: labeled bar + fused line chart + data table -->
                <div style="flex:1;min-width:0;padding:4px 0">
                  ${labeledBar}
                  ${lineChartSvg}
                </div>
              </div>
            </div>`
          }).join('')

          return `${subLabel}${lprRows}`
        }).join('')

        return `${saHeader}<div class="tree-children" id="tree-${saKey}">${lprBlocks}</div>`
      }).join('')

      return `${custRow}<div class="tree-children" id="tree-${custKey}">${saBlocks}</div>`
    }).join('')
  }

  // ── Right panel companion content per selection ────────────────────────────
  // Pre-render companion HTML for every selectable key, embedded as JSON in the page
  // v3: product insight/recommendation/ea_action come from product object directly
  function buildCompanionData() {
    const data = {}

    customers.forEach((c, ci) => {
      const cAI   = perCust[c.customer_name] ?? {}
      const execH = custHealthMap[c.customer_name] ?? {}

      // Customer level
      const custKey = `c${ci}`
      data[custKey] = {
        title: c.customer_name,
        subtitle: (c.industry ? c.industry + ' · ' : '') + (cAI.landscape_pattern?.replace(/_/g,' ') || ''),
        observation: cAI.architectural_summary || '',
        signals: (cAI.key_signals ?? []).map(s => ({
          type: s.signal_type,
          title: s.title,
          products: s.products_involved ?? [],
          pattern: s.pattern || '',
          action: s.action || '',
        })),
        actions: cAI.ea_recommended_actions ?? [],
        exec: {
          headline: execH.headline || '',
          top_risk: execH.top_risk || '',
          recommended_ask: execH.recommended_ask || '',
        },
      }

      // SA level
      c.solution_areas.forEach((sa, si) => {
        const saKey = `c${ci}-sa${si}`
        const saSignals = (cAI.key_signals ?? []).filter(s =>
          (s.products_involved ?? []).some(pname =>
            (sa.sub_solution_areas??[]).some(sub => (sub.products??[]).find(p => p.name === pname))
          )
        )
        data[saKey] = {
          title: sa.name,
          subtitle: c.customer_name,
          observation: saSignals.length ? saSignals[0].pattern : (cAI.architectural_summary || ''),
          signals: saSignals.map(s => ({ type: s.signal_type, title: s.title, products: s.products_involved ?? [], pattern: s.pattern, action: s.action })),
          actions: [],
          exec: {},
        }

        // SubSA level
        sa.sub_solution_areas?.forEach((sub, subi) => {
          const subKey = `c${ci}-sa${si}-sub${subi}`
          const subSignals = (cAI.key_signals ?? []).filter(s =>
            (s.products_involved ?? []).some(pname => (sub.products??[]).find(p => p.name === pname))
          )
          data[subKey] = {
            title: sub.name,
            subtitle: sa.name + ' · ' + c.customer_name,
            observation: subSignals.length ? subSignals[0].explanation || subSignals[0].pattern : '',
            signals: subSignals.map(s => ({ type: s.signal_type, title: s.title, products: s.products_involved ?? [], pattern: s.pattern, action: s.action })),
            actions: [],
            exec: {},
          }

          // LPR (product) level — v3: insight/recommendation/ea_action come from product object
          ;(sub.products??[]).slice().sort((a,b) => (a.ytd_attainment_pct??999) - (b.ytd_attainment_pct??999))
            .forEach((p, pi) => {
              const lprKey = `c${ci}-sa${si}-sub${subi}-lpr${pi}`
              data[lprKey] = {
                title: p.name || p.lpr || '',
                subtitle: sub.name + ' · ' + c.customer_name,
                observation: p.insight || '',
                recommendation: p.recommendation || '',
                signals: [],
                actions: p.ea_action ? [p.ea_action] : [],
                exec: {},
                lpr: {
                  ytd_actuals: p.ytd_actuals,
                  ytd_target: p.ytd_target,
                  ytd_acv_act: p.ytd_acv_act,
                  contract_utilization_pct: p.contract_utilization_pct,
                  ytd_attainment_pct: p.ytd_attainment_pct,
                },
              }
            })
        })
      })
    })

    // ── Executive-specific entries ────────────────────────────────────────
    // Portfolio level
    data['exec-portfolio'] = {
      title: 'Portfolio Overview',
      subtitle: `${customers.length} customers · ${fy} · thru ${rm}`,
      observation: execAI.opening || '',
      signals: (ai.architectural_signals ?? []).map(s => ({
        type: s.signal_type, title: s.title,
        products: s.products_involved ?? [],
        pattern: s.pattern, action: s.action_for_ea,
      })),
      actions: [],
      exec: {
        risks: execAI.portfolio_risks ?? [],
        opportunities: execAI.portfolio_opportunities ?? [],
      },
    }

    // Executive customer entries (prefixed exec-c${ci})
    customers.forEach((c, ci) => {
      const execH = custHealthMap[c.customer_name] ?? {}
      const cAI   = (ai.per_customer ?? {})[c.customer_name] ?? {}
      // v3: use risk_items for critical/high products; on-track from nested products
      const critProds = c.risk_items?.filter(r => r.risk_level==='CRITICAL'||r.risk_level==='critical') ?? []
      const highProds  = c.risk_items?.filter(r => r.risk_level==='HIGH'||r.risk_level==='high') ?? []
      const allProds   = custAllProds(c)
      const onTrackProds = allProds.filter(p => (p.ytd_attainment_pct ?? 0) >= 90)
      // Customer-specific signals from per_customer.key_signals
      const custSignals = (cAI.key_signals ?? []).map(s => ({
        type: s.signal_type, title: s.title,
        products: s.products_involved ?? [],
        pattern: s.pattern,
        explanation: s.explanation || '',
        action: s.action || '',
      }))
      data[`exec-c${ci}`] = {
        title: c.customer_name,
        subtitle: (c.industry ? c.industry + ' · ' : '') + (execH.health?.replace(/_/g,' ') || ''),
        observation: execH.headline || cAI.architectural_summary || '',
        signals: custSignals,
        actions: [],
        exec: {
          headline: execH.headline || '',
          top_risk: execH.top_risk || '',
          recommended_ask: execH.recommended_ask || '',
          // QBR data from per_customer — richer than executive_view
          qbr_opening: cAI.qbr?.opening || '',
          qbr_key_points: cAI.qbr?.key_points || [],
          qbr_recommended_ask: cAI.qbr?.recommended_ask || '',
          qbr_questions: cAI.qbr?.questions_they_will_ask || [],
          // Renewal risks for this customer
          renewal_risks: (ai.renewal_risks ?? []).filter(r => r.customer_name === c.customer_name),
          // Momentum items for this customer
          momentum: (ai.momentum ?? []).filter(m => m.customer_name === c.customer_name),
          sa_breakdown: c.solution_areas.map(sa => ({
            name: sa.name,
            att: sa.attainment_pct,
            actuals: sa.ytd_actuals,
            budget: sa.ytd_target,
          })),
          crit_products_detail: [...critProds, ...highProds].slice(0, 8).map(p => ({
            name: p.logical_product,
            att: p.ytd_attainment_pct,
          })),
          healthy_products_detail: onTrackProds.slice(0, 6).map(p => ({
            name: p.name || p.lpr || '',
            att: p.ytd_attainment_pct,
          })),
        },
      }

      // Executive SA entries (prefixed exec-c${ci}-sa${si})
      c.solution_areas.forEach((sa, si) => {
        // v3: collect products from sub_solution_areas
        const saProds = (sa.sub_solution_areas??[]).flatMap(sub => sub.products??[])
        const saSignals = (cAI.key_signals ?? []).filter(s =>
          (s.products_involved ?? []).some(pname => saProds.find(sp => sp.name === pname))
        )
        // v3: no risk_level on products — derive from attainment
        const critSaProds = saProds.filter(p => (p.ytd_attainment_pct ?? 100) < 75)
        const prodSummary = saProds.length
          ? `${saProds.length} products: ${saProds.filter(p=>p.ytd_attainment_pct!=null).slice().sort((a,b)=>(a.ytd_attainment_pct??999)-(b.ytd_attainment_pct??999)).slice(0,3).map(p=>`${p.name??p.lpr??''} ${pct(p.ytd_attainment_pct)}`).join(', ')}${saProds.length>3?'…':''}`
          : ''
        data[`exec-c${ci}-sa${si}`] = {
          title: sa.name,
          subtitle: c.customer_name,
          observation: saSignals.length ? saSignals[0].pattern : prodSummary,
          signals: saSignals.map(s => ({ type: s.signal_type, title: s.title, products: s.products_involved ?? [], pattern: s.pattern, action: s.action })),
          actions: [],
          exec: {
            crit_products: critSaProds.map(p => p.name??p.lpr??'').join(', '),
            product_summary: prodSummary,
          },
        }
      })
    })

    return JSON.stringify(data).replace(/<\/script>/gi, '<\\/script>')
  }

  function buildExecCenter() {
    const totalAcv  = customers.reduce((t,c) => t + custAllProds(c).reduce((s,p) => s+(p.ytd_acv_act||0), 0), 0)
    const riskItems = execAI.portfolio_risks ?? []
    const oppItems  = execAI.portfolio_opportunities ?? []

    // ── Helpers ──────────────────────────────────────────────────────────────
    const healthColor = h => ({ STRONG:'#16a34a', STABLE:'#1a6fb3', AT_RISK:'#d97706', CRITICAL:'#dc2626' }[h] ?? '#6c757d')
    const healthLabel = h => ({ STRONG:'Strong', STABLE:'Stable', AT_RISK:'At Risk', CRITICAL:'Critical' }[h] ?? h ?? '—')
    const healthBg    = h => ({ STRONG:'#f0fdf4', STABLE:'#eff6ff', AT_RISK:'#fffbeb', CRITICAL:'#fff1f2' }[h] ?? '#f8f9fa')

    // ── Industry aggregation ──────────────────────────────────────────────────
    const industryMap = new Map()
    for (const c of customers) {
      const ind = c.industry || 'Unknown'
      if (!industryMap.has(ind)) industryMap.set(ind, { customers: [], custObjs: [], actuals: 0, target: 0, acv: 0 })
      const g = industryMap.get(ind)
      g.customers.push(c.customer_name)
      g.custObjs.push(c)
      g.actuals += c.summary?.total_ytd_actuals ?? 0
      g.target  += c.summary?.total_ytd_target ?? 0
      g.acv     += custAllProds(c).reduce((s,p) => s+(p.ytd_acv_act||0), 0)
    }

    // ── Portfolio pulse strip ─────────────────────────────────────────────────
    const attPct = s.overall_attainment_pct
    const attColor = rc(attPct)
    const gap = s.total_ytd_target - s.total_ytd_actuals
    const portfolioStrip = `
      <div class="ep-pulse" data-key="exec-portfolio" onclick="selectRow(this,'exec-portfolio')">
        <div class="ep-kpis">
          <div class="ep-kpi">
            <div class="ep-kval" style="color:${attColor}">${pct(attPct)}</div>
            <div class="ep-klbl">YTD Attainment</div>
          </div>
          <div class="ep-kpi">
            <div class="ep-kval" style="color:#1a6fb3">${usd(s.total_ytd_actuals)}</div>
            <div class="ep-klbl">Consumed cACV</div>
          </div>
          <div class="ep-kpi">
            <div class="ep-kval" style="color:#6c757d">${usd(s.total_ytd_target)}</div>
            <div class="ep-klbl">Budget cACV</div>
          </div>
          <div class="ep-kpi">
            <div class="ep-kval" style="color:${C_ACV}">${usd(totalAcv)}</div>
            <div class="ep-klbl">Contracted ACV</div>
          </div>
          ${gap > 0 ? `<div class="ep-kpi">
            <div class="ep-kval" style="color:#dc2626">${usd(gap)}</div>
            <div class="ep-klbl">Budget Gap</div>
          </div>` : ''}
        </div>
        ${execAI.opening ? `<div class="ep-narrative">${esc(execAI.opening)}</div>` : ''}
      </div>`

    // ── Risk / Opportunity bar ────────────────────────────────────────────────
    const riskOppBar = (riskItems.length || oppItems.length) ? `
      <div class="ep-riskopp">
        ${riskItems.length ? `<div class="ep-riskopp-col">
          <div class="ep-riskopp-hdr ep-risk-hdr">${BI.warning} Exposure Areas</div>
          ${riskItems.map(r => `<div class="ep-riskopp-item ep-risk-item">${esc(r)}</div>`).join('')}
        </div>` : ''}
        ${oppItems.length ? `<div class="ep-riskopp-col">
          <div class="ep-riskopp-hdr ep-opp-hdr">${BI.rocket} Expansion Opportunities</div>
          ${oppItems.map(o => `<div class="ep-riskopp-item ep-opp-item">${esc(o)}</div>`).join('')}
        </div>` : ''}
      </div>` : ''

    // Color key criteria (shown once at top of customer grid)
    const colorKey = `<div class="ep-color-key">
      <span class="ep-ck-label">Attainment</span>
      <span class="ep-ck-item"><span class="ep-ck-dot" style="background:#16a34a"></span>≥ 90% on track</span>
      <span class="ep-ck-item"><span class="ep-ck-dot" style="background:#d97706"></span>75–89% watch</span>
      <span class="ep-ck-item"><span class="ep-ck-dot" style="background:#dc2626"></span>&lt; 75% action needed</span>
    </div>`

    // ── Customer cards ────────────────────────────────────────────────────────
    const custCards = customers.map((c, ci) => {
      const custKey = `exec-c${ci}`
      const execH   = custHealthMap[c.customer_name] ?? {}
      const cp      = c.summary?.overall_attainment_pct
      const cardColor = rc(cp)
      const custAcv = custAllProds(c).reduce((s,p) => s+(p.ytd_acv_act??0), 0)

      // Solution area rows — color-coded by attainment
      const saRows = (c.solution_areas ?? []).map(sa => {
        const saColor = rc(sa.attainment_pct)
        return `<div class="ec-sa-row">
          <span class="ec-sa-dot" style="background:${saColor}"></span>
          <span class="ec-sa-name">${esc(sa.name)}</span>
          <span class="ec-sa-nums">
            <span style="color:${saColor};font-weight:700">${usd(sa.ytd_actuals)}</span>
            <span class="ec-sa-sep">/</span>
            <span style="color:#6c757d">${usd(sa.ytd_target)}</span>
            <span class="ec-sa-att" style="color:${saColor}">${pct(sa.attainment_pct)}</span>
          </span>
        </div>`
      }).join('')

      return `<div class="ec-card" data-key="${custKey}" onclick="selectRow(this,'${custKey}')" style="border-top:3px solid ${cardColor}">
        <div class="ec-card-header">
          <div>
            <div class="ec-card-name">${esc(c.customer_name)}</div>
            <div class="ec-card-meta">
              ${c.industry ? `<span class="ec-industry-tag">${esc(c.industry)}</span>` : ''}
            </div>
          </div>
          <div class="ec-card-totals">
            <div class="ec-card-act" style="color:${cardColor}">${usd(c.summary?.total_ytd_actuals)}</div>
            <div class="ec-card-subvals">
              <span style="color:#6c757d">${usd(c.summary?.total_ytd_target)} bud</span>
              <span style="color:${C_ACV}">${usd(custAcv)} ACV</span>
              <span style="color:${cardColor};font-weight:800">${pct(cp)}</span>
            </div>
          </div>
        </div>
        ${execH.headline ? `<div class="ec-card-headline">${esc(execH.headline)}</div>` : ''}
        <div class="ec-sa-section">${saRows}</div>
        ${execH.recommended_ask ? `<div class="ec-card-ask">${BI.arrowRight} ${esc(execH.recommended_ask)}</div>` : ''}
      </div>`
    }).join('')

    // ── Industry section ─────────────────────────────────────────────────────
    const industrySection = industryMap.size > 1 ? `
      <div class="ep-industry">
        <div class="ep-section-hdr">Industry Perspective</div>
        <div class="ep-industry-grid">
          ${[...industryMap.entries()].map(([ind, g]) => {
            const att = g.target > 0 ? g.actuals/g.target*100 : null
            const iColor = rc(att)
            const custInsights = g.custObjs.map(c => {
              const cAI = (perCust ?? {})[c.customer_name] ?? {}
              return { summary: cAI.architectural_summary || '', signals: cAI.key_signals ?? [], actions: cAI.ea_recommended_actions ?? [] }
            }).filter(ci => ci.summary)
            const topInsight = custInsights[0]?.summary?.split('.')[0] + '.' ?? ''
            const allSignalTypes = custInsights.flatMap(ci => ci.signals.map(s => s.signal_type))
            const signalFreq = allSignalTypes.reduce((m, t) => { m[t]=(m[t]||0)+1; return m }, {})
            const topSignal = Object.entries(signalFreq).sort((a,b)=>b[1]-a[1])[0]
            const topAction = custInsights.flatMap(ci => ci.actions)[0] || ''
            return `<div class="ep-ind-card" style="border-left:3px solid ${iColor}">
              <div class="ep-ind-header">
                <div>
                  <div class="ep-ind-name">${esc(ind)}</div>
                  <div class="ep-ind-custs">${g.customers.map(n=>n.split(' ')[0]).join(' · ')}</div>
                </div>
                <div class="ep-ind-kpis">
                  <span style="font-size:18px;font-weight:900;color:${iColor}">${usd(g.actuals)}</span>
                  <span style="font-size:12px;color:#6c757d">/ ${usd(g.target)}</span>
                  <span style="font-size:13px;font-weight:700;color:${iColor}">${pct(att)}</span>
                </div>
              </div>
              ${topSignal ? `<div class="ep-ind-signal" style="color:${siColor(topSignal[0])};background:${siColor(topSignal[0])}15">${esc(topSignal[0].replace(/_/g,' '))} across ${topSignal[1]} customer${topSignal[1]>1?'s':''}</div>` : ''}
              ${topInsight ? `<div class="ep-ind-insight">${esc(topInsight.slice(0,140))}${topInsight.length>140?'…':''}</div>` : ''}
              ${topAction ? `<div class="ep-ind-action">${esc(topAction.slice(0,110))}${topAction.length>110?'…':''}</div>` : ''}
            </div>`
          }).join('')}
        </div>
      </div>` : ''

    return `${portfolioStrip}${riskOppBar}${colorKey}<div class="ep-cust-grid">${custCards}</div>${industrySection}`
  }

  const s = portfolio.summary ?? {}
  const treeRowsEA    = buildTreeRows('ea')
  const execCenter    = buildExecCenter()
  const companionData = buildCompanionData()
  const portfolioJson = JSON.stringify(portfolio).replace(/<\/script>/gi,'<\\/script>')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SAP cACV Companion — ${esc(fy)}</title>
${bootstrapCss ? `<style>${bootstrapCss}</style>` : '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css">'}
<style>
/* ── Base ── */
:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --c-critical: #dc3545;
  --c-high:     #fd7e14;
  --c-medium:   #ffc107;
  --c-ok:       #198754;
  --c-stable:   #0d6efd;
  --c-muted:    #6c757d;
  --rail-w: 200px;
  --right-w: 340px;
  --hdr-h: 52px;
}
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { font-family: var(--font-sans); font-size: 15px; line-height: 1.5; background: #f8f9fa; color: #212529; overflow: hidden; }
p { margin: 0 0 .4rem; } ul { padding-left: 1.3em; margin-bottom: .4rem; } li { margin-bottom: .2rem; }

/* ── Header ── */
.app-header {
  position: fixed; top: 0; left: 0; right: 0; height: var(--hdr-h); z-index: 100;
  background: #1e2d3d; color: #f8f9fa;
  display: flex; align-items: center; gap: 16px; padding: 0 20px;
  box-shadow: 0 1px 6px rgba(0,0,0,.3);
}
.hdr-title { font-size: 16px; font-weight: 700; letter-spacing: -.01em; color: #fff; }
.hdr-meta  { font-size: 13px; color: #8496a9; }
.hdr-health { font-size: 12px; font-weight: 700; padding: 3px 10px; border-radius: 20px; letter-spacing: .05em; }
.hdr-pulse { font-size: 13px; color: #8496a9; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 600px; font-style: italic; }

/* ── Role tabs ── */
.role-tabs { display: flex; gap: 2px; margin-left: auto; }
.role-tab  { padding: 6px 16px; border: none; background: transparent; color: #8496a9; font-size: 14px; font-weight: 600; border-bottom: 2px solid transparent; cursor: pointer; transition: all .15s; }
.role-tab:hover { color: #fff; }
.role-tab.active { color: #fff; border-bottom-color: #4dabf7; }

/* ── Three-panel layout ── */
.app-body { display: flex; height: 100vh; padding-top: var(--hdr-h); }

/* Left rail — navigation tree */
.left-rail {
  width: var(--rail-w); flex-shrink: 0;
  background: #fff; border-right: 1px solid #dee2e6;
  overflow-y: auto; overflow-x: hidden;
  position: sticky; top: var(--hdr-h);
  height: calc(100vh - var(--hdr-h));
}
.rail-section { padding: 8px 0; border-bottom: 1px solid #f1f3f5; }
.rail-hdr { padding: 6px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: #adb5bd; }
.rail-item { display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 13px; color: #495057; cursor: pointer; border-left: 3px solid transparent; transition: all .1s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-item:hover { background: #f8f9fa; color: #212529; }
.rail-item.active { background: #e7f5ff; color: #1971c2; border-left-color: #1971c2; font-weight: 600; }
.rail-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.rail-pct { margin-left: auto; font-size: 12px; font-weight: 700; flex-shrink: 0; }

/* Center — data tree */
.center-panel {
  flex: 1; min-width: 0;
  overflow-y: auto;
  background: #f8f9fa;
}
.center-header {
  position: sticky; top: 0; z-index: 10;
  background: #fff; border-bottom: 2px solid #dee2e6;
  padding: 10px 20px; display: flex; align-items: center; justify-content: space-between;
}
.center-title { font-size: 15px; font-weight: 700; color: #212529; }
.center-kpis { display: flex; gap: 24px; }
.kpi-item { text-align: center; }
.kpi-val  { font-size: 20px; font-weight: 800; line-height: 1.1; }
.kpi-lbl  { font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: .06em; margin-top: 1px; font-weight: 600; }

/* Tree rows */
.tree-section { padding: 8px 0; }
.tree-legend  { padding: 6px 20px 4px; }
.tree-row {
  display: flex; align-items: flex-start; gap: 0;
  padding: 10px 20px; border-bottom: 1px solid #e9ecef;
  cursor: pointer; transition: background .1s;
}
.tree-row:hover { background: #e9ecef !important; }
.tree-row.selected { background: #dbe4ff !important; border-left: 4px solid #4c6ef5; }
/* Customer rows — white with strong bottom border */
.tree-customer {  background: #fff;  padding: 16px 20px;  border-bottom: 3px solid #343a40 !important;  border-left: 5px solid transparent;}.tree-customer.selected { border-left-color: #4c6ef5 !important; background: #edf2ff !important; }.tree-customer + .tree-children { border-left: 4px solid #e9ecef; margin-left: 20px; }/* SA section header */.tree-sa-header {  display: flex; align-items: center; gap: 10px;  padding: 10px 20px;  background: #f1f3f5;  border-bottom: 1px solid #ced4da;  border-top: 2px solid #dee2e6;  cursor: pointer;}.tree-sa-header:hover { background: #e9ecef; }.tree-sa-header.selected { background: #dbe4ff; border-left: 3px solid #4c6ef5; }/* Sub-SA inline label */.tree-subsalabel {  display: flex; align-items: center;  padding: 5px 20px 3px;  background: #f8f9fa;  border-bottom: 1px dashed #dee2e6;}.tree-indent-2-inline { display: inline-block; width: 36px; }/* LPR rows */.tree-lpr { background: #fff; padding: 10px 20px; border-bottom: 1px solid #f1f3f5; }.tree-lpr:hover { background: #f8f9fa !important; }.tree-lpr.selected { background: #dbe4ff !important; border-left: 4px solid #4c6ef5; }.tree-lpr:last-child { border-bottom: 1px solid #dee2e6; }/* LPR stacked bar — ~half the center panel width */.lpr-bar-wrap { margin-top: 5px; }.lpr-bar-track {  position: relative; height: 12px;  background: #e9ecef; border-radius: 6px;  overflow: visible; width: min(500px, 46vw);  margin-bottom: 4px;}.lpr-bar-labels {  display: flex; gap: 6px; align-items: baseline;  font-size: 12px; width: min(500px, 46vw);}

.tree-indent-0 { width: 28px; flex-shrink: 0; padding-top: 2px; }
.tree-indent-1 { width: 28px; flex-shrink: 0; padding-left: 14px; padding-top: 2px; }
.tree-indent-2 { width: 28px; flex-shrink: 0; padding-left: 24px; padding-top: 2px; }
.tree-indent-3 { width: 28px; flex-shrink: 0; padding-left: 32px; }
.tree-expand-btn { cursor: pointer; color: #adb5bd; line-height: 1; padding: 2px; transition: transform .15s; }
.tree-expand-btn:hover { color: #495057; }
.tree-expand-btn.collapsed { transform: rotate(-90deg); }

.tree-content { flex: 1; min-width: 0; display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; }
.tree-main    { flex: 1; min-width: 200px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 2px; }
.tree-metrics { flex: 1; min-width: 300px; max-width: 480px; }
.tree-name    { font-weight: 600; color: #212529; }
.tree-badge   { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
.tree-pct     { font-size: 22px; font-weight: 800; line-height: 1.1; display: block; }
.tree-children {}
.tree-children.hidden { display: none; }

/* Right panel — AI companion */
.right-panel {
  width: var(--right-w); flex-shrink: 0;
  background: #fff; border-left: 1px solid #dee2e6;
  overflow-y: auto;
  height: calc(100vh - var(--hdr-h));
  position: sticky; top: var(--hdr-h);
}
.companion-header {
  padding: 16px 18px 12px; border-bottom: 2px solid #f1f3f5;
  position: sticky; top: 0; background: #fff; z-index: 5;
}
.companion-title    { font-size: 15px; font-weight: 700; color: #212529; margin-bottom: 2px; }
.companion-subtitle { font-size: 12px; color: #6c757d; font-weight: 500; }
.companion-body     { padding: 16px 18px; }

.companion-section        { margin-bottom: 20px; }
.companion-section-label  { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .09em; color: #adb5bd; margin-bottom: 8px; }
.companion-observation    { font-size: 14px; color: #343a40; line-height: 1.65; }
.companion-empty          { font-size: 13px; color: #adb5bd; font-style: italic; }

.signal-block { background: #f8f9fa; border-radius: 8px; padding: 12px 14px; margin-bottom: 10px; border-left: 4px solid; }
.signal-block-type  { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; display: flex; align-items: center; gap: 5px; margin-bottom: 6px; }
.signal-block-title { font-size: 14px; font-weight: 700; color: #212529; margin-bottom: 6px; }
.signal-block-prods { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 6px; }
.signal-prod-chip   { font-size: 11px; font-weight: 600; background: #e9ecef; color: #495057; padding: 2px 7px; border-radius: 4px; }
.signal-block-text  { font-size: 13px; color: #495057; line-height: 1.55; }
.signal-block-action { font-size: 13px; color: #1971c2; background: #e7f5ff; padding: 8px 10px; border-radius: 6px; margin-top: 8px; line-height: 1.5; }

.action-item-comp { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 10px; }
.action-num-comp  { width: 22px; height: 22px; border-radius: 50%; background: #6366f1; color: #fff; font-size: 11px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 1px; }
.action-text-comp { font-size: 14px; color: #343a40; line-height: 1.55; }

.lpr-detail-block { background: #f8f9fa; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
.lpr-metric-row   { display: flex; justify-content: space-between; margin-bottom: 8px; }
.lpr-metric-val   { font-size: 18px; font-weight: 800; line-height: 1.1; }
.lpr-metric-lbl   { font-size: 11px; font-weight: 600; color: #6c757d; text-transform: uppercase; letter-spacing: .06em; margin-top: 2px; }

.exec-block { background: #f0f9ff; border-radius: 8px; padding: 14px; margin-bottom: 10px; border-left: 4px solid #0ea5e9; }
.exec-risk  { background: #fff5f5; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; border-left: 4px solid #dc3545; font-size: 13px; color: #212529; line-height: 1.55; }
.exec-ask   { background: #f0fdf4; border-radius: 8px; padding: 10px 14px; border-left: 4px solid #198754; font-size: 13px; color: #212529; line-height: 1.55; }

/* ── Executive center layout ── */
.exec-center { padding: 0; }

/* Portfolio banner */
.exec-portfolio-banner {
  padding: 24px 28px;
  background: #fff;
  color: #212529;
  cursor: pointer;
  transition: background .15s;
  border-bottom: 3px solid #dee2e6;
}
.exec-portfolio-banner:hover { background: #f8f9fa; }
.exec-portfolio-banner.selected { background: #edf2ff; border-left: 5px solid #4c6ef5; }
.exec-banner-kpis { display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 14px; }
.exec-banner-kpi { text-align: left; }
.exec-banner-val { font-size: 28px; font-weight: 900; line-height: 1.1; letter-spacing: -.03em; }
.exec-banner-lbl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: #6c757d; margin-top: 3px; }
.exec-banner-narrative { font-size: 15px; color: #495057; line-height: 1.65; margin-bottom: 16px; font-style: italic; border-top: 1px solid #dee2e6; padding-top: 14px; }
.exec-banner-split { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 14px; border-top: 1px solid #dee2e6; padding-top: 16px; }
.exec-banner-half { display: flex; flex-direction: column; gap: 4px; }
.exec-half-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #6c757d; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
.exec-half-item { font-size: 13px; line-height: 1.6; padding: 6px 0; border-bottom: 1px solid #f1f3f5; }
.exec-half-item:last-child { border-bottom: none; }
.exec-half-risk { color: #dc3545; }
.exec-half-opp  { color: #198754; }
@media(max-width:700px){.exec-banner-split{grid-template-columns:1fr}}

/* ── Executive view v2 ── */
.ep-pulse {
  padding: 24px 28px 20px;
  background: #fff;
  border-bottom: 2px solid #e9ecef;
  cursor: pointer;
  transition: background .15s;
}
.ep-pulse:hover { background: #f8f9fa; }
.ep-pulse.selected { background: #edf2ff; border-left: 5px solid #4c6ef5; }
.ep-kpis { display: flex; gap: 28px; flex-wrap: wrap; align-items: flex-end; margin-bottom: 14px; }
.ep-kpi { text-align: left; }
.ep-kval { font-size: 26px; font-weight: 900; line-height: 1.1; letter-spacing: -.03em; }
.ep-klbl { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .07em; color: #6c757d; margin-top: 3px; }
.ep-narrative { font-size: 14px; color: #495057; line-height: 1.65; font-style: italic; border-top: 1px solid #e9ecef; padding-top: 12px; }

.ep-riskopp { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 2px solid #e9ecef; }
@media(max-width:700px){.ep-riskopp{grid-template-columns:1fr}}
.ep-riskopp-col { padding: 16px 24px; }
.ep-riskopp-col:first-child { border-right: 1px solid #e9ecef; }
.ep-riskopp-hdr { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; display: flex; align-items: center; gap: 6px; }
.ep-risk-hdr { color: #dc2626; }
.ep-opp-hdr  { color: #16a34a; }
.ep-riskopp-item { font-size: 13px; line-height: 1.6; padding: 7px 0; border-bottom: 1px solid #f1f3f5; }
.ep-riskopp-item:last-child { border-bottom: none; }
.ep-risk-item { color: #343a40; }
.ep-opp-item  { color: #343a40; }

.ep-cust-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); }
.ec-card {
  padding: 20px 22px;
  background: #fff;
  border-bottom: 1px solid #e9ecef;
  border-right: 1px solid #e9ecef;
  cursor: pointer;
  transition: background .12s;
}
.ec-card:hover { background: #f8f9fa; }
.ec-card.selected { background: #edf2ff; }
.ec-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
.ec-card-name { font-size: 18px; font-weight: 900; color: #212529; letter-spacing: -.01em; line-height: 1.2; }
.ec-card-meta { display: flex; align-items: center; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
.ec-health-badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 10px; }
.ec-industry-tag { font-size: 11px; color: #6c757d; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: #e9ecef; }
.ec-card-totals { text-align: right; flex-shrink: 0; }
.ec-card-act { font-size: 22px; font-weight: 900; letter-spacing: -.02em; line-height: 1.1; }
.ec-card-subvals { font-size: 11px; margin-top: 3px; display: flex; gap: 6px; justify-content: flex-end; flex-wrap: wrap; }
.ec-card-headline { font-size: 13px; color: #343a40; line-height: 1.6; margin-bottom: 8px; }
.ec-card-risk { font-size: 12px; color: #dc2626; background: #fff1f2; padding: 6px 10px; border-left: 3px solid #dc2626; border-radius: 0 5px 5px 0; margin-bottom: 6px; line-height: 1.5; display: flex; align-items: flex-start; gap: 5px; }
.ec-card-concern  { font-size: 12px; color: #dc2626; background: #fff1f2; padding: 6px 10px; border-left: 3px solid #dc2626; border-radius: 0 5px 5px 0; margin-bottom: 4px; line-height: 1.5; display: flex; align-items: flex-start; gap: 5px; }
.ec-card-positive { font-size: 12px; color: #16a34a; background: #f0fdf4; padding: 6px 10px; border-left: 3px solid #16a34a; border-radius: 0 5px 5px 0; margin-bottom: 8px; line-height: 1.5; display: flex; align-items: flex-start; gap: 5px; }
.ec-card-ask { font-size: 12px; color: #1a6fb3; background: #eff6ff; padding: 6px 10px; border-left: 3px solid #1a6fb3; border-radius: 0 5px 5px 0; margin-top: 8px; line-height: 1.5; display: flex; align-items: flex-start; gap: 5px; }
.ec-lpr-section { margin-bottom: 10px; }
.ec-lpr-hdr { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #adb5bd; margin-bottom: 4px; }
.ec-lpr-row { display: flex; justify-content: space-between; align-items: baseline; padding: 4px 0; border-bottom: 1px solid #f1f3f5; font-size: 12px; }
.ec-lpr-name { color: #495057; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.ec-lpr-nums { display: flex; align-items: baseline; gap: 3px; flex-shrink: 0; }
.ec-lpr-sep { color: #adb5bd; font-size: 10px; }
.ec-lpr-att { font-size: 11px; font-weight: 700; margin-left: 6px; }
.ec-momentum-row { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; }
.ec-momentum-chip { font-size: 11px; font-weight: 600; color: #16a34a; background: #f0fdf4; border: 1px solid #bbf7d0; padding: 2px 8px; border-radius: 10px; }
.ec-renewal-pill { font-size: 11px; font-weight: 700; color: #dc2626; background: #fff1f2; border: 1px solid #fecaca; padding: 2px 8px; border-radius: 10px; }

/* Color key bar */
.ep-color-key { display: flex; align-items: center; gap: 16px; padding: 8px 24px; background: #f8f9fa; border-bottom: 1px solid #e9ecef; flex-wrap: wrap; }
.ep-ck-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #adb5bd; }
.ep-ck-item { display: flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 600; color: #495057; }
.ep-ck-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }

/* SA rows in customer cards */
.ec-sa-section { margin: 8px 0 6px; }
.ec-sa-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-bottom: 1px solid #f1f3f5; font-size: 12px; }
.ec-sa-row:last-child { border-bottom: none; }
.ec-sa-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.ec-sa-name { color: #495057; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-sa-nums { display: flex; align-items: baseline; gap: 3px; flex-shrink: 0; }
.ec-sa-sep { color: #adb5bd; font-size: 10px; }
.ec-sa-att { font-size: 11px; font-weight: 700; margin-left: 5px; }

.ep-industry { padding: 20px 24px; background: #f8f9fa; border-top: 2px solid #e9ecef; }
.ep-section-hdr { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: #6c757d; margin-bottom: 12px; }
.ep-industry-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.ep-ind-card { background: #fff; border-radius: 8px; padding: 14px 16px; }
.ep-ind-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 8px; }
.ep-ind-name { font-size: 14px; font-weight: 800; color: #212529; }
.ep-ind-custs { font-size: 11px; color: #6c757d; margin-top: 2px; }
.ep-ind-kpis { text-align: right; display: flex; flex-direction: column; gap: 2px; }
.ep-ind-signal { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px; display: inline-block; margin-bottom: 6px; }
.ep-ind-insight { font-size: 12px; color: #495057; line-height: 1.5; margin-bottom: 6px; }
.ep-ind-action { font-size: 11px; color: #1a6fb3; background: #eff6ff; padding: 5px 8px; border-radius: 5px; line-height: 1.4; }

/* Customer card grid — 2 columns on wide, 1 on narrow */
.exec-cust-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 0;
}
.exec-cust-card {
  padding: 22px 24px;
  background: #fff;
  border-bottom: 1px solid #dee2e6;
  border-right: 1px solid #dee2e6;
  cursor: pointer;
  transition: background .12s;
  border-left: 5px solid transparent;
}
.exec-cust-card:hover { background: #f8f9fa; }
.exec-cust-card.selected { background: #edf2ff; border-left-color: #4c6ef5; }
.exec-cust-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.exec-cust-name { font-size: 20px; font-weight: 900; color: #212529; letter-spacing: -.01em; }
.exec-health-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
.exec-cust-status { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
.exec-cust-att { font-size: 32px; font-weight: 900; line-height: 1; letter-spacing: -.04em; }
.exec-cust-money { font-size: 13px; line-height: 1.5; }
.exec-cust-headline { font-size: 14px; color: #343a40; line-height: 1.6; margin-bottom: 8px; }
.exec-cust-risk { font-size: 13px; color: #dc3545; background: #fff5f5; padding: 7px 10px; border-left: 3px solid #dc3545; border-radius: 0 6px 6px 0; margin-bottom: 10px; line-height: 1.5; display: flex; align-items: flex-start; gap: 6px; }
.exec-cust-risk svg { flex-shrink: 0; margin-top: 1px; }
.exec-cust-pills { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px; }
.exec-prod-pill { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 12px; display: inline-flex; align-items: center; gap: 4px; }
.exec-prod-pill-crit { background: #fee2e2; color: #dc3545; }
.exec-prod-pill-ok   { background: #d1fae5; color: #065f46; }
.exec-prod-pill-more { background: #f1f5f9; color: #64748b; }
.exec-cust-cta { font-size: 12px; color: #adb5bd; font-weight: 600; margin-top: 2px; }

/* ── Popup (ACV waterfall detail) ── */
.popup-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; backdrop-filter: blur(2px); }
.popup-overlay.hidden { display: none; }
.popup-box { background: #fff; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,.2); max-width: 580px; width: 100%; max-height: 80vh; overflow-y: auto; }
.popup-hdr { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 14px; border-bottom: 1px solid #dee2e6; position: sticky; top: 0; background: #fff; z-index: 1; border-radius: 16px 16px 0 0; }
.popup-hdr-title { font-weight: 700; font-size: 16px; color: #212529; }
.popup-close { background: #f1f3f5; border: none; color: #6c757d; padding: 4px 9px; border-radius: 6px; font-size: 15px; cursor: pointer; }
.popup-close:hover { background: #dee2e6; }
.popup-body { padding: 18px 20px; }
.popup-section { margin-bottom: 18px; }
.popup-section:last-child { margin-bottom: 0; }
.popup-section-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .09em; color: #adb5bd; margin-bottom: 8px; }
.popup-text { font-size: 14px; color: #343a40; line-height: 1.65; }
.popup-note { font-size: 14px; color: #1971c2; background: #e7f5ff; padding: 12px 14px; border-radius: 8px; border-left: 3px solid #339af0; line-height: 1.6; }
.popup-numbers { display: flex; gap: 18px; flex-wrap: wrap; background: #f8f9fa; padding: 14px; border-radius: 8px; margin-bottom: 6px; }
.popup-num { text-align: center; }
.popup-num-val { font-size: 22px; font-weight: 800; line-height: 1.1; }
.popup-num-lbl { font-size: 11px; color: #6c757d; text-transform: uppercase; letter-spacing: .06em; font-weight: 600; margin-top: 2px; }

@media (max-width: 1024px) {
  :root { --right-w: 280px; --rail-w: 160px; }
}
@media (max-width: 768px) {
  .left-rail { display: none; }
  :root { --right-w: 0px; }
  .right-panel { display: none; }
}
</style>
</head>
<body>

<!-- Header -->
<header class="app-header">
  <span class="hdr-title">SAP cACV Companion</span>
  <span class="hdr-meta">${esc(fy)} · thru ${esc(rm)} · ${customers.length} customer${customers.length!==1?'s':''}</span>
  <div class="role-tabs">
    <button class="role-tab active" data-role="ea" onclick="setRole('ea')">Enterprise Architect</button>
    <button class="role-tab" data-role="exec" onclick="setRole('exec')">Executive</button>
  </div>
</header>

<!-- Popup -->
<div class="popup-overlay hidden" id="popup-overlay" onclick="closePopup(event)">
  <div class="popup-box" onclick="event.stopPropagation()">
    <div class="popup-hdr">
      <div class="popup-hdr-title" id="popup-title"></div>
      <button class="popup-close" onclick="closePopup()">✕</button>
    </div>
    <div class="popup-body" id="popup-body"></div>
  </div>
</div>

<!-- Three-panel body -->
<div class="app-body">

  <!-- Left rail — customer navigation -->
  <nav class="left-rail">
    <div class="rail-section">
      <div class="rail-hdr">Customers</div>
      ${customers.map((c, ci) => {
        const cp = c.summary?.overall_attainment_pct
        const execH = custHealthMap[c.customer_name] ?? {}
        const hColor = { STRONG:'#198754', STABLE:'#0d6efd', AT_RISK:'#fd7e14', CRITICAL:'#dc3545' }[execH.health ?? rl(cp)] ?? rc(cp)
        return `<div class="rail-item" data-ci="${ci}" onclick="scrollToRow(currentRole+'-c${ci}')">
          <span class="rail-dot" style="background:${hColor}"></span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.customer_name.split(' ')[0])}</span>
          <span class="rail-pct" style="color:${hColor}">${pct(cp)}</span>
        </div>`
      }).join('')}
    </div>
    ${signals.length ? `<div class="rail-section">
      <div class="rail-hdr">Signals (${signals.length})</div>
      ${signals.map((sig, si) => {
        const color = siColor(sig.signal_type)
        return `<div class="rail-item" style="border-left-color:${color}" onclick="showSignalPopup(${si})">
          <span style="color:${color};flex-shrink:0">${biSignal(sig.signal_type)}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px">${esc(sig.title)}</span>
        </div>`
      }).join('')}
    </div>` : ''}
    <div class="rail-section">
      <div class="rail-hdr">Portfolio KPIs</div>
      <div style="padding: 8px 12px; display:flex; flex-direction:column; gap:8px">
        <div>
          <div style="font-size:18px;font-weight:800;color:${rc(s.overall_attainment_pct)}">${pct(s.overall_attainment_pct)}</div>
          <div style="font-size:11px;color:#6c757d;font-weight:600;text-transform:uppercase;letter-spacing:.06em">Attainment</div>
        </div>
        <div>
          <div style="font-size:16px;font-weight:700;color:#212529">${usd(s.total_ytd_actuals)}</div>
          <div style="font-size:11px;color:#6c757d;font-weight:600;text-transform:uppercase;letter-spacing:.06em">YTD Actuals</div>
        </div>
        <div>
          <div style="font-size:16px;font-weight:700;color:#212529">${usd(s.total_ytd_target)}</div>
          <div style="font-size:11px;color:#6c757d;font-weight:600;text-transform:uppercase;letter-spacing:.06em">YTD Budget</div>
        </div>
        <canvas id="exec-donut" width="80" height="80" style="margin-top:4px"></canvas>
      </div>
    </div>
  </nav>

  <!-- Center — data tree -->
  <main class="center-panel" id="center-panel">
    <!-- EA view -->
    <div id="view-ea">
      <div class="center-header">
        <div class="center-title">Enterprise Architect View — Customer · SA · Sub-SA · Product</div>
      </div>
      <div class="tree-legend">${ACV_LEGEND_ROW}</div>
      <div class="tree-section">${treeRowsEA}</div>
    </div>
    <!-- Exec view -->
    <div id="view-exec" style="display:none">
      <div class="center-header">
        <div class="center-title">Executive View</div>
        <div class="center-kpis">
          <div class="kpi-item"><div class="kpi-val" style="color:${rc(s.overall_attainment_pct)}">${pct(s.overall_attainment_pct)}</div><div class="kpi-lbl">Attainment thru ${esc(rm)}</div></div>
          <div class="kpi-item"><div class="kpi-val" style="color:#1971c2">${usd(s.total_ytd_actuals)}</div><div class="kpi-lbl">YTD Actuals</div></div>
          <div class="kpi-item"><div class="kpi-val" style="color:${C_ACV}">${usd(customers.reduce((t,c)=>t+custAllProds(c).reduce((s,p)=>s+(p.ytd_acv_act||0),0),0))}</div><div class="kpi-lbl">Portfolio ACV</div></div>
        </div>
      </div>
      <div class="exec-center">${execCenter}</div>
    </div>
  </main>

  <!-- Right panel — AI companion -->
  <aside class="right-panel" id="right-panel">
    <div class="companion-header">
      <div class="companion-title" id="companion-title">Select a row to see insights</div>
      <div class="companion-subtitle" id="companion-subtitle"></div>
    </div>
    <div class="companion-body" id="companion-body">
      <div class="companion-empty">Click any customer, solution area, or product in the left panel to see architectural analysis, signals, and EA priority actions.</div>
    </div>
  </aside>
</div>

<script>${chartjsScript}</script>
<script>
const P = ${portfolioJson};
const COMPANION = ${companionData};
const CR = {};
let currentRole = 'ea';
const SIG_COLORS = {
  INTEGRATION_GAP:'#7c3aed', DEPENDENCY_BLOCK:'#dc3545', ADOPTION_PLATEAU:'#fd7e14',
  RENEWAL_RISK:'#dc3545', EXPANSION_OPPORTUNITY:'#198754'
};

// ── Role switching ─────────────────────────────────────────────────────────
function setRole(role) {
  currentRole = role;
  document.querySelectorAll('.role-tab').forEach(b => b.classList.toggle('active', b.dataset.role === role));
  document.getElementById('view-ea').style.display   = role === 'ea'   ? '' : 'none';
  document.getElementById('view-exec').style.display = role === 'exec' ? '' : 'none';

  if (role === 'ea') {
    // Select + expand first customer
    const firstRow = document.querySelector('[data-key="ea-c0"]');
    if (firstRow) { selectRow(firstRow, 'ea-c0'); toggleTree('ea-c0'); }
  } else {
    // Executive: select the portfolio summary card
    initDonut();
    const portfolioCard = document.querySelector('[data-key="exec-portfolio"]');
    if (portfolioCard) selectRow(portfolioCard, 'exec-portfolio');
  }
}

// ── Exec customer card toggle (expand/collapse SA list) ───────────────────
function execToggle(el, custKey, saListId) {
  // Deselect + close all exec customer cards
  document.querySelectorAll('.exec-cust-card').forEach(c => {
    c.classList.remove('selected');
    const listId = c.getAttribute('onclick')?.match(/exec-sa-(\d+)/)?.[0];
    if (listId) {
      const list = document.getElementById(listId);
      if (list) list.style.display = 'none';
    }
  });
  // Open this one
  el.classList.add('selected');
  const list = document.getElementById(saListId);
  if (list) list.style.display = '';
  selectRow(el, custKey);
}

// ── Tree expand/collapse ───────────────────────────────────────────────────
function toggleTree(key) {
  const children = document.getElementById('tree-' + key);
  if (!children) return;
  const btn = document.querySelector('[data-key="' + key + '"] .tree-expand-btn');
  const isOpen = !children.classList.contains('hidden');
  children.classList.toggle('hidden', isOpen);
  if (btn) btn.classList.toggle('collapsed', isOpen);
}

// ── Row selection → right panel ───────────────────────────────────────────
let selectedKey = null;
function selectRow(el, key) {
  // Deselect previous
  if (selectedKey) {
    const prev = document.querySelector('[data-key="' + selectedKey + '"]');
    if (prev) prev.classList.remove('selected');
  }
  el.classList.add('selected');
  selectedKey = key;
  // Also expand children
  const children = document.getElementById('tree-' + key);
  if (children && children.classList.contains('hidden')) toggleTree(key);
  // Update right panel
  updateCompanion(key);
}

function scrollToRow(key) {
  const el = document.querySelector('[data-key="' + key + '"]');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    selectRow(el, key);
  }
}

function updateCompanion(key) {
  // Look up companion data:
  // - exec-portfolio → stored as 'exec-portfolio'
  // - exec-c0, exec-c0-sa0 → stored as 'exec-c0', 'exec-c0-sa0'
  // - ea-c0, ea-c0-sa0-sub0-lpr0 → strip 'ea-' prefix → 'c0', 'c0-sa0-sub0-lpr0'
  let bareKey = key;
  if (key.startsWith('ea-')) bareKey = key.slice(3);
  const data = COMPANION[bareKey];
  const title = document.getElementById('companion-title');
  const subtitle = document.getElementById('companion-subtitle');
  const body = document.getElementById('companion-body');
  if (!data) { title.textContent = key; subtitle.textContent = ''; body.innerHTML = '<div class="companion-empty">No data for this selection.</div>'; return; }

  title.textContent = data.title;
  subtitle.textContent = data.subtitle || '';
  body.innerHTML = buildCompanionHtml(key, data);
}

function buildCompanionHtml(key, data) {
  let html = '';
  const isExec = key.startsWith('exec-');
  const bareKey = key.startsWith('ea-') ? key.slice(3) : key.replace(/^exec-/, '');
  const isLPR = bareKey.includes('-lpr');
  const isCustomer = /^c\d+$/.test(bareKey);
  const isExecPortfolio = key === 'exec-portfolio';
  const isExecCustomer = /^exec-c\d+$/.test(key);
  const isExecSA = /^exec-c\d+-sa\d+$/.test(key);

  // ── Executive portfolio ───────────────────────────────────────────────────
  if (isExecPortfolio) {
    // Risks and opportunities are shown inline in the banner — right panel shows cross-customer signals only
    if (data.signals?.length) {
      html += '<div class="companion-section"><div class="companion-section-label">Cross-Customer Architectural Signals</div>'
      data.signals.forEach(sig => {
        const color = SIG_COLORS[sig.type] || '#6c757d';
        html += '<div class="signal-block" style="border-left-color:' + color + '">'
        html += '<div class="signal-block-type" style="color:' + color + '">' + escH((sig.type||'').replace(/_/g,' ')) + '</div>'
        html += '<div class="signal-block-title">' + escH(sig.title) + '</div>'
        if (sig.products?.length) {
          html += '<div class="signal-block-prods">' + sig.products.map(p => '<span class="signal-prod-chip">' + escH(p) + '</span>').join('') + '</div>'
        }
        if (sig.pattern) html += '<div class="signal-block-text">' + escH(sig.pattern) + '</div>'
        if (sig.action && !isExec) html += '<div class="signal-block-action">EA: ' + escH(sig.action) + '</div>'
        html += '</div>'
      })
      html += '</div>'
    } else {
      html += '<div class="companion-empty">No cross-customer signals available. Run --analyze to generate insights.</div>'
    }
    return html
  }

  // ── Executive customer ────────────────────────────────────────────────────
  if (isExecCustomer && data.exec) {
    // Situation
    if (data.observation) {
      html += '<div class="companion-section"><div class="companion-section-label">Strategic Situation</div>'
      html += '<div class="companion-observation">' + escH(data.observation) + '</div></div>'
    }
    // Recommended ask
    if (data.exec.recommended_ask) {
      html += '<div class="companion-section">'
      html += '<div class="exec-ask" style="margin:0"><strong>Ask:</strong> ' + escH(data.exec.recommended_ask) + '</div>'
      html += '</div>'
    }
    // Solution area breakdown — color-coded, actuals + budget + attainment
    if (data.exec.sa_breakdown && data.exec.sa_breakdown.length) {
      html += '<div class="companion-section"><div class="companion-section-label">By Solution Area</div>'
      data.exec.sa_breakdown.forEach(sa => {
        const color = sa.att >= 90 ? '#16a34a' : sa.att >= 75 ? '#d97706' : '#dc2626'
        html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid #f1f3f5">'
        html += '<div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">'
        html += '<span style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0"></span>'
        html += '<span style="font-size:13px;font-weight:600;color:#343a40;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escH(sa.name) + '</span>'
        html += '</div>'
        html += '<div style="text-align:right;flex-shrink:0;margin-left:10px">'
        html += '<span style="font-size:14px;font-weight:800;color:' + color + '">' + fmtUSD(sa.actuals) + '</span>'
        html += '<span style="font-size:11px;color:#6c757d;margin-left:4px">/ ' + fmtUSD(sa.budget) + '</span>'
        html += '<div style="font-size:11px;font-weight:700;color:' + color + '">' + (sa.att != null ? sa.att.toFixed(0)+'%' : '—') + ' att</div>'
        html += '</div></div>'
      })
      html += '</div>'
    }
    // QBR preparation
    if (data.exec.qbr_opening || data.exec.qbr_key_points?.length) {
      html += '<div class="companion-section"><div class="companion-section-label">QBR Preparation</div>'
      if (data.exec.qbr_opening) html += '<div style="font-size:14px;color:#212529;font-weight:600;line-height:1.6;margin-bottom:10px">' + escH(data.exec.qbr_opening) + '</div>'
      if (data.exec.qbr_key_points?.length) {
        html += '<ul style="font-size:13px;color:#343a40;line-height:1.6;margin-bottom:10px;padding-left:1.2em">'
        data.exec.qbr_key_points.forEach(p => { html += '<li style="margin-bottom:4px">' + escH(p) + '</li>' })
        html += '</ul>'
      }
      if (data.exec.qbr_recommended_ask) html += '<div class="exec-ask" style="margin:0;margin-bottom:10px"><strong>Secure this:</strong> ' + escH(data.exec.qbr_recommended_ask) + '</div>'
      if (data.exec.qbr_questions?.length) {
        html += '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#adb5bd;margin-bottom:8px">Questions They Will Ask</div>'
        data.exec.qbr_questions.forEach(q => {
          html += '<div style="margin-bottom:10px;border-radius:6px;overflow:hidden">'
          html += '<div style="padding:7px 10px;font-size:13px;font-weight:600;background:#fff5f5;border-left:3px solid #dc3545">' + escH(q.question) + '</div>'
          html += '<div style="padding:7px 10px;font-size:13px;color:#1971c2;background:#e7f5ff;line-height:1.55">' + escH(q.suggested_answer) + '</div>'
          html += '</div>'
        })
      }
      html += '</div>'
    }
    return html || '<div class="companion-empty">No executive data for this customer.</div>'
  }

  // ── Executive SA ──────────────────────────────────────────────────────────
  if (isExecSA) {
    if (data.observation) {
      html += '<div class="companion-section"><div class="companion-section-label">Summary</div>'
      html += '<div class="companion-observation">' + escH(data.observation) + '</div></div>'
    }
    if (data.exec?.crit_products) {
      html += '<div style="font-size:13px;color:#dc3545;padding:8px 12px;background:#fff5f5;border-left:3px solid #dc3545;border-radius:0 6px 6px 0;margin-bottom:12px">'
      html += '<strong>Critical products:</strong> ' + escH(data.exec.crit_products) + '</div>'
    }
    if (data.exec?.product_summary) {
      html += '<div class="companion-section"><div class="companion-section-label">Products</div>'
      html += '<div style="font-size:13px;color:#495057;line-height:1.6">' + escH(data.exec.product_summary) + '</div></div>'
    }
    if (data.signals?.length) {
      html += '<div class="companion-section"><div class="companion-section-label">Signals</div>'
      data.signals.forEach(sig => {
        const color = SIG_COLORS[sig.type] || '#6c757d';
        html += '<div class="signal-block" style="border-left-color:' + color + '"><div class="signal-block-title">' + escH(sig.title) + '</div>'
        if (sig.pattern) html += '<div class="signal-block-text">' + escH(sig.pattern) + '</div>'
        html += '</div>'
      })
      html += '</div>'
    }
    return html || '<div class="companion-empty">No data for this solution area.</div>'
  }

  // ── EA / default path (observation=insight, recommendation, ea_action, LPR detail) ─────────

  // Insight (was observation; now comes from product.insight directly)
  if (isLPR) {
    // v3: show insight, recommendation, ea_action from product — gracefully handle nulls
    if (data.observation) {
      html += '<div class="companion-section"><div class="companion-section-label">Insight</div>'
      html += '<div class="companion-observation">' + escH(data.observation) + '</div></div>'
    }
    if (data.recommendation) {
      // Recommendation already shown inline under LPR name — skip in right panel
    }
    if (!data.observation && !data.recommendation) {
      html += '<div class="companion-section"><div class="companion-empty">Run --analyze to generate insights and recommendations for this product.</div></div>'
    }
  } else if (data.observation) {
    html += '<div class="companion-section"><div class="companion-section-label">Architectural Context</div>'
    html += '<div class="companion-observation">' + escH(data.observation) + '</div></div>'
  }

  // Consumption section removed — data is already shown inline in the LPR row (stacked bar + line chart + table)

  // Signals
  if (data.signals && data.signals.length) {
    html += '<div class="companion-section"><div class="companion-section-label">Architectural Signals</div>'
    data.signals.forEach(sig => {
      const color = SIG_COLORS[sig.type] || '#6c757d';
      html += '<div class="signal-block" style="border-left-color:' + color + '">'
      html += '<div class="signal-block-type" style="color:' + color + '">' + escH((sig.type||'').replace(/_/g,' ')) + '</div>'
      html += '<div class="signal-block-title">' + escH(sig.title) + '</div>'
      if (sig.products && sig.products.length) {
        html += '<div class="signal-block-prods">' + sig.products.map(p => '<span class="signal-prod-chip">' + escH(p) + '</span>').join('') + '</div>'
      }
      if (sig.pattern) html += '<div class="signal-block-text">' + escH(sig.pattern) + '</div>'
      if (sig.action && !isExec) html += '<div class="signal-block-action">EA: ' + escH(sig.action) + '</div>'
      html += '</div>'
    })
    html += '</div>'
  }

  // EA actions
  if (data.actions && data.actions.length) {
    html += '<div class="companion-section"><div class="companion-section-label">EA Priority Actions</div>'
    data.actions.forEach((a, i) => {
      html += '<div class="action-item-comp"><span class="action-num-comp">' + (i+1) + '</span><span class="action-text-comp">' + escH(a) + '</span></div>'
    })
    html += '</div>'
  }

  // Exec content (customer level)
  if (isCustomer && data.exec && (data.exec.headline || data.exec.top_risk || data.exec.recommended_ask)) {
    html += '<div class="companion-section"><div class="companion-section-label">Executive Brief</div>'
    if (data.exec.headline) html += '<div class="exec-block">' + escH(data.exec.headline) + '</div>'
    if (data.exec.top_risk) html += '<div class="exec-risk"><strong>Risk:</strong> ' + escH(data.exec.top_risk) + '</div>'
    if (data.exec.recommended_ask) html += '<div class="exec-ask"><strong>Ask:</strong> ' + escH(data.exec.recommended_ask) + '</div>'
    html += '</div>'
  }

  if (!html) html = '<div class="companion-empty">No AI analysis for this item. Run --analyze to generate insights.</div>'
  return html
}

// ── ACV waterfall in companion ────────────────────────────────────────────
function buildAcvWaterfallHtml(actuals, budget, acv) {
  if (!acv || acv <= 0 || !budget) return ''
  const cap = Math.max(acv, actuals || 0, budget)
  const budPct = Math.min(100, budget / cap * 100)
  const actPct = Math.min(100, (actuals || 0) / cap * 100)
  const attColor = rcJs(budget > 0 ? (actuals || 0) / budget * 100 : null)
  const budOfAcv = (budget / acv * 100).toFixed(0)
  const actOfAcv = acv > 0 ? ((actuals || 0) / acv * 100).toFixed(0) : 0

  const row = (label, val, pct, color, bold) =>
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">' +
    '<div style="width:80px;font-size:12px;color:#6c757d;flex-shrink:0;font-weight:' + (bold?'700':'400') + '">' + label + '</div>' +
    '<div style="flex:1;background:#f1f3f5;border-radius:4px;height:10px;position:relative;overflow:hidden">' +
    '<div style="position:absolute;left:0;top:0;height:100%;width:' + Math.min(100,pct).toFixed(1) + '%;background:' + color + ';border-radius:4px"></div>' +
    '</div>' +
    '<div style="width:64px;text-align:right;font-size:13px;font-weight:' + (bold?'800':'600') + ';color:' + color + ';flex-shrink:0">' + fmtUSD(val) + '</div>' +
    '</div>'

  let insight = actOfAcv < 10
    ? '<div style="font-size:13px;color:#dc3545;margin-top:10px;padding:8px;background:#fff5f5;border-radius:6px;border-left:3px solid #dc3545">Only ' + actOfAcv + '% of contracted ACV consumed — high renewal risk.</div>'
    : '<div style="font-size:13px;color:#495057;margin-top:10px;padding:8px;background:#f8f9fa;border-radius:6px">' + actOfAcv + '% of contract consumed. Budget is ' + budOfAcv + '% of ACV.</div>'

  return row('Contracted', acv, 100, '#dee2e6', false) + row('YTD Budget', budget, budPct, '#adb5bd', false) + row('YTD Actual', actuals || 0, actPct, attColor, true) + insight
}

// ── Signal popup from rail ────────────────────────────────────────────────
function showSignalPopup(idx) {
  const sigs = P.ai_insights?.architectural_signals || [];
  const sig = sigs[idx]; if (!sig) return;
  document.getElementById('popup-title').textContent = sig.title || 'Signal';
  const body = document.getElementById('popup-body');
  const color = SIG_COLORS[sig.signal_type] || '#6c757d';
  let html = '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:' + color + ';margin-bottom:10px">' + escH((sig.signal_type||'').replace(/_/g,' ')) + '</div>'
  if ((sig.customers_affected||[]).length) html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' + (sig.customers_affected||[]).map(c=>'<span style="font-size:12px;font-weight:600;background:#e9ecef;padding:2px 8px;border-radius:4px">'+escH(c)+'</span>').join('') + '</div>'
  if (sig.pattern) html += '<p style="font-size:14px;line-height:1.6;color:#343a40">' + escH(sig.pattern) + '</p>'
  if (sig.explanation) html += '<p style="font-size:14px;line-height:1.6;color:#495057;background:#f8f9fa;padding:10px;border-radius:6px">' + escH(sig.explanation) + '</p>'
  if (sig.action_for_ea && currentRole !== 'exec') html += '<div style="font-size:14px;color:#1971c2;background:#e7f5ff;padding:10px;border-radius:6px;border-left:3px solid #339af0;margin-top:10px">EA: ' + escH(sig.action_for_ea) + '</div>'
  body.innerHTML = html;
  document.getElementById('popup-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

// ── Popup helpers ─────────────────────────────────────────────────────────
function showPopupFromAttr(btn) {
  try { const d = JSON.parse(btn.dataset.popup); renderPopup(d); } catch(e){}
}
function renderPopup(data) {
  document.getElementById('popup-title').textContent = data.title || '';
  const body = document.getElementById('popup-body');
  body.innerHTML = '';
  (data.sections || []).forEach(sec => {
    const section = document.createElement('div'); section.className = 'popup-section';
    if (sec.label) { const lbl = document.createElement('div'); lbl.className = 'popup-section-label'; lbl.textContent = sec.label; section.appendChild(lbl); }
    if (sec.type === 'html') { const w = document.createElement('div'); w.innerHTML = sec.content||''; section.appendChild(w); }
    else if (sec.type === 'numbers') {
      const n = document.createElement('div'); n.className = 'popup-numbers';
      (sec.items||[]).forEach(item => { const d = document.createElement('div'); d.className='popup-num'; d.innerHTML='<div class="popup-num-val">'+item.val+'</div><div class="popup-num-lbl">'+item.lbl+'</div>'; n.appendChild(d); });
      section.appendChild(n);
    } else if (sec.type === 'note') { const n = document.createElement('div'); n.className='popup-note'; n.textContent=sec.content||''; section.appendChild(n); }
    else { const t = document.createElement('div'); t.className='popup-text'; t.textContent=sec.content||''; section.appendChild(t); }
    body.appendChild(section);
  });
  document.getElementById('popup-overlay').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closePopup(e) {
  if (e && e.target !== document.getElementById('popup-overlay')) return;
  document.getElementById('popup-overlay').classList.add('hidden');
  document.body.style.overflow = '';
}

// ── Exec donut ────────────────────────────────────────────────────────────
function initDonut() {
  if (typeof Chart === 'undefined') return;
  if (CR.donut) { try{CR.donut.destroy()}catch(e){} }
  const canvas = document.getElementById('exec-donut'); if (!canvas) return;
  let on=0, at=0;
  // v3: traverse nested hierarchy
  (P.customers||[]).forEach(c=>(c.solution_areas||[]).forEach(sa=>(sa.sub_solution_areas||[]).forEach(sub=>(sub.products||[]).forEach(p=>{
    if((p.ytd_attainment_pct??-1)>=90) on+=(p.ytd_actuals||0); else if(p.ytd_attainment_pct!=null) at+=(p.ytd_actuals||0);
  }))));
  try { CR.donut = new Chart(canvas,{type:'doughnut',data:{labels:['On Track','At Risk'],datasets:[{data:[on,at],backgroundColor:['#198754cc','#dc3545cc'],borderWidth:0}]},options:{responsive:false,plugins:{legend:{display:false}}}}); } catch(e){}
}

// ── Utility ───────────────────────────────────────────────────────────────
function escH(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmtUSD(n) { if(n==null||isNaN(n)) return '—'; const a=Math.abs(n); return a>=1e6?'$'+(n/1e6).toFixed(1)+'M':a>=1e3?'$'+(n/1e3).toFixed(0)+'K':'$'+Math.round(n).toLocaleString(); }
function pctJs(n) { return n==null||isNaN(n)?'—':Number(n).toFixed(1)+'%'; }
function rcJs(p) { if(p==null||isNaN(p)) return '#6c757d'; return p>=90?'#198754':p>=75?'#fd7e14':'#dc3545'; }

// ── Init ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Collapse all trees by default, expand first customer in EA view
  document.querySelectorAll('.tree-children').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.tree-expand-btn').forEach(btn => btn.classList.add('collapsed'));
  const firstKey = 'ea-c0';
  const firstRow = document.querySelector('[data-key="' + firstKey + '"]');
  if (firstRow) {
    selectRow(firstRow, firstKey);
    toggleTree(firstKey);
  }
  document.addEventListener('keydown', e => { if(e.key==='Escape') closePopup(); });
});
</script>
</body>
</html>`
}

// @entry run(args, options) | --dashboard <portfolio.json>
// @contract input: args[0] = portfolio JSON path → output: HTML written to disk | errors: UserError (exit 1), ProcessingError (exit 2)
export async function run(args, options) {
  const inputPath = args[0]
  if (!inputPath) throw new UserError('--dashboard requires a portfolio JSON file path argument')
  if (!existsSync(inputPath)) throw new UserError(`file not found: ${inputPath}`)

  let portfolio
  try {
    const raw = readFileSync(inputPath, 'utf8')
    portfolio = JSON.parse(raw)
  } catch (err) {
    if (err instanceof SyntaxError) throw new ProcessingError(`malformed JSON in ${inputPath}: ${err.message}`)
    throw new ProcessingError(`failed to read ${inputPath}: ${err.message}`)
  }

  // Output: same directory as input, named <source-basename>-dashboard.html
  const baseName = path.basename(inputPath, path.extname(inputPath))
  const outputPath = options.output ?? path.join(path.dirname(inputPath), `${baseName}-dashboard.html`)

  process.stderr.write(`warn: fetching CSS/JS assets from CDN…\n`)
  let chartjsScript = ''
  let bootstrapCss = ''
  let bootstrapIconsCss = ''

  async function fetchAsset(url, label) {
    try {
      const resp = await fetch(url)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const text = await resp.text()
      process.stderr.write(`warn: ${label} fetched (${Buffer.byteLength(text,'utf8')} bytes)\n`)
      return text
    } catch (err) {
      process.stderr.write(`warn: ${label} fetch failed (${err.message}) — unavailable\n`)
      return ''
    }
  }

  ;[chartjsScript, bootstrapCss, bootstrapIconsCss] = await Promise.all([
    fetchAsset(CHARTJS_URL,        'Chart.js'),
    fetchAsset(BOOTSTRAP_CSS_URL,  'Bootstrap CSS'),
    fetchAsset(BOOTSTRAP_ICONS_URL,'Bootstrap Icons CSS'),
  ])

  process.stderr.write(`warn: generating HTML dashboard (drill-down hierarchy)…\n`)
  const html = buildHtml(portfolio, chartjsScript, bootstrapCss, bootstrapIconsCss)

  try { writeFileSync(outputPath, html, 'utf8') }
  catch (err) { throw new ProcessingError(`failed to write ${outputPath}: ${err.message}`) }

  process.stdout.write(`${outputPath}\n`)
  process.stderr.write(`warn: dashboard written — ${Buffer.byteLength(html,'utf8')} bytes\n`)
}
