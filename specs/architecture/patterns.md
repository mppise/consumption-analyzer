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
- `2` — processing failure (no tables detected, corrupt/unreadable PDF, write error)

`cli.js` wraps every `module.run()` call in try/catch and maps thrown error types to exit codes.

---

## pattern:ai-prompt-call
The pattern for tools that call an external AI/LLM API. Used by the --analyze tool.

Flow:
1. Tool reads the input file (CSV) from disk into a string
2. Tool loads the prompt template from `/src/ai/analyze.md` — a Markdown file with `{{placeholder}}` syntax
3. Template variables (e.g. `{{csv_content}}`, `{{filename}}`) are substituted to produce the final prompt string
4. Tool calls the Anthropic SDK (`@anthropic-ai/sdk`) using config values from `src/config/index.js` (AI_MODEL, AI_MAX_TOKENS, AI_API_KEY)
5. Response text is written directly to `process.stdout`
6. On API error: tool throws with a descriptive message; `cli.js` writes `error: <message>` to stderr and exits with code 2

Key constraints:
- The prompt template is always a `.md` file under `/src/ai/` — never inline strings in source code
- API key is sourced from `AI_API_KEY` env var — never hardcoded
- The tool never interprets or reformats the AI response — raw text goes to stdout as-is
- Large CSV files must be trimmed or summarised before inclusion in the prompt if they exceed AI_MAX_TOKENS context limits # inferred

---

## pattern:metrics-computation
The pattern for computing all cACV-domain metrics in Node.js inside --transform. No AI involvement. All computations are deterministic given the same input data.

Flow:
1. `src/tools/transform.js` reads the CSV file using csv-parse, skipping the 2-row header
2. Each row is parsed into a `cacv-json-record` — comma-formatted numbers stripped and converted to float
3. Records are grouped by `product_id` into a Map; within each product, records are sorted by month ascending
4. For each product group, `src/lib/metrics.js` computes:
   - Per-month: attainment_pct = actual / target * 100 (null if target = 0), gap = actual - target
   - YTD: sum targets and actuals for all months where is_future_month = false
   - trend_direction: compare average attainment of last 3 reported months vs prior 3
   - run_rate_projection: (ytd_actual / reported_months) * total_fiscal_months
   - predictability scores: derived from variance and trend consistency across reported months # inferred
5. The `src/lib/risk.js` module evaluates each product against the 9 business rules in order of severity (Critical first) — returns the highest matching risk level and the triggering rule
6. `src/lib/recommendations.js` maps each risk-classified product to a `dashboard-recommendation` using a static rule table (no AI)
7. All products are assembled into a `portfolio-json` and written to `data/<source-basename>-portfolio.json`

Key constraint: all metric computations happen in `src/lib/` modules — never inline in the tool module. `src/lib/risk.js` is the single source of truth for the 9 business rules; no other file may implement risk logic.

---

## pattern:risk-classification-engine
The deterministic risk classification algorithm. Applied per product in `src/lib/risk.js`. Rules evaluated in order of severity — first match wins (Critical takes precedence over High, etc.).

Rules (in evaluation order):
1. Critical: any 2+ consecutive reported months where attainment_pct < 50%
2. Critical: any reported month where actual = 0 AND target > 0 (zero-utilization)
3. High: latest reported month attainment_pct in [50, 74] AND downward trend over last 3 months
4. High: ytd_attainment_pct < 70% AND count of reported months > 3
5. Medium: attainment_pct in [75, 89] in latest reported month AND downward trend
6. Medium: exactly one reported month with actual = 0 AND target > 0 (not consecutive)
7. Low: latest reported month attainment_pct in [90, 99]
8. OnTrack: ytd_attainment_pct >= 100%
8b. OnTrack (catch-all): ytd_attainment_pct >= 90% with no active risk triggers from rules 1–7
8c. Low (catch-all): any product with at least one reported month and no match from rules 1–8b
9. NoData: target = 0 for all months OR no reported months yet

Key constraint: these rule definitions live as constants in `src/lib/risk.js`. No other file may define or modify risk thresholds. When a rule is updated, only `src/lib/risk.js` changes.

---

## pattern:html-generation
The pattern for generating the self-contained, portable HTML dashboard in --dashboard. No web server, no build step — a single static file that opens in any browser.

Flow:
1. `src/tools/dashboard.js` reads the `portfolio-json` file from disk
2. For each of the four tab views, `src/lib/dashboard/[view].js` computes the view-specific data slice (e.g. top 5 at-risk by $ value for Executive tab)
3. `src/lib/dashboard/template.js` holds the HTML shell template as a JS template literal; Bootstrap 5 CSS and Chart.js are read from `node_modules` at generation time and inlined as `<style>` and `<script>` blocks
4. The portfolio JSON data is embedded in the HTML as a `<script>const DATA = {...}</script>` block — no external fetch required
5. Tab switching is handled by Bootstrap's tab component (JS inline in the template)
6. Charts (heatmap, bar, trend) are rendered by Chart.js using the embedded DATA object
7. The final HTML string is written to `data/<source-basename>-dashboard.html`

Key constraints:
- Zero external dependencies at view time: Bootstrap CSS, Bootstrap JS, Chart.js, and all icons are inlined — the file must be openable without internet access
- The template is in `src/lib/dashboard/template.js` — not inline in the tool module
- All data visible in the dashboard must come from the embedded DATA constant — no runtime computation in browser JS beyond chart rendering and tab switching
- File size is acceptable up to ~5 MB for a single customer portfolio # inferred
