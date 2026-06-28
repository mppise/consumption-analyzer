// @story STORY-003 | analyze
// @intent runs the 5-step bottom-up AI pipeline on a portfolio.json: Step 1 (contract_insights per L3, sonnet), Step 2 (solution_architecture_insights per L2, sonnet), Step 3 (enterprise_architecture_insights per L1, sonnet), Step 4 (account_insights per customer, opus), Step 5 (industry_insights summary per industry, opus) — writes each step's output back to disk after completion

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AIClient } from '../lib/aiClient.js'
import { config } from '../config/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// @entry run(args, options) | contract:tool-module — called by cli.js for --analyze <file>
// @contract input: args[0] = portfolio.json path → output: portfolio.json enriched in-place with all 5 AI fields | errors: throws UserError (exit 1), ProcessingError (exit 2)

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

// ─── Prompt loading ───────────────────────────────────────────────────────────

/**
 * Load a prompt template from /src/ai/ and substitute all {{placeholder}} occurrences.
 * @param {string} filename — basename only (e.g. 'step1-contract.md')
 * @param {object} vars — map of placeholder name → value
 * @returns {string} — rendered prompt
 */
function renderPrompt(filename, vars) {
  const templatePath = path.join(__dirname, '..', 'ai', filename)
  const template = fs.readFileSync(templatePath, 'utf8')
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = vars[key]
    return val !== undefined && val !== null ? String(val) : `{{${key}}}`
  })
}

// ─── Product catalog ──────────────────────────────────────────────────────────

/**
 * Load and parse the sap-product-catalog.json.
 * Returns empty object on missing/unreadable file.
 */
function loadCatalog() {
  const catalogPath = path.join(__dirname, '..', 'ai', 'sap-product-catalog.json')
  if (!fs.existsSync(catalogPath)) {
    process.stderr.write('warn: sap-product-catalog.json not found — product context disabled\n')
    return {}
  }
  try {
    return JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch {
    process.stderr.write('warn: sap-product-catalog.json could not be parsed — product context disabled\n')
    return {}
  }
}

/**
 * Score how well a catalog entry name matches an LPR product name.
 * Returns 0–100; higher = better match.
 */
function scoreCatalogMatch(lprName, catalogName) {
  const lpr = lprName.toLowerCase().replace(/^(sap |concur - |ariba )/i, '').trim()
  const cat = catalogName.toLowerCase().replace(/^(sap |concur - |ariba |the )/i, '').trim()
  if (lpr === cat) return 100
  if (cat.includes(lpr) || lpr.includes(cat)) return 90
  const lprWords = new Set(lpr.split(/\W+/).filter(w => w.length > 3))
  const catWords = new Set(cat.split(/\W+/).filter(w => w.length > 3))
  const shared = [...lprWords].filter(w => catWords.has(w)).length
  const total = Math.max(lprWords.size, catWords.size)
  return total > 0 ? Math.round((shared / total) * 80) : 0
}

// Alias dictionary: lpr_name → catalog entry name (null = no catalog entry)
const LPR_CATALOG_ALIASES = {
  'Ariba Buying and Invoicing':              'SAP Ariba Invoice Management',
  'Ariba Contracts':                         'Contract management software',
  'Ariba Buying':                            'SAP Ariba Central Procurement',
  'Cloud for Customer':                      'SAP Intelligent Sales and Service',
  'SAP BTP Enterprise Agreement':            'SAP Business Technology Platform',
  'SAP Analytics Cloud Planning':            'SAP Analytics Cloud in Business Data Cloud',
  'SAP Analytics Cloud BI':                  'SAP Analytics Cloud in Business Data Cloud',
  'SAP HANA Cloud':                          'SAP Business Data Cloud',
  'SAP Digital Payments':                    'SAP S/4HANA Cloud for advanced payment management',
  'Watchlist Screening':                     'SAP Watch List Screening',
  'SAP Traceability Hub':                    'SAP Business Network Material Traceability',
  'Batch Release Hub':                       'SAP Batch Release Hub for Life Sciences',
  'Preferred Success Ariba':                 null,
  'Preferred Success Concur':                null,
  'Preferred Success Commerce':              null,
  'Concur - Company Bill Statement':         null,
  'Concur - Expense Pay':                    null,
  'Concur - ExpenseIt':                      null,
  'Concur - Intelligent Audit':              null,
  'Concur - Reporting Services':             null,
  'Concur - Triplink':                       null,
  'Concur - Drive':                          null,
  'Concur - User Support Desk':              null,
  'Concur - Conn, Stat, Web, & Extract Svcs': null,
  'Concur - Direct Travel':                  'SAP Concur Trip',
  'Concur - Analytics':                      'Spend analytics software',
  'Concur - Expense':                        'Automate digital compliance with Concur Invoice and Concur Expense globally',
  'Data Intelligence Cloud':                 'SAP Data Intelligence Cloud',
  'Integrated Business Planning (IBP)':      'SAP Integrated Business Planning',
  'SAP Integration Suite':                   'SAP Integration Suite | Integration Platform as a Service',
  'SAP Build':                               'Build apps quickly with low-code',
  'SAP Commerce Cloud':                      'SAP Commerce Cloud',
  'SAP Incentive Management':                'SAP Incentive Management',
  'WalkMe Premium for Concur':               'WalkMe Premium for SAP CX solutions',
}

/**
 * Build catalog context text for an array of lpr_name strings.
 * Returns a markdown block suitable for prompt injection.
 */
function buildCatalogContext(lprNames, catalog) {
  if (!lprNames.length || !Object.keys(catalog).length) return '(No catalog context available for these products)'

  const lines = []
  for (const lprName of lprNames) {
    let catalogEntry = null
    const aliasKey = LPR_CATALOG_ALIASES[lprName]
    if (aliasKey !== undefined) {
      if (aliasKey !== null) catalogEntry = catalog[aliasKey]
    } else {
      let bestScore = 0
      for (const [catName, catData] of Object.entries(catalog)) {
        const score = scoreCatalogMatch(lprName, catName)
        if (score > bestScore && score >= 40) {
          bestScore = score
          catalogEntry = catData
        }
      }
    }

    let caps = ''
    let desc = ''
    if (catalogEntry) {
      const filteredCaps = (catalogEntry.capabilities ?? []).filter(c =>
        c.length > 8 && c.length < 90 &&
        !/add-on|all plans|what is|early-bird|available for|get started|details/i.test(c)
      ).slice(0, 4)
      if (filteredCaps.length) caps = `  Capabilities: ${filteredCaps.join(' | ')}`
      const tagline = catalogEntry.tagline
      if (tagline && !/early-bird|available for some|get started/i.test(tagline) && tagline.length > 20) {
        desc = tagline.slice(0, 180)
      }
    }

    lines.push([`### ${lprName}`, desc ? `Description: ${desc}` : null, caps || null].filter(Boolean).join('\n'))
  }

  return lines.join('\n\n')
}

// ─── AI call ──────────────────────────────────────────────────────────────────

/**
 * Build an async chat function for a given model using AIClient (always streams).
 */
function buildChatFn(model, maxTokens, apiKey, baseUrl) {
  const ai = new AIClient({ apiKey, baseURL: baseUrl, defaultModel: model, defaultMaxTokens: maxTokens })
  return (prompt) => ai.chat(prompt)
}

// ─── Response parsing ─────────────────────────────────────────────────────────

/**
 * Strip markdown code fences from AI response text.
 * Handles ```json ... ``` and ``` ... ``` wrappers, and preamble text before fences.
 */
function stripCodeFences(text) {
  if (!text) return text
  const trimmed = text.trim()
  const exactMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i)
  if (exactMatch) return exactMatch[1].trim()
  const anyFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i)
  if (anyFence) return anyFence[1].trim()
  return trimmed
}

/**
 * Parse an AI response expected to be a JSON string[].
 * Returns the array on success, or a fallback array with the raw text on failure.
 */
function parseStringArray(rawText, context) {
  try {
    const cleaned = stripCodeFences(rawText)
    const parsed = JSON.parse(cleaned)
    if (Array.isArray(parsed) && parsed.every(item => typeof item === 'string')) {
      return parsed
    }
    process.stderr.write(`warn: ${context} — response was not a string[] — wrapping as single element\n`)
    return [typeof parsed === 'string' ? parsed : JSON.stringify(parsed)]
  } catch (err) {
    process.stderr.write(`warn: ${context} — JSON parse failed (${err.message}) — storing raw text\n`)
    return [rawText]
  }
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Format a YYYYMM string as human-readable "Month YYYY".
 */
function formatReportingMonth(yyyymm) {
  if (!yyyymm) return '—'
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']
  const s = String(yyyymm).replace('-', '')
  const m = parseInt(s.slice(4, 6), 10)
  return `${months[m - 1] ?? s.slice(4)} ${s.slice(0, 4)}`
}

/**
 * Compute months remaining in the fiscal year from reporting_month.
 */
function monthsRemaining(yyyymm) {
  if (!yyyymm) return 0
  const s = String(yyyymm).replace('-', '')
  const m = parseInt(s.slice(4, 6), 10)
  return Math.max(0, 12 - m)
}

// ─── Portfolio write helper ───────────────────────────────────────────────────

/**
 * Persist the portfolio object to disk. Called after each step completes.
 * @contract input: portfolio object + resolved file path → output: file written to disk | errors: writes warn to stderr on failure
 */
function savePortfolio(portfolio, resolvedPath) {
  try {
    fs.writeFileSync(resolvedPath, JSON.stringify(portfolio, null, 2), 'utf8')
    const bytes = fs.statSync(resolvedPath).size
    process.stderr.write(`info: portfolio saved — ${resolvedPath} (${(bytes / 1024).toFixed(0)} KB)\n`)
  } catch (err) {
    process.stderr.write(`warn: could not save portfolio: ${err.message}\n`)
  }
}

// ─── Contract data formatting ────────────────────────────────────────────────

/**
 * Format the contract data block (year-keyed monthly arrays) into human-readable text
 * suitable for injection into the Step 1 prompt.
 * @param {object} contractBlock — entity:contract object (contract_insights + year-keyed arrays)
 * @returns {string}
 */
function formatContractData(contractBlock) {
  const years = Object.keys(contractBlock).filter(k => k !== 'contract_insights')
  if (!years.length) return '(No contract data available)'

  const lines = []
  for (const year of years.sort()) {
    const months = contractBlock[year]
    if (!Array.isArray(months) || !months.length) continue
    lines.push(`### FY${year}`)
    for (const m of months) {
      const acv = typeof m.annual_contract_value === 'number' ? m.annual_contract_value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'N/A'
      const budget = typeof m.budget_contract_value === 'number' ? m.budget_contract_value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'N/A'
      const consumed = typeof m.consumed_contract_value === 'number' ? m.consumed_contract_value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'N/A'
      const attainment = m.variances?.budget_attainment != null ? `${m.variances.budget_attainment.toFixed(1)}%` : 'N/A'
      const acvGap = m.variances?.acv_gap != null ? m.variances.acv_gap.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'N/A'
      const budgetGap = m.variances?.budget_gap != null ? m.variances.budget_gap.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) : 'N/A'
      lines.push(`- **${m.month}**: ACV=${acv} | Budget=${budget} | Consumed=${consumed} | Attainment=${attainment} | ACV Gap=${acvGap} | Budget Gap=${budgetGap}`)
    }
  }
  return lines.join('\n')
}

// ─── Financial roll-up helpers ────────────────────────────────────────────────

/**
 * Sum all contract values across a customer's full hierarchy.
 * Returns { annual_contract_value, budget_contract_value, consumed_contract_value }.
 */
function sumCustomerContractValues(customer) {
  let acv = 0, budget = 0, consumed = 0
  for (const l1 of customer.solutions_l1 ?? []) {
    for (const l2 of l1.solutions_l2 ?? []) {
      for (const l3 of l2.solutions_l3 ?? []) {
        const contract = l3.contract ?? {}
        for (const key of Object.keys(contract)) {
          if (key === 'contract_insights') continue
          const months = contract[key]
          if (!Array.isArray(months)) continue
          for (const m of months) {
            acv     += m.annual_contract_value     ?? 0
            budget  += m.budget_contract_value     ?? 0
            consumed+= m.consumed_contract_value   ?? 0
          }
        }
      }
    }
  }
  return { annual_contract_value: acv, budget_contract_value: budget, consumed_contract_value: consumed }
}

/**
 * Format a currency number as "$X,XXX" for prompt injection.
 */
function fmt(n) {
  if (typeof n !== 'number') return 'N/A'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

// ─── Step implementations ─────────────────────────────────────────────────────

// @entry runStep1 | Step 1 — contract_insights per L3 product (sonnet)
// @contract input: portfolio with new schema → output: every contract.contract_insights[] populated | errors: warn on individual API failure, continue
async function runStep1(portfolio, chatSonnet, catalog, promptVars) {
  process.stderr.write('info: Step 1 — contract_insights per L3 product (sonnet)\n')
  let taskCount = 0
  let doneCount = 0

  // Collect all L3 tasks
  const tasks = []
  for (const customer of portfolio.customers ?? []) {
    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        for (const l3 of l2.solutions_l3 ?? []) {
          tasks.push({ customer, l1, l2, l3 })
          taskCount++
        }
      }
    }
  }
  process.stderr.write(`info: Step 1 — ${taskCount} L3 product(s) across ${portfolio.customers?.length ?? 0} customer(s)\n`)

  // Run all tasks in parallel
  const results = await Promise.allSettled(tasks.map(async ({ customer, l3 }) => {
    const contractBlock = l3.contract ?? {}
    const contractDataText = formatContractData(contractBlock)
    const catalogContext = buildCatalogContext([l3.lpr_name].filter(Boolean), catalog)

    const prompt = renderPrompt('step1-contract.md', {
      lpr_name:          l3.lpr_name ?? '(unknown)',
      lpr_id:            l3.lpr_id ?? '',
      customer_name:     customer.customer ?? customer.customer_id ?? 'Unknown',
      current_date:      promptVars.current_date,
      fiscal_year:       promptVars.fiscal_year,
      reporting_month:   promptVars.reporting_month,
      months_remaining:  String(promptVars.months_remaining),
      contract_data:     contractDataText,
    })

    let rawText
    try {
      rawText = await chatSonnet(prompt)
    } catch (err) {
      throw new Error(`AI API error: ${err.message ?? String(err)}`)
    }

    const parsed = parseStringArray(rawText, `Step 1 / ${customer.customer ?? customer.customer_id} / ${l3.lpr_name}`)
    l3.contract = l3.contract ?? {}
    l3.contract.contract_insights = parsed
    doneCount++
    process.stderr.write(`info:   Step 1 done — ${customer.customer ?? customer.customer_id} / ${l3.lpr_name} (${parsed.length} insight(s))\n`)
  }))

  let failCount = 0
  for (const r of results) {
    if (r.status === 'rejected') {
      failCount++
      process.stderr.write(`warn: Step 1 task failed: ${r.reason}\n`)
    }
  }
  process.stderr.write(`info: Step 1 complete — ${doneCount} succeeded${failCount ? `, ${failCount} failed` : ''}\n`)
}

// @entry runStep2 | Step 2 — solution_architecture_insights per L2 grouping (sonnet)
// @contract input: portfolio with Step 1 complete → output: every solutions_l3[].solution_architecture_insights[] populated | errors: warn on individual API failure
async function runStep2(portfolio, chatSonnet, catalog, promptVars) {
  process.stderr.write('info: Step 2 — solution_architecture_insights per L2 grouping (sonnet)\n')

  const tasks = []
  for (const customer of portfolio.customers ?? []) {
    for (const l1 of customer.solutions_l1 ?? []) {
      for (const l2 of l1.solutions_l2 ?? []) {
        tasks.push({ customer, l1, l2 })
      }
    }
  }
  process.stderr.write(`info: Step 2 — ${tasks.length} L2 grouping(s)\n`)

  const results = await Promise.allSettled(tasks.map(async ({ customer, l2 }) => {
    const l3List = l2.solutions_l3 ?? []
    if (!l3List.length) return

    // Build l3_contract_insights from Step 1 output
    const l3InsightsText = l3List.map(l3 => {
      const insights = (l3.contract?.contract_insights ?? []).join(' ')
      return `**${l3.lpr_name}** (${l3.lpr_id}): ${insights || '(no contract insights available)'}`
    }).join('\n\n')

    // Catalog context for all L3 products in this L2
    const lprNames = l3List.map(l3 => l3.lpr_name).filter(Boolean)
    const catalogContext = buildCatalogContext(lprNames, catalog)

    const prompt = renderPrompt('step2-solution-arch.md', {
      l2_name:                l2.name ?? '(unknown L2)',
      customer_name:          customer.customer ?? customer.customer_id ?? 'Unknown',
      current_date:           promptVars.current_date,
      fiscal_year:            promptVars.fiscal_year,
      reporting_month:        promptVars.reporting_month,
      months_remaining:       String(promptVars.months_remaining),
      l3_contract_insights:   l3InsightsText,
      product_catalog_context: catalogContext,
    })

    let rawText
    try {
      rawText = await chatSonnet(prompt)
    } catch (err) {
      throw new Error(`AI API error: ${err.message ?? String(err)}`)
    }

    const parsed = parseStringArray(rawText, `Step 2 / ${customer.customer ?? customer.customer_id} / ${l2.name}`)

    // Write to ALL L3 products under this L2 (per spec: solutions_l3[].solution_architecture_insights[])
    for (const l3 of l3List) {
      l3.solution_architecture_insights = parsed
    }
    process.stderr.write(`info:   Step 2 done — ${customer.customer ?? customer.customer_id} / ${l2.name} (${parsed.length} insight(s))\n`)
  }))

  let failCount = 0
  for (const r of results) {
    if (r.status === 'rejected') {
      failCount++
      process.stderr.write(`warn: Step 2 task failed: ${r.reason}\n`)
    }
  }
  process.stderr.write(`info: Step 2 complete — ${tasks.length - failCount} succeeded${failCount ? `, ${failCount} failed` : ''}\n`)
}

// @entry runStep3 | Step 3 — enterprise_architecture_insights per L1 solution area (sonnet)
// @contract input: portfolio with Steps 1+2 complete → output: every solutions_l1[].enterprise_architecture_insights[] populated
async function runStep3(portfolio, chatSonnet, catalog, promptVars) {
  process.stderr.write('info: Step 3 — enterprise_architecture_insights per L1 solution area (sonnet)\n')

  const tasks = []
  for (const customer of portfolio.customers ?? []) {
    for (const l1 of customer.solutions_l1 ?? []) {
      tasks.push({ customer, l1 })
    }
  }
  process.stderr.write(`info: Step 3 — ${tasks.length} L1 solution area(s)\n`)

  const results = await Promise.allSettled(tasks.map(async ({ customer, l1 }) => {
    const l2List = l1.solutions_l2 ?? []
    if (!l2List.length) return

    // Build l2_solution_arch_insights from Step 2 output
    const l2InsightsText = l2List.map(l2 => {
      // Collect unique solution_architecture_insights from L3 products (all L3 under this L2 share the same insights)
      const firstL3 = (l2.solutions_l3 ?? [])[0]
      const insights = (firstL3?.solution_architecture_insights ?? []).join(' ')
      return `**${l2.name}**: ${insights || '(no solution-architecture insights available)'}`
    }).join('\n\n')

    // Catalog context for ALL L3 products in this L1
    const lprNames = l2List.flatMap(l2 => (l2.solutions_l3 ?? []).map(l3 => l3.lpr_name)).filter(Boolean)
    const uniqueNames = [...new Set(lprNames)]
    const catalogContext = buildCatalogContext(uniqueNames, catalog)

    const prompt = renderPrompt('step3-enterprise-arch.md', {
      l1_name:                  l1.name ?? '(unknown L1)',
      customer_name:            customer.customer ?? customer.customer_id ?? 'Unknown',
      current_date:             promptVars.current_date,
      fiscal_year:              promptVars.fiscal_year,
      reporting_month:          promptVars.reporting_month,
      months_remaining:         String(promptVars.months_remaining),
      l2_solution_arch_insights: l2InsightsText,
      product_catalog_context:  catalogContext,
    })

    let rawText
    try {
      rawText = await chatSonnet(prompt)
    } catch (err) {
      throw new Error(`AI API error: ${err.message ?? String(err)}`)
    }

    const parsed = parseStringArray(rawText, `Step 3 / ${customer.customer ?? customer.customer_id} / ${l1.name}`)
    l1.enterprise_architecture_insights = parsed
    process.stderr.write(`info:   Step 3 done — ${customer.customer ?? customer.customer_id} / ${l1.name} (${parsed.length} insight(s))\n`)
  }))

  let failCount = 0
  for (const r of results) {
    if (r.status === 'rejected') {
      failCount++
      process.stderr.write(`warn: Step 3 task failed: ${r.reason}\n`)
    }
  }
  process.stderr.write(`info: Step 3 complete — ${tasks.length - failCount} succeeded${failCount ? `, ${failCount} failed` : ''}\n`)
}

// @entry runStep4 | Step 4 — account_insights per customer (opus)
// @contract input: portfolio with Steps 1+2+3 complete → output: every customer.account_insights[] populated
async function runStep4(portfolio, chatOpus, promptVars) {
  process.stderr.write('info: Step 4 — account_insights per customer (opus)\n')
  process.stderr.write(`info: Step 4 — ${portfolio.customers?.length ?? 0} customer(s)\n`)

  // Run customers sequentially (opus model — rate limit caution, and these are large contexts)
  for (const customer of portfolio.customers ?? []) {
    const { annual_contract_value, budget_contract_value, consumed_contract_value } = sumCustomerContractValues(customer)

    // Build l1_ea_insights from Step 3 output
    const l1InsightsText = (customer.solutions_l1 ?? []).map(l1 => {
      const insights = (l1.enterprise_architecture_insights ?? []).join(' ')
      return `**${l1.name}**: ${insights || '(no EA insights available)'}`
    }).join('\n\n')

    const prompt = renderPrompt('step4-account.md', {
      customer_name:    customer.customer ?? customer.customer_id ?? 'Unknown',
      industry:         customer.industry ?? 'Unknown',
      current_date:     promptVars.current_date,
      fiscal_year:      promptVars.fiscal_year,
      reporting_month:  promptVars.reporting_month,
      months_remaining: String(promptVars.months_remaining),
      total_acv:        fmt(annual_contract_value),
      total_budget:     fmt(budget_contract_value),
      total_consumed:   fmt(consumed_contract_value),
      l1_ea_insights:   l1InsightsText,
    })

    let rawText
    try {
      rawText = await chatOpus(prompt)
    } catch (err) {
      throw new ProcessingError(`AI API error: ${err.message ?? String(err)}`)
    }

    const parsed = parseStringArray(rawText, `Step 4 / ${customer.customer ?? customer.customer_id}`)
    customer.account_insights = parsed
    process.stderr.write(`info:   Step 4 done — ${customer.customer ?? customer.customer_id} (${parsed.length} insight(s))\n`)
  }

  process.stderr.write('info: Step 4 complete\n')
}

// @entry runStep5 | Step 5 — industry_insights summary per industry (opus)
// @contract input: portfolio with Steps 1+2+3+4 complete + industry_insights[] stubs → output: every industry_insights[].summary[] populated
async function runStep5(portfolio, chatOpus, promptVars) {
  process.stderr.write('info: Step 5 — industry_insights summary per industry (opus)\n')

  const industryInsights = portfolio.industry_insights ?? []
  if (!industryInsights.length) {
    process.stderr.write('warn: Step 5 — no industry_insights[] found in portfolio; skipping\n')
    return
  }

  process.stderr.write(`info: Step 5 — ${industryInsights.length} industry group(s)\n`)

  // Build a map from industry name → customers
  const industryCustomerMap = new Map()
  for (const customer of portfolio.customers ?? []) {
    const ind = customer.industry ?? 'Unknown'
    if (!industryCustomerMap.has(ind)) industryCustomerMap.set(ind, [])
    industryCustomerMap.get(ind).push(customer)
  }

  for (const industryBlock of industryInsights) {
    const industryName = industryBlock.industry ?? 'Unknown'
    const customers = industryCustomerMap.get(industryName) ?? []

    // Build customer_account_insights from Step 4 output
    const customerInsightsText = customers.map(c => {
      const insights = (c.account_insights ?? []).join(' ')
      return `**${c.customer ?? c.customer_id ?? 'Unknown'}**: ${insights || '(no account insights available)'}`
    }).join('\n\n')

    const customerList = customers.map(c => c.customer ?? c.customer_id ?? 'Unknown').join(', ')
    const agg = industryBlock.aggregated_contracts ?? { annual_contract_value: 0, budget_contract_value: 0, consumed_contract_value: 0 }

    const prompt = renderPrompt('step5-industry.md', {
      industry:                industryName,
      customer_list:           customerList || '(no customers)',
      current_date:            promptVars.current_date,
      fiscal_year:             promptVars.fiscal_year,
      reporting_month:         promptVars.reporting_month,
      total_acv:               fmt(agg.annual_contract_value),
      total_budget:            fmt(agg.budget_contract_value),
      total_consumed:          fmt(agg.consumed_contract_value),
      customer_account_insights: customerInsightsText,
    })

    let rawText
    try {
      rawText = await chatOpus(prompt)
    } catch (err) {
      throw new ProcessingError(`AI API error: ${err.message ?? String(err)}`)
    }

    const parsed = parseStringArray(rawText, `Step 5 / ${industryName}`)
    industryBlock.summary = parsed
    process.stderr.write(`info:   Step 5 done — ${industryName} (${parsed.length} insight(s))\n`)
  }

  process.stderr.write('info: Step 5 complete\n')
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// @entry run(args, options) | dispatched from cli.js for --analyze flag
export async function run(args, _options) {
  // ── Guard: filename argument ──────────────────────────────────────────────
  const fileArg = args[0]
  if (!fileArg || fileArg.trim() === '') {
    throw new UserError('--analyze requires a filename argument')
  }

  const resolvedPath = path.isAbsolute(fileArg)
    ? fileArg
    : path.resolve(process.cwd(), fileArg)

  if (!fs.existsSync(resolvedPath)) {
    throw new UserError(`file not found: ${fileArg}`)
  }

  // ── Guard: API key ────────────────────────────────────────────────────────
  if (!config.aiApiKey) {
    throw new UserError('AI_API_KEY is not set')
  }

  if (!config.aiModel) {
    throw new UserError('AI_MODEL is not set')
  }

  if (!config.aiModelSenior) {
    throw new UserError('AI_MODEL_SENIOR is not set')
  }

  // ── Read and parse portfolio.json ─────────────────────────────────────────
  let rawContent
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf8')
  } catch (err) {
    throw new ProcessingError(`cannot read file: ${err.message}`)
  }

  let portfolio
  try {
    portfolio = JSON.parse(rawContent)
  } catch (err) {
    throw new ProcessingError(`cannot parse JSON: ${err.message}`)
  }

  // ── Validate portfolio schema (new format: customers[].solutions_l1) ──────
  if (!Array.isArray(portfolio.customers)) {
    throw new ProcessingError('invalid portfolio.json — expected customers[] array (new schema from --transform)')
  }

  const filename = path.basename(resolvedPath)
  process.stderr.write(`info: loaded ${filename} — ${portfolio.fiscal_year ?? 'unknown FY'}, reporting month ${formatReportingMonth(portfolio.reporting_month)}, ${portfolio.customer_count ?? portfolio.customers.length} customer(s)\n`)

  // ── Common prompt vars ────────────────────────────────────────────────────
  const currentDate = todayISO()
  const fiscalYear  = portfolio.fiscal_year ?? `FY${currentDate.slice(0, 4)}`
  const promptVars = {
    current_date:     currentDate,
    fiscal_year:      fiscalYear,
    reporting_month:  formatReportingMonth(portfolio.reporting_month),
    months_remaining: monthsRemaining(portfolio.reporting_month),
  }

  // ── Load product catalog ──────────────────────────────────────────────────
  const catalog = loadCatalog()

  // ── Build AI chat functions ───────────────────────────────────────────────
  const chatSonnet = buildChatFn(config.aiModel,       config.aiMaxTokens, config.aiApiKey, config.aiBaseUrl)
  const chatOpus   = buildChatFn(config.aiModelSenior, config.aiMaxTokens, config.aiApiKey, config.aiBaseUrl)

  process.stderr.write(`info: models — sonnet (Steps 1–3): ${config.aiModel} | opus (Steps 4–5): ${config.aiModelSenior}\n`)

  // ── Step 1: contract_insights per L3 ──────────────────────────────────
  await runStep1(portfolio, chatSonnet, catalog, promptVars)
  savePortfolio(portfolio, resolvedPath)

  // ── Step 2: solution_architecture_insights per L2 ────────────────────────
  await runStep2(portfolio, chatSonnet, catalog, promptVars)
  savePortfolio(portfolio, resolvedPath)

  // ── Step 3: enterprise_architecture_insights per L1 ──────────────────────
  await runStep3(portfolio, chatSonnet, catalog, promptVars)
  savePortfolio(portfolio, resolvedPath)

  // ── Step 4: account_insights per customer ────────────────────────────────
  await runStep4(portfolio, chatOpus, promptVars)
  savePortfolio(portfolio, resolvedPath)

  // ── Step 5: industry_insights summary per industry ────────────────────────
  await runStep5(portfolio, chatOpus, promptVars)
  savePortfolio(portfolio, resolvedPath)

  process.stderr.write(`info: --analyze complete — all 5 steps done — ${resolvedPath}\n`)
}
