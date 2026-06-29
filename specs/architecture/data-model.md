# Data Model

## entity:pdf-input
A PDF file placed in the `data/` directory (or specified via CLI arg) that is the subject of a conversion operation.

Fields:
- path: string, required — absolute or relative filesystem path to the PDF file
- filename: string, required — basename of the file (e.g. `report.pdf`)
- page_count: integer, optional — total pages in the PDF; populated after file is opened # inferred
- tables_found: integer, optional — number of tables detected during extraction # inferred

State machine: none (read-only input artifact; no lifecycle)

owned-by: actor:operator

---

## entity:csv-output
A CSV file produced by the pdf2csv tool, written to `data/` or stdout.

Fields:
- path: string, optional — filesystem path if written to disk; null if output to stdout
- filename: string, optional — derived from input filename (e.g. `report.csv`)
- row_count: integer, optional — number of data rows written # inferred
- delimiter: string, required — field delimiter character, sourced from `CSV_DELIMITER` env var (default `,`)
- source_pdf: string, required — FK reference to entity:pdf-input.path

State machine: none (write-once output artifact; no lifecycle)

owned-by: actor:operator

---

## entity:csv-input
A CSV file placed in the `data/` directory (or specified via CLI arg) that is the subject of a --transform or --analyze operation.

Fields:
- path: string, required — absolute or relative filesystem path to the CSV file
- filename: string, required — basename of the file (e.g. `report.csv`)
- row_count: integer, optional — number of data rows (excluding header); populated after file is read # inferred
- column_count: integer, optional — number of columns detected from the header row # inferred

State machine: none (read-only input artifact; no lifecycle)

owned-by: actor:operator

---

## entity:tool-invocation
A single execution of `consumption-analyzer` with a given flag and arguments. Represents one run of the CLI.

Fields:
- flag: string, required — the feature flag used (e.g. `--pdf2csv`, `--transform`, `--analyze`, `--dashboard`)
- args: string[], required — positional arguments passed after the flag
- exit_code: integer, required — 0 (success), 1 (user error), 2 (processing failure)
- error_message: string, optional — human-readable error written to stderr on non-zero exit
- timestamp: datetime, optional # inferred

State machine:
- invoked → success (exit 0)
- invoked → user-error (exit 1)
- invoked → processing-failure (exit 2)

owned-by: actor:operator

---

## entity:portfolio
The top-level JSON file written to disk by `--transform` (base structure) and enriched in-place by `--analyze` (AI insight fields). Read by `--dashboard` to generate the HTML output. Filename convention: `<source-basename>-portfolio.json` in `data/`.

Fields:
- generated_at: string, required — ISO 8601 timestamp of when --transform ran
- reporting_month: string, required — latest month with non-zero actuals (YYYYMM)
- fiscal_year: string, required — e.g. "FY2026"
- customer_count: integer, required — number of distinct customers in the dataset
- industry_insights: entity:industry_insight[], required — one entry per distinct industry identified across all customers; populated by --analyze Step 4
- customers: entity:customer[], required — one entry per distinct customer

State machine:
- produced (--transform writes base structure; AI fields are null)
- enriched (--analyze populates all AI insight fields in-place)

owned-by: actor:operator

---

## entity:industry_insight
One industry-level insight block within entity:portfolio.industry_insights[]. Produced by --analyze Step 4 (opus model). Groups all customers in a given industry and provides a cross-customer narrative.

Fields:
- industry: string, required — unique industry name inferred from the customer list (e.g. "Pharma/Life Sciences", "Manufacturing", "Healthcare")
- summary: string[], required — array of paragraph strings; cross-customer industry narrative and action items written by Step 4 (opus); empty array until --analyze has run

owned-by: actor:operator

---

## entity:customer
One customer's full portfolio entry within entity:portfolio.customers[]. Contains account-level AI insights plus the full nested solution hierarchy.

Fields:
- customer_id: string, required — parsed from combined "Name (ID)" field via parseCustomerRaw(); null in single-customer CSVs
- customer: string, required — display name parsed from the same combined field
- industry: string, required — determined by STORY-006 industry inference; matches entity:industry_insight.industry
- enterprise_architecture_insights: string[], required — array of paragraph strings; cross-domain EA patterns, integration dependencies, and strategic actions written by --analyze Step 3 (sonnet); empty array until --analyze has run
- enterprise_architecture_diagram: string, required — Mermaid or SVG diagram string produced by --analyze Step 3 (sonnet); empty string ("") until --analyze has run; STORY-003 populates this field; STORY-005 reads and renders it in the dashboard
- solutions_l1: entity:solutions_l1[], required — top-level solution area groupings for this customer

owned-by: actor:operator

---

## entity:solutions_l1
One L1 solution area within entity:customer.solutions_l1[]. Corresponds to a top-level SAP solution grouping (e.g. "Finance and Spend Management").

Fields:
- name: string, required — e.g. "Finance and Spend Management"
- solution_architecture_insights: string[], required — array of paragraph strings; functional architecture observations across all L2/L3 areas in this L1 domain written by --analyze Step 2 (sonnet); empty array until --analyze has run
- solutions_l2: entity:solutions_l2[], required

owned-by: actor:operator

---

## entity:solutions_l2
One L2 grouping within entity:solutions_l1.solutions_l2[]. Corresponds to a sub-solution area (e.g. "Procurement").

Fields:
- name: string, required — e.g. "Procurement"
- solutions_l3: entity:solutions_l3[], required

owned-by: actor:operator

---

## entity:solutions_l3
One L3 product entry within entity:solutions_l2.solutions_l3[]. This is the leaf level of the hierarchy — individual LPR products with their contract data.

Fields:
- lpr_id: string, required — LPR product code (e.g. "LPR868"); canonical product identifier
- lpr_name: string, required — logical product name (e.g. "Ariba Buying and Invoicing")
- contract: entity:contract, required — the contract data block for this product

owned-by: actor:operator

---

## entity:contract
The contract data block for one entity:solutions_l3 product. Contains per-year monthly series and AI-generated financial signal insights.

Fields:
- contract_insights: string[], required — array of paragraph strings; raw financial/consumption signal written by --analyze Step 1 (sonnet); empty array until --analyze has run
- [year]: entity:contract_month[], required — one key per fiscal year present in the data (e.g. "2026"); value is an array of monthly records for that year

owned-by: actor:operator

---

## entity:contract_month
One month's contract record within entity:contract.[year][]. The fundamental unit of financial data.

Fields:
- month: string, required — month name or abbreviation (e.g. "Jan", "Feb") matching source CSV
- ytd_annual_contract_value: number, required — ACV actuals figure YTD for this month
- ytd_budget_contract_value: number, required — budgeted YTD contract value for this month
- ytd_consumed_contract_value: number, required — actual YTD consumption for this month
- projected_annual_budget_contract_value: number, required — sum of ytd_budget_contract_value across ALL 12 months of this L3+year; stamped on every month record at transform time
- projected_annual_consumed_contract_value: number, required — sum of ytd_consumed_contract_value across ALL 12 months of this L3+year; stamped on every month record at transform time
- projected_annual_acv_gap: number, required — ytd_annual_contract_value − projected_annual_consumed_contract_value
- projected_annual_budget_gap: number, required — projected_annual_budget_contract_value − projected_annual_consumed_contract_value
- projected_annual_budget_attainment: number, required — (projected_annual_consumed / projected_annual_budget) × 100; 0 if budget = 0
- variances: object, required — YTD computed variance metrics:
  - ytd_acv_gap: number — ytd_annual_contract_value - ytd_consumed_contract_value
  - ytd_budget_gap: number — ytd_budget_contract_value - ytd_consumed_contract_value
  - ytd_budget_attainment: number | null — (ytd_consumed / ytd_budget) * 100 as a percentage; null if ytd_budget = 0

Computation precision rules (enforced by --transform):
- All summations use integer-safe arithmetic: Math.round(val * 100) per value, sum as integers, divide by 100
- ytd_budget_attainment: Math.round((consumed / budget) * 1000) / 10 (1 decimal precision; null if budget = 0)
- projected_annual_budget_attainment: Math.round((consumed / budget) * 1000) / 10 (1 decimal precision; 0 if budget = 0)
- projected annual fields: stamped once per L3+year on every month record for that combination

State machine: none (read-only computed record per --transform run)

owned-by: actor:operator
