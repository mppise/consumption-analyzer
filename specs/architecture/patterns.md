# Patterns

## pattern:cli-dispatch
The dominant request-response pattern for this project. The CLI entry point (`src/cli.js`) receives a parsed command from commander and dispatches to the appropriate tool module.

Flow:
1. `src/cli.js` bootstraps: loads `.env` via dotenv, instantiates a commander `Program`
2. Each feature flag is registered on the program (e.g. `.option('--pdf2csv <file>', '...')`)
3. Commander parses `process.argv`
4. `cli.js` inspects which option was set and calls the corresponding module: `import('./tools/pdf2csv.js').then(m => m.run(args, options))`
5. Tool module does its work, writes output to stdout, writes status/errors to stderr
6. On success: process exits with code 0
7. On error: tool throws; `cli.js` catch block writes `error: <message>` to stderr, exits with code 1 or 2

Key constraint: tool modules never call `process.exit()` directly — only `cli.js` controls exit codes.

---

## pattern:stream-to-stdout
For CSV output, the tool writes directly to `process.stdout` using a streaming pipeline to avoid buffering entire files in memory.

Flow:
1. pdfreader reads the PDF file page by page, emitting text items with x/y coordinates
2. A table-reconstruction function in `src/lib/` groups items into rows by y-coordinate proximity
3. csv-stringify transforms row arrays into CSV lines
4. Lines are piped to `process.stdout` (or a `fs.WriteStream` if writing to disk)

This pattern keeps memory usage flat regardless of PDF size (up to `PDF_MAX_PAGES`).

Note: pdfreader v3 (backed by pdf2json) buffers the full PDF parse result internally before emitting items. True incremental page-streaming at the library level is not achievable without reimplementing pdf2json parsing. Page-by-page processing within the pdfreader callback is the closest supported approximation.

---

## pattern:env-config
All runtime configuration is loaded once at startup from `.env` via dotenv, merged with hardcoded defaults. No config is read mid-execution.

Flow:
1. `dotenv.config()` called at the top of `src/cli.js` before any other logic
2. `src/config/index.js` exports a frozen config object built from `process.env` with fallbacks:
   ```js
   export const config = Object.freeze({
     dataDir: process.env.DATA_DIR ?? './data',
     logLevel: process.env.LOG_LEVEL ?? 'info',
     pdfMaxPages: parseInt(process.env.PDF_MAX_PAGES ?? '0', 10),
     csvDelimiter: process.env.CSV_DELIMITER ?? ',',
   })
   ```
3. Tool modules import from `src/config/index.js` — never read `process.env` directly

---

## pattern:exit-code-contract
Consistent exit codes across all tool modules, enforced by `cli.js`:

- `0` — success; output written
- `1` — user error (bad args, file not found, missing required flag)
- `2` — processing failure (no tables detected, corrupt/unreadable PDF, write error, reconciliation failure)

`cli.js` wraps every `module.run()` call in try/catch and maps thrown error types to exit codes.

---

## pattern:bottom-up-ai-pipeline
The 5-step bottom-up AI analysis pattern. Used by the --analyze tool. All AI calls are mediated through prompt templates in `/src/ai/` — no inline prompt strings in source code. The sole product knowledge source is `src/ai/sap-product-catalog.json`.

The pipeline processes each customer independently and writes AI insight fields back into the portfolio JSON in-place. Steps run bottom-up from leaf (L3 contract) to root (industry), each step consuming the outputs of the step below it.

**Step 1 — Contract insights per L3 product (sonnet model)**
- Input: all year/month records in entity:contract for this one L3 product, including variances (acv_gap, budget_gap, budget_attainment)
- Output: contract.ai_insights[] — short paragraphs of raw financial and consumption signal for this product
- Scope: one API call per L3 product

**Step 2 — Solution-architecture insights per L2 grouping (sonnet model)**
- Input: Step 1 ai_insights from ALL L3 products under this L2 + relevant entries from sap-product-catalog.json
- Output: solutions_l3[].solution_architecture_insights[] — functional architecture observations across the L2's products
- Scope: one API call per L2 grouping per customer

**Step 3 — Enterprise-architecture insights per L1 solution area (sonnet model)**
- Input: Step 2 enterprise_architecture_insights (and Step 1 insights as context) from ALL L2s under this L1 + relevant entries from sap-product-catalog.json
- Output: solutions_l1[].enterprise_architecture_insights[] — EA-level action items, patterns, and risks
- Scope: one API call per L1 solution area per customer

**Step 4 — Account insights per customer (opus model)**
- Input: Steps 1+2+3 outputs for this customer + aggregated contract values across all L3 products
- Output: customer.account_insights[] — executive-facing summary and prioritised action items
- Scope: one API call per customer

**Step 5 — Industry insights (opus model)**
- Input: Steps 1+2+3 outputs for ALL customers in this industry + contract values aggregated across those customers (from industry_insights[].aggregated_contracts)
- Output: industry_insights[].summary[] — VAT-facing cross-customer industry narrative and action items
- Scope: one API call per distinct industry

**Key constraints:**
- Every prompt template is a `.md` file under `/src/ai/` with `{{placeholder}}` syntax — all existing prompt files (analyze.md, analyze-sa.md) are replaced by new step-specific templates
- API key sourced from `AI_API_KEY` env var — never hardcoded
- Product catalog (`src/ai/sap-product-catalog.json`) is the sole product knowledge source; no other file may inject product knowledge into prompts
- Steps 1–3 use `AI_MODEL` (sonnet); Steps 4–5 use `AI_MODEL_SENIOR` (opus) — both env vars required
- The tool writes each step's output back into the portfolio JSON on disk after each step completes — a crash mid-pipeline loses at most one step's worth of computation
- AI responses are never interpreted or reformatted in source code — they are stored as string arrays verbatim in the JSON

---

## pattern:metrics-computation
The pattern for computing all cACV-domain metrics in Node.js inside --transform. No AI involvement. All computations are deterministic given the same input data.

Flow:
1. `src/tools/transform.js` reads the CSV file using csv-parse, skipping the 2-row header
2. Each row is parsed into a `cacv-json-record` — comma-formatted numbers stripped and converted to float
3. Records are grouped by `product_id` and month into the L1 → L2 → L3 hierarchy
4. For each L3 product, `src/lib/metrics.js` computes per entity:contract_month:
   - annual_contract_value: ACV actuals for this month
   - budget_contract_value: budgeted value for this month
   - consumed_contract_value: actual consumption (0 for future months)
   - variances.acv_gap: annual_contract_value - consumed_contract_value
   - variances.budget_gap: budget_contract_value - consumed_contract_value
   - variances.budget_attainment: (consumed / budget) * 100; null if budget = 0
5. Industry is inferred by STORY-006 logic (--transform pass or dedicated inference pass) and written to entity:customer.industry
6. The completed portfolio object is written to `data/<source-basename>-portfolio.json`

Key constraint: all metric computations happen in `src/lib/` modules — never inline in the tool module. Integer-safe arithmetic: Math.round(val * 100) per value, sum as integers, divide by 100.

---

## pattern:risk-classification-engine
The deterministic risk classification algorithm. Applied per L3 product in `src/lib/risk.js`. Rules evaluated in order of severity — first match wins (Critical takes precedence over High, etc.). Risk classification operates on the contract_month series for each L3 product.

Rules (in evaluation order):
1. Critical: any 2+ consecutive reported months where budget_attainment < 50%
2. Critical: any reported month where consumed_contract_value = 0 AND budget_contract_value > 0 (zero-utilization)
3. High: latest reported month budget_attainment in [50, 74] AND downward trend over last 3 months
4. High: average budget_attainment across reported months < 70% AND count of reported months > 3
5. Medium: budget_attainment in [75, 89] in latest reported month AND downward trend
6. Medium: exactly one reported month with consumed_contract_value = 0 AND budget_contract_value > 0
7. Low: latest reported month budget_attainment in [90, 99]
8. OnTrack: average budget_attainment >= 100%
8b. OnTrack (catch-all): average budget_attainment >= 90% with no active risk triggers from rules 1–7
8c. Low (catch-all): any product with at least one reported month and no match from rules 1–8b
9. NoData: budget_contract_value = 0 for all months OR no reported months yet

Key constraint: these rule definitions live as constants in `src/lib/risk.js`. No other file may define or modify risk thresholds.

---

## pattern:html-generation
The pattern for generating the self-contained, portable HTML dashboard in --dashboard. No web server, no build step — a single static file that opens in any browser.

Flow:
1. `src/tools/dashboard.js` reads the `portfolio-json` file from disk
2. Bootstrap 5 CSS, Bootstrap JS, and Bootstrap Icons are read from `node_modules` at generation time and inlined as `<style>` and `<script>` blocks; Chart.js is also inlined. The HTML shell may be defined as a template in `src/lib/dashboard/template.js` or kept inline in `dashboard.js` — either is acceptable provided the zero-CDN constraint is met.
3. The portfolio JSON data is embedded in the HTML as a `<script>const DATA = {...}</script>` block — no external fetch required
4. The 3-pane layout (industry list / customer list / L3 detail) is rendered as a single HTML document; pane content is driven by vanilla JS click handlers that filter from the embedded DATA object
5. The final HTML string is written to `data/<source-basename>-dashboard.html`

Key constraints:
- Zero external dependencies at view time: Bootstrap CSS, Bootstrap JS, and all icons are inlined — the file must be openable without internet access
- HTML generation may be inline in the tool module or extracted to a separate template module — no structural requirement on file location
- All data visible in the dashboard must come from the embedded DATA constant — no runtime computation in browser JS beyond pane filtering and rendering
- File size is acceptable up to ~5 MB for a single customer portfolio # inferred
