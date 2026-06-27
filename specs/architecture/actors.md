# Actors

## actor:operator
The sole user of the CLI tool — a SAP account team member (CSM, MU Lead, EA, or Executive) who installs and runs `consumption-analyzer` on their local machine to process cACV portfolio data. There is no authentication, no multi-user model, and no roles at the CLI level. All CLI capabilities are available to the operator unconditionally. The operator chooses which dashboard view to share with stakeholders.

owns:
- entity:pdf-input (places files in data/ and specifies them via CLI args)
- entity:csv-output (receives output files or stdout stream)
- entity:csv-input (places or produces CSV files in data/ for analysis)
- entity:analysis-result (receives AI analysis on stdout)
- entity:tool-invocation (initiates every run)
- entity:portfolio-snapshot (produced by --transform, written to data/)
- entity:recommendation (produced deterministically from risk classification)

can:
- run `consumption-analyzer --pdf2csv <filename.pdf>` to convert a SAP cACV PDF to CSV
- run `consumption-analyzer --analyze <filename.csv>` to receive a cACV-domain AI narrative
- run `consumption-analyzer --transform <filename.csv>` to produce structured portfolio JSON
- run `consumption-analyzer --dashboard <filename.json>` to generate a self-contained HTML dashboard
- run `consumption-analyzer --help` to view usage
- place PDF files in `data/` for processing
- place or produce CSV/JSON files in `data/` for further processing
- specify a custom input path via CLI arg
- configure behaviour via `.env` (DATA_DIR, LOG_LEVEL, PDF_MAX_PAGES, CSV_DELIMITER, AI_MODEL, AI_MAX_TOKENS, AI_API_KEY)
- run `deploy.sh` to install or reinstall the tool via npm link
- share the generated HTML dashboard file with stakeholders (Executive, MU Lead, CSM, EA)

cannot:
- invoke the tool as a web service or API (no server mode)
- process scanned/image-based PDFs (out of scope)
- use interactive prompts (all inputs must be supplied at invocation time)
- configure column mapping (out of scope)
- persist analysis results to disk automatically (--analyze output goes to stdout; operator pipes or redirects manually)

---

## actor:executive
A Regional Head or Executive stakeholder who receives and views the generated HTML dashboard file. Not a CLI user — interacts only with the static HTML output opened in a browser.

owns: nothing (read-only consumer of dashboard output)

can:
- view the Executive tab of the generated dashboard: portfolio-level KPIs, top 5 at-risk products by $ value, attainment heatmap by solution area × month, AI narrative paragraph
- open the self-contained HTML file in any browser without an internet connection

cannot:
- edit data
- view product-level detail (that is the CSM tab)
- run the CLI

---

## actor:mu-lead
A Market Unit Lead who views the MU Lead tab of the generated HTML dashboard. Not a CLI user.

owns: nothing (read-only consumer)

can:
- view solution-area breakdown, attainment by sub-solution area, trending products (up/down), run-rate vs target for full year, predictability score per area

cannot:
- edit data
- view individual product-level rows (that is the CSM tab)
- run the CLI

---

## actor:csm
A Customer Success Manager who views the CSM tab of the generated HTML dashboard. Not a CLI user.

owns: nothing (read-only consumer)

can:
- view the product-level table filterable by solution area: product, YTD target, YTD actuals, attainment %, risk level (color-coded), trend arrow, recommended action
- filter the product table by solution area

cannot:
- edit data
- run the CLI

---

## actor:ea
An Enterprise Architect who views the EA tab of the generated HTML dashboard. Not a CLI user.

owns: nothing (read-only consumer)

can:
- view technical consumption patterns: products with zero utilization months, products exceeding target (potential expansion), products with high variance

cannot:
- edit data
- run the CLI
