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

## contract:cacv-json-record
A single parsed row from the cACV CSV, as produced by --transform's CSV parser. This is the intermediate representation before metrics computation.

Fields:
- solution_area: string — top-level portfolio grouping (L1)
- sub_solution_area: string — second-level grouping (L2)
- logical_product: string — product name; populated via `pfhier_logical_product_desc` alias when that column is present in new-format PDFs (CACV_CROSS_FC_OPS_DIBO_REPORT); falls back to empty string when neither `logical_product` nor `pfhier_logical_product_desc` is present; downstream fieldMapper must treat empty string as unknown product name, not an error
- product_id: string — LPR product identifier code (e.g. "LPR868"); same code may appear in multiple rows with different sub_solution_areas or customer_ids
- customer_id: string | null — customer identifier parsed from combined "Name (ID)" field via parseCustomerRaw(); null in single-customer CSVs
- customer_raw: string | null — raw combined "Name (ID)" field as it appears in the CSV; null if not present
- month: string — YYYYMM format
- annual_contract_value: number — ACV actuals figure for this month (formerly ytd_acv_act)
- budget_contract_value: number — budgeted contract value; numeric value after stripping comma formatting (e.g. "1,234.56" → 1234.56); 0 if empty (formerly ytd_target / cacv_target)
- consumed_contract_value: number — actual consumption; 0 for future months; for FY2024/FY2025 historical rows: when both consumed and budget are empty and delta_cacv is positive, delta_cacv is used as actuals proxy (formerly ytd_actuals / cacv_actual)
- delta_cacv: number | null — value of "Δ cACV to BUD" column (col 7); retained in intermediate record for actuals fallback logic

Notes:
- The source CSV has a 2-row header; the parser must skip both header rows and derive column semantics by position or label matching — keys are flexible, not hardcoded
- Numbers in the CSV are comma-formatted (e.g. "1,234,567.89") — must be stripped before parseFloat
- New-format CSVs (CACV_CROSS_FC_OPS_DIBO_REPORT) have swapped 2-row header order; isCacvHeaderRow() and buildMergedHeader() handle both old and new formats

---

## contract:portfolio-json
The top-level JSON file written to disk by --transform and enriched in-place by --analyze. Read by --dashboard to generate the HTML output. Filename convention: `<source-basename>-portfolio.json` in `data/`.

Fields:
- generated_at: string (ISO 8601) — timestamp of when --transform ran
- reporting_month: string (YYYYMM) — latest month with non-zero actuals
- fiscal_year: string — e.g. "FY2026"
- customer_count: integer — number of distinct customers in the dataset
- industry_insights: contract:industry-insight-shape[] — one entry per distinct industry; populated by --analyze Step 4; empty array before --analyze runs
- customers: contract:customer-shape[] — one entry per distinct customer

---

## contract:industry-insight-shape
One industry-level insight block within contract:portfolio-json.industry_insights[].

Fields:
- industry: string — unique industry name (e.g. "Pharma/Life Sciences", "Manufacturing")
- summary: string[] — array of paragraph strings from --analyze Step 4 (opus model); empty array until --analyze has run
- aggregated_contracts: object — financial roll-up:
  - annual_contract_value: number
  - budget_contract_value: number
  - consumed_contract_value: number

---

## contract:customer-shape
One customer entry within contract:portfolio-json.customers[].

Fields:
- customer_id: string | null — parsed from combined "Name (ID)" field; null in single-customer CSVs
- customer: string — display name
- industry: string — inferred industry vertical; matches contract:industry-insight-shape.industry
- enterprise_architecture_insights: string[] — paragraph strings from --analyze Step 3 (sonnet); cross-domain EA patterns and actions for this customer; empty array until --analyze has run
- annual_contract_values: object — per-year full-year financial rollup across all L3 contracts for this customer (keyed by year string e.g. "2026"):
  - annual_annual_contract_value: number — sum of all months' ytd_annual_contract_value for that year across all L3 products (full-year ACV)
  - annual_budget_contract_value: number — sum of all months' ytd_budget_contract_value for that year across all L3 products (full-year budget)
- solutions_l1: contract:solutions-l1-shape[]

---

## contract:solutions-l1-shape
One L1 solution area entry within contract:customer-shape.solutions_l1[].

Fields:
- name: string — e.g. "Finance and Spend Management"
- solution_architecture_insights: string[] — paragraph strings from --analyze Step 2 (sonnet); functional architecture observations across all L2 areas in this L1 domain; empty array until --analyze has run
- solutions_l2: contract:solutions-l2-shape[]

---

## contract:solutions-l2-shape
One L2 grouping entry within contract:solutions-l1-shape.solutions_l2[].

Fields:
- name: string — e.g. "Procurement"
- solutions_l3: contract:solutions-l3-shape[]

---

## contract:solutions-l3-shape
One L3 product entry within contract:solutions-l2-shape.solutions_l3[]. Leaf level of the portfolio hierarchy.

Fields:
- lpr_id: string — LPR product code (e.g. "LPR868")
- lpr_name: string — logical product name (e.g. "Ariba Buying and Invoicing")
- contract: contract:contract-block-shape — the full contract data for this product

---

## contract:contract-block-shape
The contract data object nested inside contract:solutions-l3-shape.contract.

Fields:
- contract_insights: string[] — paragraph strings from --analyze Step 1 (sonnet); raw financial/consumption signal; empty array until --analyze has run
- [year]: contract:contract-month-shape[] — one key per fiscal year in the data (e.g. "2026"); value is an array of monthly records for that year

---

## contract:contract-month-shape
One month record within contract:contract-block-shape.[year][].

Fields:
- month: string — month name or abbreviation matching source CSV (e.g. "Jan", "Feb")
- ytd_annual_contract_value: number — ACV actuals YTD for this month
- ytd_budget_contract_value: number — budgeted YTD value for this month
- ytd_consumed_contract_value: number — actual YTD consumption for this month
- variances: object — computed variance metrics:
  - acv_gap: number — ytd_annual_contract_value - ytd_consumed_contract_value
  - budget_gap: number — ytd_budget_contract_value - ytd_consumed_contract_value
  - budget_attainment: number | null — (consumed / budget) * 100 as percentage; null if budget = 0

---

## contract:field-mapper-contract
Input/output shape for `src/lib/fieldMapper.js`. Maps arbitrary CSV header names to canonical field names via alias table with AI fallback.

Input:
- headers: string[] — raw header strings from the CSV (may be 1-row canonical or 2-row legacy format)
- row: object — raw row keyed by original header strings

Output (mapped object):
- annual_contract_value: number — mapped from ACV actuals column
- budget_contract_value: number — mapped from budget/target column
- consumed_contract_value: number — mapped from actuals/consumed column
- solution_area: string
- sub_solution_area: string
- logical_product: string
- product_id: string
- month: string (YYYYMM)
- customer_raw: string | null — raw combined "Name (ID)" field; present in new-format CSVs; null if not in CSV
- delta_cacv: number | null — "Δ cACV to BUD" value; passed through for actuals fallback in transform.js

CANONICAL_FIELDS (8 total): solution_area, sub_solution_area, logical_product, product_id, month, budget_contract_value, consumed_contract_value, customer_raw

REQUIRED_FIELDS (4 — throw on missing): solution_area, logical_product, month, consumed_contract_value
- All other canonical fields are optional; missing values mapped to null/0 rather than throwing

Behavior:
- Direct alias match: checked first (legacy names ytd_target, ytd_actuals, ytd_acv_act, cacv_target, cacv_actual are all recognised aliases)
- Fuzzy match: applied if no direct alias found
- AI fallback: invoked if fuzzy match score below threshold; returns best-guess canonical key
- Numbers stripped of comma formatting before returning

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

Note: reconciler reads budget_contract_value, consumed_contract_value, and budget_attainment from the contract_month shape; legacy field aliases (ytd_target, ytd_actuals, ytd_attainment_pct) are recognised for backwards compatibility.
