# Actors

## actor:operator
The sole user of the CLI tool — a SAP account team member (CSM, MU Lead, EA, or Executive) who installs and runs `consumption-analyzer` on their local machine to process cACV portfolio data. There is no authentication, no multi-user model, and no roles at the CLI level. All CLI capabilities are available to the operator unconditionally. The operator runs the full tool chain and shares the generated HTML dashboard with stakeholders.

owns:
- entity:pdf-input (places files in data/ and specifies them via CLI args)
- entity:csv-output (receives output files or stdout stream)
- entity:csv-input (places or produces CSV files in data/ for --transform)
- entity:tool-invocation (initiates every run)
- entity:portfolio (produced by --transform, enriched by --analyze, written to data/)

can:
- run `consumption-analyzer --pdf2csv <filename.pdf>` to convert a SAP cACV PDF to CSV
- run `consumption-analyzer --transform <filename.csv>` to produce the structured portfolio JSON (entity:portfolio with new metric names: annual_contract_value, budget_contract_value, consumed_contract_value, and variances)
- run `consumption-analyzer --analyze <portfolio.json>` to run the 5-step bottom-up AI pipeline and enrich the portfolio JSON in-place with AI insights at contract, L2, L1, customer, and industry levels
- run `consumption-analyzer --dashboard <portfolio.json>` to generate the self-contained 3-pane HTML dashboard
- run `consumption-analyzer --help` to view usage
- place PDF files in `data/` for processing
- place or produce CSV/JSON files in `data/` for further processing
- specify a custom input path via CLI arg
- configure behaviour via `.env` (DATA_DIR, LOG_LEVEL, PDF_MAX_PAGES, CSV_DELIMITER, AI_MODEL, AI_MODEL_SENIOR, AI_MAX_TOKENS, AI_API_KEY)
- run `deploy.sh` to install or reinstall the tool via npm link
- share the generated HTML dashboard file with stakeholders

cannot:
- invoke the tool as a web service or API (no server mode)
- process scanned/image-based PDFs (out of scope)
- use interactive prompts (all inputs must be supplied at invocation time)
- configure column mapping (out of scope)
- persist --analyze output to a separate file automatically (insights are written back into the portfolio JSON in-place)

---

## actor:stakeholder
A SAP account team member or executive stakeholder who receives and views the generated HTML dashboard. Not a CLI user — interacts only with the static HTML output opened in a browser. Any role (CSM, MU Lead, EA, Executive, Regional Head) may view the dashboard; there are no role-based tabs or access controls.

owns: nothing (read-only consumer of dashboard output)

can:
- view the 3-pane dashboard: left pane (industry list with aggregated contract values), middle pane (customer cards with account insights and L1 breakdown), right pane (L3 product detail with per-year monthly series and all AI insights)
- click an industry in the left pane to populate the middle pane
- click a customer card in the middle pane to populate the right pane
- expand/collapse EA insights on customer cards (enterprise_architecture_insights from Step 3)
- expand/collapse solution_architecture_insights per L2 grouping in the right pane
- expand/collapse contract-level ai_insights per L3 product in the right pane
- open the self-contained HTML file in any browser without an internet connection

cannot:
- edit data
- run the CLI
- filter or search (no filter controls in v1) # inferred
- switch between role-specific views (no role-based tabs in the new design)
