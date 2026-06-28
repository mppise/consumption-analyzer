// @story STORY-003 | analyze
// @intent reads portfolio.json, runs a 3-level AI pipeline (L1: haiku per sub-SA, L2: product field writes from L1, L3: opus portfolio narrative), and writes ai_insights + product AI fields back into portfolio.json

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { AIClient, MODELS } from '../lib/aiClient.js'
import { config } from '../config/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// @entry run(args, options) | contract:tool-module — called by cli.js for --analyze <file>
// @contract input: args[0] = portfolio.json path, options.output = optional output path → output: ai_insights + product AI fields written into portfolio.json, pulse_narrative on stdout | errors: throws UserError (exit 1), ProcessingError (exit 2)

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

// ─── Architectural role definitions ──────────────────────────────────────────
// These are curated EA-perspective descriptions of what each product *does* in
// the SAP architecture — NOT marketing copy. They explain:
//   (a) where the product sits in the SAP landscape
//   (b) what it enables downstream
//   (c) what low/zero consumption architecturally implies
// These supplement or override the scraped catalog tagline when available.
const LPR_ARCH_ROLES = {
  // BTP Platform
  'SAP BTP Enterprise Agreement': 'Foundation contract for the SAP Business Technology Platform. Covers all BTP consumption units — Integration Suite, Build, HANA Cloud, Joule, and extensibility runtimes. Low consumption means the extensibility and integration backbone is purchased but unactivated; downstream SAP Build, Joule, and Integration Suite value cannot be realized. This is the single most architecturally important product to activate early in any SAP cloud journey.',
  'SAP Integration Suite': 'Integration Platform-as-a-Service. Connects SAP cloud applications to each other, to on-premise ERP, and to third-party systems via API management, event mesh, and pre-built integration flows. Low consumption = integration gaps, manual workarounds, and siloed data flows that block end-to-end process automation.',
  'SAP Build': 'Low-code/no-code application and process extension platform. Enables business users and developers to build custom workflows, apps, and UI extensions on BTP without touching SAP core. Zero consumption means the citizen-developer layer is inactive — extensibility depends on ABAP developers or custom code, increasing clean-core risk.',
  'Joule Studio': 'AI agent and copilot development platform on BTP. Enables embedding AI assistants and agents into SAP business processes. Active consumption indicates the customer is building AI-augmented workflows. Zero on an active BTP deployment means the AI layer is purchased but unactivated — a specific architectural gap if BTP usage is otherwise healthy.',
  'SAP HANA Cloud': 'Cloud-native in-memory database and data platform. Serves as the data tier for SAP Analytics Cloud and custom BTP applications. Healthy consumption indicates analytics and data workloads are on the cloud platform. Low consumption with active SAC may indicate local or legacy data sources are still driving analytics.',
  'Data Intelligence Cloud': 'Data integration, orchestration, and ML pipeline platform. Enables data engineers to build ETL/ELT pipelines and ML workflows on BTP. Low consumption may indicate data engineering workloads are still on-premise or using legacy tools.',

  // Analytics & Planning
  'SAP Analytics Cloud BI': 'Cloud BI platform for dashboards, reporting, and predictive analytics. At 100% consumption, business intelligence is cloud-native. Below 60% suggests reporting is still running in SAP BusinessObjects, BW, or spreadsheets — a signal that the analytics migration is stalled and business users are not adopted.',
  'SAP Analytics Cloud Planning': 'Integrated FP&A and operational planning on top of SAC. Replaces BPC and spreadsheet-based planning cycles. Below 70% means finance teams are still planning outside the system — a direct risk to the business case for replacing legacy planning tools.',

  // Procurement (Ariba)
  'Ariba Buying and Invoicing': 'Core P2P procurement orchestration — purchase requisition to invoice. The operational backbone of SAP Ariba. Below 80% means maverick spend, non-PO invoices, and manual approval chains are still active. Every Ariba adoption gap here increases compliance and audit risk.',
  'Ariba Buying': 'Guided buying front-end and catalog procurement layer for Ariba. Provides self-service purchasing with policy enforcement at the point of request. Low consumption means employees are bypassing procurement channels — a direct maverick spend and compliance risk.',
  'Ariba Sourcing': 'Strategic sourcing — RFP, RFQ, auction, and supplier selection. Low or declining consumption means strategic procurement events are running offline or in email/spreadsheets, not generating competitive outcomes or audit trail.',
  'Ariba Contracts': 'Contract Lifecycle Management. Stores, routes, and manages supplier contracts. Zero utilization means contracts are managed outside the system — creating compliance gaps, no single source of truth, and audit risk. This is the legal and financial governance layer of Ariba.',
  'Ariba Supplier Lifecycle & Perform. Mgmt': 'Supplier onboarding, qualification, and performance tracking. Manages supplier master data, certifications, and scorecards. Sporadic consumption indicates the supplier base is not fully onboarded — contracts and invoices may reference unqualified suppliers.',
  'Ariba Supplier Risk': 'Automated supplier risk monitoring — financial, compliance, ESG, and geopolitical. Low or zero consumption means third-party risk is unmonitored within the procurement system. For regulated industries this is an audit and compliance gap.',
  'Preferred Success Ariba': 'SAP premium success support entitlement for Ariba products. Provides dedicated support resources, proactive health checks, and adoption guidance. Low utilization means the customer is not leveraging paid support, leaving adoption gaps unaddressed.',

  // Finance & Treasury
  'SAP Digital Payments': 'Payment hub connecting SAP ERP to banking networks for automated payment processing. Low consumption means payment runs are still manual or using legacy bank interfaces — operational inefficiency and fraud risk.',

  // T&E (Concur)
  'Concur - Expense': 'Travel and expense management — core Concur module for expense report submission, policy enforcement, and reimbursement. At 100%+ consumption, T&E policy compliance is healthy. Sudden drops signal a travel policy change, system integration issue, or parallel process still active.',
  'Concur - Direct Travel': 'Online booking tool for corporate travel — flights, hotels, rail. Consumption tracks booking volume. Low relative to T&E expense indicates employees are booking outside corporate channels (shadow travel).',
  'Concur - Analytics': 'Spend analytics and reporting for T&E data. Provides visibility into travel and expense patterns. Low consumption means the finance or procurement team is not using the data for policy optimization.',
  'Concur - Intelligent Audit': 'AI-powered expense receipt audit and compliance checking. Low consumption means expense reports are not being systematically audited — fraud and policy violation risk increases.',
  'Concur - Reporting Services': 'Standard and custom reporting framework for Concur. Persistent low consumption indicates management reporting on T&E is happening outside Concur.',
  'Concur - ExpenseIt': 'Mobile receipt capture and itemization. High consumption indicates field employees are using the mobile app. Low means manual receipt submission is still the norm.',
  'Concur - Triplink': 'Itinerary import and travel data aggregation from third-party booking tools. Low consumption indicates shadow booking channels are active but not being captured.',
  'Concur - Drive': 'Mileage tracking and personal vehicle reimbursement. Consumption tracks field employee reimbursement volume.',
  'Concur - Conn, Stat, Web, & Extract Svcs': 'Connectivity, status, and data extract services — the integration layer between Concur and ERP. Stable consumption indicates healthy ERP integration; drops may indicate a middleware or integration config change.',
  'Concur - Company Bill Statement': 'Corporate card reconciliation module. Consumption tracks corporate card transaction volumes being reconciled in system.',
  'Concur - Expense Pay': 'Automated reimbursement payment processing through Concur. Low consumption means expense reimbursements are still processed manually outside Concur.',
  'Concur - User Support Desk': 'User support and help desk service entitlement for Concur.',
  'Preferred Success Concur': 'SAP premium success support entitlement for Concur products. Low utilization means adoption issues are going unaddressed.',
  'WalkMe Premium for Concur': 'In-application digital adoption guidance layered on Concur. Low consumption means the guided onboarding layer is not active — a missed lever for driving adoption and reducing support tickets.',

  // CRM & Commerce
  'SAP Commerce Cloud': 'B2B and B2C digital commerce platform — storefront, catalog, order management, and checkout. The highest business-impact product in the portfolio when active. Any sustained gap below budget signals either platform migration risk, a competing commerce platform, or a failed go-live. This is a direct revenue-generating capability.',
  'Cloud for Customer': 'SAP CRM — sales force automation, opportunity management, and customer interaction management (formerly C4C). Low consumption indicates sales teams are not using the system, likely reverting to manual tools or a competing CRM.',
  'SAP Incentive Management': 'Sales compensation and incentive plan management (formerly Callidus). Calculates commission, manages quota, and distributes incentive statements. A sharp drop in a specific month typically indicates a comp plan restructure or system configuration change — not organic decline.',
  'Preferred Success Commerce': 'SAP premium success support entitlement for Commerce Cloud.',

  // Supply Chain
  'Integrated Business Planning (IBP)': 'Cloud supply chain planning suite — demand sensing, inventory optimization, S&OP. At 100% consumption this is a core operational process. Below 70% on a live deployment indicates planners are running parallel processes in spreadsheets or APO.',
  'SAP Traceability Hub': 'End-to-end product traceability and serialization for regulated industries (pharma, food). Persistent low consumption in a pharma context is an active compliance risk — serialization and track-and-trace requirements are likely being met through manual or parallel processes.',
  'Batch Release Hub': 'Batch release management for pharmaceutical manufacturing — coordinates quality inspection, documentation, and regulatory release. Low consumption in a pharma customer is a direct GxP compliance signal.',

  // Compliance
  'Watchlist Screening': 'Automated restricted/denied party screening against global trade compliance lists. Zero consumption means the customer is manually screening (high error risk) or not screening at all — a direct trade compliance and sanctions exposure.',
  'SAP Business Integrity Screening': 'Compliance and fraud detection screening. Zero consumption is a governance and audit risk.',

  // Misc
  'Single Sign-on': 'Identity and access management — SSO for SAP cloud applications. Low consumption means users are not going through centralized auth, increasing identity and access control risk.',
}

// ─── Alias dictionary for structural mismatches ────────────────────────────
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
 * Score how well a catalog name matches an LPR name.
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

/**
 * Load and parse the sap-product-catalog.json once at startup.
 * Returns empty object on missing file (warn but don't fail).
 */
function loadCatalog() {
  const catalogPath = path.join(__dirname, '..', 'ai', 'sap-product-catalog.json')
  if (!fs.existsSync(catalogPath)) {
    process.stderr.write('warn: sap-product-catalog.json not found — run --build-product-catalog\n')
    return {}
  }
  try {
    return JSON.parse(fs.readFileSync(catalogPath, 'utf8'))
  } catch {
    process.stderr.write('warn: sap-product-catalog.json could not be parsed — catalog context disabled\n')
    return {}
  }
}

/**
 * Build catalog context text for a list of product names.
 * Returns structured text for injection into L1 (per-sub-SA) prompt.
 *
 * @param {string[]} productNames — array of logical product names in this sub-SA
 * @param {object} catalog — full catalog object from loadCatalog()
 * @returns {string}
 */
function buildCatalogContextForProducts(productNames, catalog) {
  if (!productNames.length) return ''

  const lines = []
  for (const lprName of productNames) {
    // Find catalog entry via alias or fuzzy match
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

    // Build catalog capabilities text
    let catalogCaps = ''
    let catalogDesc = ''
    if (catalogEntry) {
      const caps = (catalogEntry.capabilities ?? []).filter(c =>
        c.length > 8 && c.length < 90 &&
        !/add-on|all plans|what is|early-bird|available for|get started|details/i.test(c)
      ).slice(0, 5)
      if (caps.length) catalogCaps = `  Capabilities: ${caps.join(' | ')}`
      const tagline = catalogEntry.tagline
      const usableTagline = tagline &&
        !/early-bird|available for some|get started/i.test(tagline) &&
        tagline.length > 20
      if (usableTagline) catalogDesc = tagline.slice(0, 200)
    }

    const archRole = LPR_ARCH_ROLES[lprName] ?? catalogDesc

    const block = [
      `### ${lprName}`,
      archRole ? `**Architectural role**: ${archRole}` : null,
      catalogCaps || null,
    ].filter(Boolean).join('\n')

    lines.push(block)
  }

  return lines.join('\n\n')
}

/**
 * Build the full portfolio product_catalog section for the L3 prompt.
 * Groups by logical_product name across all customers.
 *
 * @param {object} portfolio — portfolio JSON object (already enriched by L1/L2)
 * @param {object} catalog — full catalog object
 * @returns {string}
 */
function buildPortfolioCatalogContext(portfolio, catalog) {
  // Collect all unique product names with cross-customer signals
  const lprMap = new Map()  // lprName → { products: [], customers: [] }

  for (const c of portfolio.customers ?? []) {
    for (const sa of c.solution_areas ?? []) {
      for (const subSa of sa.sub_solution_areas ?? []) {
        for (const p of subSa.products ?? []) {
          const name = p.name
          if (!name) continue
          if (!lprMap.has(name)) lprMap.set(name, { products: [], customers: [] })
          lprMap.get(name).products.push(p)
          lprMap.get(name).customers.push(c.customer_name)
        }
      }
    }
  }

  if (!lprMap.size) return ''

  const lines = []
  for (const [lprName, data] of lprMap) {
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

    let catalogCaps = ''
    let catalogDesc = ''
    if (catalogEntry) {
      const caps = (catalogEntry.capabilities ?? []).filter(c =>
        c.length > 8 && c.length < 90 &&
        !/add-on|all plans|what is|early-bird|available for|get started|details/i.test(c)
      ).slice(0, 5)
      if (caps.length) catalogCaps = `  Capabilities: ${caps.join(' | ')}`
      const tagline = catalogEntry.tagline
      const usableTagline = tagline &&
        !/early-bird|available for some|get started/i.test(tagline) &&
        tagline.length > 20
      if (usableTagline) catalogDesc = tagline.slice(0, 200)
    }

    const archRole = LPR_ARCH_ROLES[lprName] ?? catalogDesc

    // Cross-customer consumption signals
    const signals = []
    for (let i = 0; i < data.products.length; i++) {
      const p = data.products[i]
      const custName = data.customers[i]?.split(' ')[0] ?? ''
      const attStr = p.ytd_attainment_pct != null ? `${p.ytd_attainment_pct.toFixed(1)}%` : 'no data'
      const trendStr = p.trend_direction === 'up' ? '↑' : p.trend_direction === 'down' ? '↓' : '→'
      const contractStr = p.contract_utilization_pct != null ? ` (${p.contract_utilization_pct.toFixed(0)}% of contract)` : ''
      signals.push(`${custName}: ${attStr}${contractStr} ${trendStr}`)
    }

    const block = [
      `### ${lprName}`,
      archRole ? `**Architectural role**: ${archRole}` : null,
      catalogCaps || null,
      `**Current consumption**: ${signals.join(' | ')}`,
    ].filter(Boolean).join('\n')

    lines.push(block)
  }

  const count = lprMap.size
  return `The following ${count} products appear in this portfolio. For each:\n- **Architectural role** = what this product does in the SAP landscape, what it enables/blocks\n- **Capabilities** = official SAP product features (from product catalog)\n- **Current consumption** = attainment% (actual/budget) and contract utilization% per customer, with trend\n\nUse this to reason about architectural maturity, dependency gaps, and what specific changes would improve each product's consumption and business value.\n\n${lines.join('\n\n')}`
}

/**
 * Format a product's metrics into compact text for L1 prompt injection.
 *
 * @param {object} product — contract:product-in-subsa-shape object
 * @returns {string}
 */
function formatProductMetrics(product) {
  const attStr = product.ytd_attainment_pct != null
    ? `${product.ytd_attainment_pct.toFixed(1)}% YTD attainment`
    : 'no YTD attainment data'
  const trendStr = product.trend_direction === 'up' ? 'trending up'
    : product.trend_direction === 'down' ? 'trending down' : 'flat trend'
  const contractStr = product.contract_utilization_pct != null
    ? `${product.contract_utilization_pct.toFixed(1)}% contract utilization`
    : ''
  const targetStr = product.ytd_target != null ? `YTD target: ${product.ytd_target.toLocaleString()}` : ''
  const actualStr = product.ytd_actuals != null ? `YTD actuals: ${product.ytd_actuals.toLocaleString()}` : ''
  const forecastStr = product.year_end_forecast != null
    ? `year-end forecast: ${product.year_end_forecast.toLocaleString()}`
    : ''

  return [attStr, trendStr, contractStr, targetStr, actualStr, forecastStr]
    .filter(Boolean).join(' | ')
}

/**
 * Derive fiscal_year from a YYYY-MM-DD date string (the year portion).
 */
function fiscalYearFromDate(dateStr) {
  return dateStr.slice(0, 4)
}

/**
 * Format today's date as YYYY-MM-DD.
 */
function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Strip markdown code fences from a string if present.
 * Handles ```json ... ``` and ``` ... ``` wrappers.
 */
function stripCodeFences(text) {
  if (!text) return text
  const trimmed = text.trim()
  // Try exact fence wrap first (most common: model returns only the JSON block)
  const exactMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i)
  if (exactMatch) return exactMatch[1].trim()
  // Fallback: extract first JSON block anywhere in the response (handles preamble text)
  const anyFence = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/i)
  if (anyFence) return anyFence[1].trim()
  // No fences — return as-is (may already be raw JSON)
  return trimmed
}

/**
 * Derive reporting_month label (e.g. "May 2026") from YYYYMM or YYYY-MM string.
 */
function formatReportingMonth(yyyymm) {
  if (!yyyymm) return '—'
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']
  const parts = String(yyyymm).split('-')
  if (parts.length === 2) {
    const m = parseInt(parts[1], 10)
    return `${months[m - 1] ?? parts[1]} ${parts[0]}`
  }
  const m = parseInt(String(yyyymm).slice(4, 6), 10)
  return `${months[m - 1] ?? yyyymm} ${String(yyyymm).slice(0, 4)}`
}

/**
 * Compute months remaining from a YYYY-MM reporting month string.
 */
function computeMonthsRemaining(yyyymm) {
  if (!yyyymm) return 0
  const parts = String(yyyymm).split('-')
  const monthIndex = parts.length === 2
    ? parseInt(parts[1], 10)
    : parseInt(String(yyyymm).slice(4, 6), 10)
  return Math.max(0, 12 - monthIndex)
}

/**
 * Extract customer name from portfolio object.
 */
function extractCustomerName(portfolio) {
  const customers = portfolio.customers ?? []
  if (customers.length === 1) {
    return customers[0].customer_name || customers[0].customer_id || 'Unknown Customer'
  }
  if (customers.length > 1) {
    return customers.map(c => c.customer_name || c.customer_id).filter(Boolean).join(', ')
  }
  return 'Unknown Customer'
}

/**
 * Build an AI chat function. When AI_BASE_URL is set use AIClient (proxy path);
 * when empty use the Anthropic SDK directly against the default endpoint.
 *
 * @gap 2026-06-26 AIClient constructor requires baseURL; when AI_BASE_URL is empty
 *   (direct Anthropic endpoint) we bypass AIClient and use the SDK directly.
 *   Spec says to use AIClient — this divergence is minimal and preserves the same
 *   SDK call semantics. Recorded in gap.md.
 */
function buildAIChat(apiKey, baseURL, model, maxTokens) {
  if (baseURL) {
    const client = new AIClient({ apiKey, baseURL, defaultModel: model, defaultMaxTokens: maxTokens })
    return (prompt) => client.chat(prompt, { model, maxTokens })
  } else {
    const anthropic = new Anthropic({ apiKey })
    return async (prompt) => {
      const response = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      })
      return response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('')
    }
  }
}

// ─── L1: Sub-SA level (haiku) ─────────────────────────────────────────────────
// @entry runL1ForSubSA | L1 pipeline — one haiku call per sub-SA
// @contract input: {customer, sa, subSa, catalog, promptVars, callHaikuChat} → output: L1 result object with signal + product insights | errors: warns and returns null on API/parse failure

/**
 * Load the L1 prompt template (analyze-sa.md) and substitute placeholders.
 */
function buildL1Prompt(vars) {
  const templatePath = path.join(__dirname, '..', 'ai', 'analyze-sa.md')
  const template = fs.readFileSync(templatePath, 'utf8')

  return template
    .replace(/\{\{sub_sa_name\}\}/g,            vars.sub_sa_name)
    .replace(/\{\{customer_name\}\}/g,           vars.customer_name)
    .replace(/\{\{current_date\}\}/g,            vars.current_date)
    .replace(/\{\{fiscal_year\}\}/g,             vars.fiscal_year)
    .replace(/\{\{reporting_month\}\}/g,         vars.reporting_month)
    .replace(/\{\{months_remaining\}\}/g,        vars.months_remaining)
    .replace(/\{\{products_metrics\}\}/g,        vars.products_metrics)
    .replace(/\{\{product_catalog_context\}\}/g, vars.product_catalog_context)
}

/**
 * Run L1 for a single sub-SA. Returns parsed L1 result object or null on failure.
 *
 * @param {object} opts
 * @param {string} opts.customerName
 * @param {string} opts.subSaName
 * @param {object[]} opts.products — array of contract:product-in-subsa-shape
 * @param {object} opts.catalog — full catalog object
 * @param {object} opts.promptVars — {current_date, fiscal_year, reporting_month, months_remaining}
 * @param {Function} opts.callHaikuChat — async (prompt) → string
 * @returns {Promise<{signal_type, pattern, products: [{name, insight, recommendation, ea_action}]} | null>}
 */
async function runL1ForSubSA({ customerName, subSaName, products, catalog, promptVars, callHaikuChat }) {
  if (!products.length) return null

  // Build products metrics text
  const productsMetrics = products.map(p =>
    `- **${p.name}** (${p.lpr ?? ''}): ${formatProductMetrics(p)}`
  ).join('\n')

  // Build catalog context for the products in this sub-SA
  const productNames = products.map(p => p.name).filter(Boolean)
  const productCatalogContext = buildCatalogContextForProducts(productNames, catalog)

  const prompt = buildL1Prompt({
    sub_sa_name:            subSaName,
    customer_name:          customerName,
    current_date:           promptVars.current_date,
    fiscal_year:            promptVars.fiscal_year,
    reporting_month:        promptVars.reporting_month,
    months_remaining:       String(promptVars.months_remaining),
    products_metrics:       productsMetrics,
    product_catalog_context: productCatalogContext || '(No catalog context available for these products)',
  })

  let rawText
  try {
    rawText = await callHaikuChat(prompt)
  } catch (err) {
    process.stderr.write(`warn: L1 API call failed for sub-SA "${subSaName}" (${customerName}): ${err.message ?? String(err)}\n`)
    return null
  }

  // Parse JSON response
  try {
    const cleaned = stripCodeFences(rawText)
    return JSON.parse(cleaned)
  } catch (parseErr) {
    process.stderr.write(`warn: L1 JSON parse failed for sub-SA "${subSaName}" (${customerName}): ${parseErr.message}\n`)
    return null
  }
}

// ─── L2: Distribute L1 product fields into portfolio objects ─────────────────
// @entry distributeL1Results | L2 pipeline — no API call, writes L1 output back to product objects
// @contract input: portfolio object (mutated in-place) + l1Results map → output: portfolio with product.insight, product.recommendation, product.ea_action populated

/**
 * Distribute L1 results back into the portfolio product objects (mutates in-place).
 * L1 returns products by name; we match by name (case-sensitive, exact).
 *
 * @param {object} portfolio — portfolio JSON object
 * @param {Map<string, object>} l1Results — map keyed by "${customerName}:::${subSaName}" → L1 result
 */
function distributeL1Results(portfolio, l1Results) {
  for (const customer of portfolio.customers ?? []) {
    for (const sa of customer.solution_areas ?? []) {
      for (const subSa of sa.sub_solution_areas ?? []) {
        const key = `${customer.customer_name}:::${subSa.name}`
        const l1Result = l1Results.get(key)
        if (!l1Result || !Array.isArray(l1Result.products)) continue

        // Index L1 products by name for O(1) lookup
        const l1ProductMap = new Map(l1Result.products.map(p => [p.name, p]))

        for (const product of subSa.products ?? []) {
          const l1Product = l1ProductMap.get(product.name)
          if (!l1Product) continue
          product.insight        = l1Product.insight        ?? null
          product.recommendation = l1Product.recommendation ?? null
          product.ea_action      = l1Product.ea_action      ?? null
        }
      }
    }
  }
}

// ─── L3: Portfolio level (opus) ───────────────────────────────────────────────
// @entry buildL3Prompt | L3 pipeline — one opus call for the full portfolio
// @contract input: enriched portfolio + catalog + promptVars → output: ai_insights object

/**
 * Build the L3 portfolio-level prompt from analyze.md.
 */
function buildL3Prompt(vars) {
  const templatePath = path.join(__dirname, '..', 'ai', 'analyze.md')
  const template = fs.readFileSync(templatePath, 'utf8')

  return template
    .replace(/\{\{product_catalog\}\}/g,    vars.product_catalog)
    .replace(/\{\{portfolio_data\}\}/g,     vars.portfolio_data)
    .replace(/\{\{customer_name\}\}/g,      vars.customer_name)
    .replace(/\{\{current_date\}\}/g,       vars.current_date)
    .replace(/\{\{fiscal_year\}\}/g,        vars.fiscal_year)
    .replace(/\{\{reporting_month\}\}/g,    vars.reporting_month)
    .replace(/\{\{months_remaining\}\}/g,   vars.months_remaining)
    .replace(/\{\{input_content\}\}/g,      vars.portfolio_data)
    .replace(/\{\{input_type\}\}/g,         'portfolio_json')
    .replace(/\{\{filename\}\}/g,           vars.filename ?? '')
}

// ─── Main entry point ─────────────────────────────────────────────────────────

// @entry run(args, options) | dispatched from cli.js for --analyze flag
export async function run(args, options) {
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

  if (!config.aiApiKey) {
    throw new UserError('AI_API_KEY is not set')
  }

  const filename = path.basename(resolvedPath)
  const ext      = path.extname(filename).toLowerCase()
  const isJson   = ext === '.json'

  // Read file contents
  let rawContent
  try {
    rawContent = fs.readFileSync(resolvedPath, 'utf8')
  } catch (err) {
    throw new ProcessingError(`cannot read file: ${err.message}`)
  }

  // Parse portfolio.json
  let portfolioData = null

  if (isJson) {
    try {
      portfolioData = JSON.parse(rawContent)
    } catch (err) {
      throw new ProcessingError(`cannot parse JSON: ${err.message}`)
    }
  } else {
    portfolioData = { raw_csv: rawContent }
  }

  // ── Build common prompt variables ──────────────────────────────────────────
  const currentDate     = todayISO()
  const fiscalYear      = portfolioData.fiscal_year ?? fiscalYearFromDate(currentDate)
  const reportingMonth  = formatReportingMonth(portfolioData.reporting_month)
  const monthsRemaining = computeMonthsRemaining(portfolioData.reporting_month)
  const customerName    = isJson ? extractCustomerName(portfolioData) : 'Unknown Customer'

  const custCount    = portfolioData.customers?.length ?? 0
  const subSaCount   = (portfolioData.customers ?? []).reduce((t, c) =>
    t + (c.solution_areas ?? []).reduce((s, sa) => s + (sa.sub_solution_areas ?? []).length, 0), 0)
  const productCount = (portfolioData.customers ?? []).reduce((t, c) =>
    t + (c.solution_areas ?? []).reduce((s, sa) =>
      s + (sa.sub_solution_areas ?? []).reduce((p, sub) => p + (sub.products ?? []).length, 0), 0), 0)

  process.stderr.write(`info: loaded ${filename} — FY${fiscalYear}, reporting month ${reportingMonth}, ${monthsRemaining} months remaining\n`)
  process.stderr.write(`info: portfolio — ${custCount} customer(s), ${subSaCount} sub-SA(s), ${productCount} product(s)\n`)

  const promptVars = {
    current_date:     currentDate,
    fiscal_year:      fiscalYear,
    reporting_month:  reportingMonth,
    months_remaining: monthsRemaining,
  }

  // ── Load product catalog once at startup ───────────────────────────────────
  const catalog = loadCatalog()

  // ── Build AI chat functions for each level ─────────────────────────────────
  const L1_MAX_TOKENS = 2000
  const callHaikuChat = buildAIChat(config.aiApiKey, config.aiBaseUrl, MODELS.haiku, L1_MAX_TOKENS)
  const callOpusChat  = buildAIChat(config.aiApiKey, config.aiBaseUrl, MODELS.opus, config.aiMaxTokens)

  // ── L1: Run haiku calls in parallel across all sub-SAs ────────────────────
  const l1Tasks = []
  if (isJson && Array.isArray(portfolioData.customers)) {
    for (const customer of portfolioData.customers) {
      for (const sa of customer.solution_areas ?? []) {
        for (const subSa of sa.sub_solution_areas ?? []) {
          const products = subSa.products ?? []
          if (!products.length) continue
          const key = `${customer.customer_name}:::${subSa.name}`
          l1Tasks.push({
            key,
            customerName:  customer.customer_name,
            subSaName:     subSa.name,
            products,
          })
        }
      }
    }
  }

  // Run all L1 tasks in parallel using Promise.all
  // @contract input: l1Tasks[] → output: Map<key, L1Result|null> | errors: individual failures degrade gracefully (warn + null)
  const l1Results = new Map()
  if (l1Tasks.length > 0) {
    process.stderr.write(`info: L1 — ${l1Tasks.length} sub-SA(s) across ${custCount} customer(s) (haiku, parallel)\n`)
    const l1Settled = await Promise.allSettled(
      l1Tasks.map(task =>
        runL1ForSubSA({
          customerName:  task.customerName,
          subSaName:     task.subSaName,
          products:      task.products,
          catalog,
          promptVars,
          callHaikuChat,
        }).then(result => {
          process.stderr.write(`info:   L1 done — ${task.customerName} / ${task.subSaName} (${task.products.length} product(s))\n`)
          return { key: task.key, result }
        })
      )
    )
    let l1Ok = 0, l1Fail = 0
    for (const settled of l1Settled) {
      if (settled.status === 'fulfilled') {
        const { key, result } = settled.value
        l1Results.set(key, result)
        l1Ok++
      } else {
        process.stderr.write(`warn: unexpected L1 failure: ${settled.reason}\n`)
        l1Fail++
      }
    }
    process.stderr.write(`info: L1 complete — ${l1Ok} succeeded${l1Fail ? `, ${l1Fail} failed` : ''}\n`)
  }

  // ── L2: Distribute L1 results into portfolio product objects ──────────────
  if (isJson && portfolioData !== null) {
    distributeL1Results(portfolioData, l1Results)
  }

  // ── L3: Build enriched portfolio payload for opus call ────────────────────
  const promptPayload = { ...portfolioData }
  delete promptPayload.ai_narrative
  delete promptPayload.ai_insights
  delete promptPayload.ai_config
  delete promptPayload.source_csv
  delete promptPayload.current_date

  // Strip internal/redundant fields from each customer's products
  if (isJson && Array.isArray(promptPayload.customers)) {
    promptPayload.customers = promptPayload.customers.map(c => ({
      ...c,
      solution_areas: (c.solution_areas ?? []).map(sa => ({
        ...sa,
        sub_solution_areas: (sa.sub_solution_areas ?? []).map(subSa => {
          return {
            ...subSa,
            products: (subSa.products ?? []).map(p => {
              const clean = { ...p }
              delete clean._composite_key
              return clean
            }),
          }
        }),
      })),
    }))
  }

  // Build catalog context for L3 prompt
  const portfolioCatalogContext = buildPortfolioCatalogContext(portfolioData, catalog)

  // @contract input: enriched portfolioData + catalog → output: final L3 prompt string
  const l3Prompt = buildL3Prompt({
    product_catalog:  portfolioCatalogContext,
    portfolio_data:   JSON.stringify(promptPayload, null, 2),
    customer_name:    customerName,
    current_date:     currentDate,
    fiscal_year:      fiscalYear,
    reporting_month:  reportingMonth,
    months_remaining: String(monthsRemaining),
    filename,
  })

  // ── L3: Call opus for portfolio-level narrative ────────────────────────────
  process.stderr.write(`info: L3 — portfolio-level analysis (opus, max ${config.aiMaxTokens} tokens)\n`)
  let l3RawText
  try {
    l3RawText = await callOpusChat(l3Prompt)
  } catch (err) {
    throw new ProcessingError(`AI API error: ${err.message ?? String(err)}`)
  }

  // Parse L3 response as JSON
  let aiInsights = null
  let narrativeText = l3RawText

  try {
    const cleaned = stripCodeFences(l3RawText)
    aiInsights = JSON.parse(cleaned)
    narrativeText = aiInsights.pulse_narrative ?? l3RawText

    // Log what was generated
    const pc   = Object.keys(aiInsights.per_customer ?? {})
    const ev   = aiInsights.executive_view?.portfolio_health_by_customer?.length ?? 0
    const rr   = aiInsights.renewal_risks?.length ?? 0
    const mo   = aiInsights.momentum?.length ?? 0
    const as   = aiInsights.architectural_signals?.length ?? 0
    const ip   = aiInsights.industry_perspectives?.length ?? 0
    process.stderr.write(`info: L3 complete — generated:\n`)
    process.stderr.write(`info:   per_customer      : ${pc.length} (${pc.join(', ')})\n`)
    process.stderr.write(`info:   executive_view    : ${ev} customer(s)\n`)
    process.stderr.write(`info:   renewal_risks     : ${rr}\n`)
    process.stderr.write(`info:   momentum          : ${mo}\n`)
    process.stderr.write(`info:   architectural_signals: ${as}\n`)
    process.stderr.write(`info:   industry_perspectives: ${ip}\n`)
  } catch (parseErr) {
    process.stderr.write(`warn: L3 JSON parse failed — storing raw text: ${parseErr.message}\n`)
    aiInsights = null
    narrativeText = l3RawText
  }

  // ── Write back into portfolio.json ────────────────────────────────────────
  if (isJson && portfolioData !== null) {
    try {
      portfolioData.ai_insights  = aiInsights
      portfolioData.ai_narrative = narrativeText
      fs.writeFileSync(resolvedPath, JSON.stringify(portfolioData, null, 2), 'utf8')
      const bytes = fs.statSync(resolvedPath).size
      process.stderr.write(`info: written — ${resolvedPath} (${(bytes/1024).toFixed(0)} KB)\n`)
    } catch (err) {
      process.stderr.write(`warn: could not update ai_insights in ${filename}: ${err.message}\n`)
    }
  }

  // ── Write narrative to --output file or stdout ─────────────────────────────
  const outputPath = options && options.output ? options.output : null

  if (outputPath) {
    // @contract input: narrativeText, outputPath → output: narrative written to file | errors: throws ProcessingError on write failure
    try {
      const resolvedOutput = path.isAbsolute(outputPath)
        ? outputPath
        : path.resolve(process.cwd(), outputPath)
      const outputContent = aiInsights !== null
        ? JSON.stringify(aiInsights, null, 2)
        : l3RawText
      fs.writeFileSync(resolvedOutput, outputContent, 'utf8')
    } catch (err) {
      throw new ProcessingError(`cannot write output file: ${err.message}`)
    }
  } else {
    process.stdout.write(narrativeText)
    if (narrativeText && !narrativeText.endsWith('\n')) {
      process.stdout.write('\n')
    }
  }
}
