# Contracts

## contract:error-envelope
Standard error shape written to stderr on any non-zero exit. All error output from any tool module must conform to this shape.

```
error: <message>
```

Fields:
- prefix: literal string `error:` — always present on error lines
- message: string — human-readable description of what went wrong

Examples:
- `error: file not found: data/report.pdf`
- `error: no tables detected in data/report.pdf`
- `error: --pdf2csv requires a filename argument`

Exit code accompanies the message: 1 for user errors, 2 for processing failures.

---

## contract:warn-envelope
Standard shape for non-fatal warnings written to stderr during processing.

```
warn: <message>
```

Fields:
- prefix: literal string `warn:` — always present on warning lines
- message: string — human-readable description of the condition

Examples:
- `warn: page 3 skipped — no text layer detected`
- `warn: PDF_MAX_PAGES reached — output may be incomplete`

---

## contract:csv-row # inferred
A single row of CSV output written to stdout or the output file. Conforms to RFC 4180.

Fields:
- fields: string[] — one element per detected column; quoted if containing delimiter or newline
- delimiter: string — value of CSV_DELIMITER env var (default `,`)

First row is the header row derived from the PDF table's top row (if detectable); subsequent rows are data rows.

---

## contract:tool-module
The interface every tool module under `/src/tools/` must export.

```js
export async function run(args, options) { ... }
```

Fields:
- args: string[] — positional arguments passed after the flag (e.g. `['report.pdf']`)
- options: object — parsed commander options relevant to this tool
- returns: Promise<void> — resolves on success; throws on error (cli.js catches and writes error-envelope to stderr, sets exit code)

---

## contract:analysis-response # inferred
The shape of output written to stdout by the --analyze tool. Plain text — the raw response from the AI model, streamed or written in full on success.

Fields:
- content: string — the AI model's response text; no wrapping, no prefix, written directly to stdout
- format: plain text — no JSON envelope, no ANSI codes unless explicitly enabled # inferred

Examples:
```
Summary: The dataset contains 12 months of meter readings for three sites...
Trend: Consumption increased 18% in Q3 relative to Q1...
Anomaly: Row 47 shows a reading of 0 — possible gap or missing value...
```

The exact structure of the AI response is governed by the prompt template at `/src/ai/analyze.md`; this contract defines only the output channel and format rules.

---

## contract:cacv-json-record
A single parsed row from the cACV CSV, as produced by --transform's CSV parser. This is the intermediate representation before metrics computation.

Fields:
- solution_area: string — top-level portfolio grouping
- sub_solution_area: string — second-level grouping
- logical_product: string — product name; may be empty string in CSVs derived from new-format PDFs (CACV_CROSS_FC_OPS_DIBO_REPORT) where the 'lpr' column carries only the LPR product code; downstream fieldMapper must treat empty string as unknown product name, not an error
- product_id: string — LPR product identifier code (e.g. "LPR868"); same code may appear in multiple rows with different sub_solution_areas or customer_ids
- customer_id: string | null — customer identifier parsed from combined "Name (ID)" field via parseCustomerRaw(); null in single-customer CSVs. Note: employee_id is not present — customers are identified by customer_id only.
- customer_raw: string | null — raw combined "Name (ID)" field as it appears in the CSV; null if not present
- month: string — YYYYMM format
- cacv_target: number — numeric value after stripping comma formatting (e.g. "1,234.56" → 1234.56); 0 if empty
- cacv_actual: number — numeric value; 0 for future months; for FY2024/FY2025 historical rows: when both cacv_act (col 6) and cacv_target are empty and delta_cacv (col 7) is positive, delta_cacv is used as actuals proxy
- delta_cacv: number | null — value of "Δ cACV to BUD" column (col 7); retained in intermediate record for actuals fallback logic

Notes:
- The source CSV has a 2-row header; the parser must skip both header rows and derive column semantics by position or label matching — keys are flexible, not hardcoded
- Numbers in the CSV are comma-formatted (e.g. "1,234,567.89") — must be stripped before parseFloat
- New-format CSVs (CACV_CROSS_FC_OPS_DIBO_REPORT) have swapped 2-row header order; isCacvHeaderRow() and buildMergedHeader() handle both old and new formats

---

## contract:product-metrics-shape
The computed metrics object for a single product as written into entity:portfolio-snapshot. This is the JSON shape that --dashboard reads.

Fields:
- logical_product: string
- logical_product_id: string — composite uniqueness key `customer_id|solution_area|sub_solution_area|product_id`; used as the reconciler and display key; unique per product-within-sub_area-within-customer
- lpr_id: string — canonical LPR product registry code (e.g. "LPR868"); the real product identifier; may be shared across multiple logical_product_id entries
- product_id: string — alias for lpr_id; retained for backward compatibility
- solution_area: string
- sub_solution_area: string
- months: array of month-records (see below)
- ytd_target: number
- ytd_actual: number
- ytd_attainment_pct: number | null
- run_rate_projection: number
- predictability_short_term: number (0–100)
- predictability_long_term: number (0–100)
- risk_level: "Critical" | "High" | "Medium" | "Low" | "OnTrack" | "NoData"
- trend_direction: "up" | "down" | "flat"

Month-record shape:
- month: string (YYYYMM)
- target: number
- actual: number
- attainment_pct: number | null
- gap: number
- is_future_month: boolean

---

## contract:portfolio-json
The top-level JSON file written to disk by --transform and read by --dashboard. Filename convention: `<source-basename>-portfolio.json` in data/. Products are nested inside customers → solution_areas → sub_solution_areas, not at the root level.

Fields:
- generated_at: string (ISO 8601)
- reporting_month: string (YYYYMM — latest month with non-zero actuals)
- fiscal_year: string (e.g. "FY2026")
- customer_count: integer — number of distinct customers in the dataset
- industry: string — inferred industry vertical (e.g. "Pharma/Life Sciences", "Manufacturing", "Healthcare"); populated by STORY-006 (--transform or a dedicated inference pass)
- customers: contract:customer-portfolio-shape[] — one entry per distinct customer
- summary: object — portfolio-level rollup:
  - total_ytd_target: number
  - total_ytd_actuals: number
  - overall_attainment_pct: number (1 decimal precision)
- ai_insights: object | null — structured JSON insights block written by --analyze; contains pulse_narrative, per_customer, executive_view, and other fields; null until --analyze has run

AI pipeline levels (3-level):
1. Sub-SA level — haiku model; produces per-sub-SA narrative context
2. Product level — haiku model (via sub-SA response); populates product.insight, product.recommendation, product.ea_action
3. Portfolio level — opus model; produces executive_view and portfolio pulse_narrative

---

## contract:customer-portfolio-shape
The JSON shape for one customer entry within contract:portfolio-json.customers[].

Fields:
- customer_id: string — parsed identifier
- customer_name: string — display name
- summary: object — customer-level rollup (consumed by Executive/Regional Head view; no product detail):
  - total_ytd_target: number
  - total_ytd_actuals: number
  - overall_attainment_pct: number (1 decimal precision)
- solution_areas: contract:solution-area-shape[] — full nested hierarchy (consumed by EA view)

---

## contract:solution-area-shape
One solution area entry within contract:customer-portfolio-shape.solution_areas[].

Fields:
- name: string — e.g. "Finance and Spend Management"
- ytd_target: number
- ytd_actuals: number
- attainment_pct: number (1 decimal precision)
- sub_solution_areas: contract:sub-solution-area-shape[]

---

## contract:sub-solution-area-shape
One sub-solution area entry within contract:solution-area-shape.sub_solution_areas[]. This is the leaf-bearing level — products live here.

Fields:
- name: string — e.g. "Procurement"
- ytd_target: number
- ytd_actuals: number
- attainment_pct: number (1 decimal precision)
- products: contract:product-in-subsa-shape[]

---

## contract:product-in-subsa-shape
The product object stored within sub_solution_areas[].products[]. This is the primary per-product data shape consumed by the EA view and AI pipeline.

Fields:
- lpr: string — LPR product code (e.g. "LPR868")
- name: string — logical product name (e.g. "Ariba Buying and Invoicing")
- ytd_target: number
- ytd_actuals: number
- ytd_attainment_pct: number | null — `Math.round((actuals / target) * 1000) / 10`; null if target = 0
- ytd_acv_act: number — ACV actuals for the YTD period
- contract_utilization_pct: number — utilization percentage against contract value
- monthly_series: array of {month: string, target: number, actual: number, attainment_pct: number|null, gap: number, is_future_month: boolean}
- trend_direction: "up" | "down" | "flat"
- insight: string | null — AI-generated architectural insight; null until --analyze has run
- recommendation: string | null — AI-generated recommendation; null until --analyze has run
- ea_action: string | null — EA-specific action; null until --analyze has run

Computation precision rules (enforced by --transform):
- Summations: `Math.round(val * 100)` per value, sum as integers, divide by 100
- Attainment %: `Math.round((actuals / target) * 1000) / 10`
- Reconciliation tolerances: `max(0.01, 0.001 * magnitude)` — proportional, not flat

---

## contract:risk-item
A risk entry in customer-portfolio-shape.risk_items[]. Each entry represents one product that triggered at least one business rule. Note: recommendation is not a field here — per-product recommendations are AI-generated fields on contract:product-in-subsa-shape.

Fields:
- product_id: string (LPR code)
- logical_product: string
- solution_area: string
- risk_level: "Critical" | "High" | "Medium" | "Low"
- risk_reason: string (human-readable description of the triggering rule)
- ytd_target: number
- months_remaining: integer
- urgency_score: number

---

## contract:dashboard-recommendation
The recommendation block rendered per at-risk product in the dashboard. Deterministically derived from contract:risk-item; not AI-generated.

Fields:
- product_id: string
- risk_level: string
- who_to_speak_to: string[] (e.g. ["CSM", "EA"])
- message_template: string (e.g. "Utilization gap detected — schedule enablement session")
- urgency: "immediate" | "this-month" | "this-quarter"
- suggested_actions: string[] (3–5 items)

---

## contract:field-mapper-contract
Input/output shape for `src/lib/fieldMapper.js`. Maps arbitrary CSV header names to canonical field names via alias table with AI fallback.

Input:
- headers: string[] — raw header strings from the CSV (may be 1-row canonical or 2-row legacy format)
- row: object — raw row keyed by original header strings

Output (mapped object):
- target: number — mapped from `cacv_target` alias or equivalent
- actuals: number — mapped from `cacv_actual` alias or equivalent
- solution_area: string
- sub_solution_area: string
- logical_product: string
- product_id: string
- month: string (YYYYMM)
- customer_raw: string | null — raw combined "Name (ID)" field; present in new-format CSVs (CACV_CROSS_FC_OPS_DIBO_REPORT); null if not in CSV
- delta_cacv: number | null — "Δ cACV to BUD" value; passed through for actuals fallback in transform.js

CANONICAL_FIELDS (8 total): solution_area, sub_solution_area, logical_product, product_id, month, cacv_target, cacv_actual, customer_raw

REQUIRED_FIELDS (4 — throw on missing): solution_area, logical_product, month, actuals
- All other canonical fields are optional; missing values mapped to null/0 rather than throwing

Behavior:
- Direct alias match: checked first (e.g. `cacv_target` → `target`)
- Fuzzy match: applied if no direct alias found
- AI fallback: invoked if fuzzy match score below threshold; returns best-guess canonical key
- Numbers stripped of comma formatting before returning

Note: downstream `transform.js` reads `mapped.target` / `mapped.actuals`; `metrics.js` receives the canonical `cacv-json-record` shape (with `cacv_target`/`cacv_actual`) for backwards compatibility.

---

## contract:reconciler-error
Error shape produced by `src/lib/reconciler.js` when a financial reconciliation check fails. Written to stderr and causes exit 2.

Fields:
- check_id: integer (1–7) — which of the 7 reconciliation checks failed
- check_name: string — human-readable name of the check
- product_id: string | null — product context if applicable
- expected: string | number — what the reconciler expected
- actual: string | number — what was found in the data
- message: string — `error: reconciliation check <n> failed — <description>`

Attainment field note: Check 5 reads `ytd_attainment_pct` from the product object (the actual field name); it also handles `attainment_pct` as a legacy alias for backwards compatibility.
