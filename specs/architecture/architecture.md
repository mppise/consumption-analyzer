# Architecture

## Vision
A collection of CLI tools for analyzing data files placed in a data directory. The first tool is a PDF-to-CSV converter that extracts tabular data from PDF files into clean CSV format, runnable as an executable command-line utility built in Node.js.

## Problem & Users
Users are developers and data analysts who receive PDF reports or documents containing embedded tables and need to extract those tables into machine-readable CSV for further processing. The primary use case is: receive a PDF, run one command, get a CSV — no manual copy-paste, no browser-based tools. Current workaround is manual selection-and-paste from a PDF viewer or uploading to a third-party conversion site, both of which are slow, lossy, and not scriptable. Good enough for v1: the tool detects whether a PDF contains tabular data, extracts the first (or all) tables into valid CSV, and exits with a clear error message when no tables are found. It is usable in a shell script pipeline.

## Constraints
- Language: Node.js is the primary implementation language. Python is permitted only if a Node.js PDF parsing library cannot reliably extract tabular data — this must be a demonstrated hard limitation, not a preference.
- Runtime: must run as an executable CLI command (i.e. via a shebang or `node` invocation — no web server, no GUI, no daemon).
- Data directory: input files are expected in a `data/` directory relative to the project root; output CSV is written to `data/` as well (or stdout — to be decided at story-spec time).
- No external services: all processing is local. No API calls to PDF conversion services.
- Extensibility: architecture must support adding more CLI tools later without restructuring the project. Each tool is a separate command entry point.
- No database required for v1: tools operate on flat files only.

## Risks & Out of Scope

### Risks
1. **PDF table extraction fidelity** — Node.js PDF libraries infer table structure from text coordinates; this breaks on merged cells, multi-line headers, rotated text, or image-embedded content. Mitigation: evaluate at least two libraries (e.g. pdfreader, pdf-parse) against real sample files before committing; fall back to Python (camelot/tabula-py) only if Node.js cannot handle the actual file corpus.
2. **Extensibility drift** — adding future CLI tools ad-hoc can erode the shared entry-point pattern. Mitigation: enforce a single `src/tools/` directory convention from day one; each tool is a module, the root CLI dispatches to it.

### Out of Scope for v1
- Scanned or image-based PDFs (requires OCR)
- Multi-sheet / multi-table output with named sheets
- Column mapping configuration files
- GUI or web wrapper
- Any non-PDF input formats

## Tech Stack
- Runtime: Node.js 20 LTS
- Language: JavaScript (ESM modules)
- PDF parsing: pdfreader — coordinate-based text extraction for tabular reconstruction
- CSV output: csv-stringify (csv-parse ecosystem)
- CLI framework: commander — single entry point `consumption-analyzer`, features as `--flag <arg>` options (e.g. `consumption-analyzer --pdf2csv <filename.pdf>`)
- Test runner: Node.js built-in (node:test)
- Package manager: npm

## Guardrails

**Mandatory project structure:**
- Source code under `/src/` with subdirs: `tools/`, `lib/`, `utilities/`, `config/`
- Each feature flag maps to one module: `/src/tools/pdf2csv.js`, `/src/tools/[next-tool].js`, etc.
- Root CLI entry point: `/src/cli.js` — imports commander, delegates to tool modules
- AI/LLM prompts (if ever added) as `.md` files under `/src/ai/`
- Build output to `/dist/` if a build step is added later
- Input/output files under `/data/` — treated as a writable volume (gitignored except for sample fixtures)
- Secrets in `/src/.env` — never hardcoded

**Project-specific rules:**
- Every feature must be reachable as `consumption-analyzer --<flag> <arg>`; a positional `consumption-analyzer <file>` pipeline entrypoint is also permitted as a convenience alias that orchestrates existing flags — it is not a positional-only command
- A feature module must export a single function `run(args, options)` and nothing else — the CLI wires it up
- Exit codes: `0` on success, `1` on user error (bad args, file not found), `2` on processing failure (no tables found, corrupt PDF)
- All output goes to stdout by default; all errors and warnings go to stderr — never mix them
- No hardcoded file paths — input/output paths come from CLI args or the `data/` convention
- ESM only: `"type": "module"` in package.json; no `require()`

## Configuration

| Variable        | Description                                          | Example value             |
|-----------------|------------------------------------------------------|---------------------------|
| DATA_DIR        | Path to input/output data directory                  | ./data                    |
| LOG_LEVEL       | Logging verbosity (silent/info/debug)                | info                      |
| PDF_MAX_PAGES   | Max pages to process per file (0 = all)              | 0                         |
| CSV_DELIMITER   | Output CSV field delimiter                           | ,                         |
| AI_MODEL        | Model ID for Steps 1–3 of --analyze (sonnet)         | claude-sonnet-4-5          |
| AI_MODEL_SENIOR | Model ID for Steps 4–5 of --analyze (opus)           | claude-opus-4-5            |
| AI_MAX_TOKENS   | Max tokens per AI response                           | 8192                      |
| AI_API_KEY      | Anthropic API key                                    | sk-ant-...                |
| AI_BASE_URL     | Custom AI API base URL (empty = Anthropic default)   | http://localhost:6655     |

## UX Model
Navigation: flag-driven single command (CLI) — no browser navigation model for the CLI itself.
Generated HTML dashboard: 3-pane single merged view. Navigation pattern: left-drives-right — industry selection (left pane) drives customer cards (middle pane); customer selection drives L3 product detail (right pane). No role-based tabs — single unified view for all stakeholder audiences.
Visual: Bootstrap 5 + Bootstrap Icons (inlined in generated HTML) · vanilla JS · semantic color constants (C_ACV grey / C_BUDGET green / C_CONSUMED orange / C_PCT blue)
CLI: terminal output only — no CSS framework, no color by default

---

## Amendment — 2026-06-26: Major scope clarification — cACV domain, --transform, --dashboard

### Changes to Vision
The system's domain is fully clarified: input files contain budgeted and actual Consumed Annual Contract Value (cACV) for a customer's SAP software portfolio. The tool chain is: PDF → CSV (--pdf2csv) → structured JSON (--transform) → AI narrative (--analyze) → self-contained HTML dashboard (--dashboard). The operator is a SAP account team member (CSM, MU Lead, EA, or Executive) who needs portfolio-level consumption health visibility.

### Changes to Problem & Users
Users are SAP account team members who receive cACV portfolio reports as PDFs and need to assess consumption health across solution areas, sub-solution areas, and individual products. The primary use case expands from "extract a table" to "produce a shareable, action-oriented dashboard from a PDF in one tool chain." Four distinct dashboard audiences are now modelled: Executive/Regional Head, MU Lead, CSM, and EA — each with their own view and data needs.

### Changes to Tech Stack
Added: Chart.js (inlined in generated HTML for dashboard charts). The --analyze tool now explicitly uses `anthropic--claude-sonnet-latest` (more capable reasoning model) rather than a generic haiku placeholder. The --transform tool performs all metric computations in Node.js — no AI involved.

### Changes to Configuration
AI_MODEL default updated to `anthropic--claude-sonnet-latest`. No new env vars required — --transform and --dashboard operate on local files only.

### Changes to Guardrails
The `/src/ai/` directory is now actively used for two prompt templates: `analyze.md` (cACV-domain-aware narrative) and any future templates. The --transform and --dashboard tools are purely local — no API calls, no env var requirements beyond DATA_DIR and LOG_LEVEL.

### Changes to Constraints
The "no external services" constraint is narrowed to STORY-001, STORY-002, STORY-004, and STORY-005. STORY-003 (--analyze) requires Anthropic API access. No new external services are introduced.

### Superseded decisions
- STORY-002 scope superseded: rewritten to target the specific 2-row header, comma-formatted number CSV structure produced from SAP cACV PDFs.
- STORY-003 scope superseded: rewritten to produce a cACV-domain-aware narrative using `anthropic--claude-sonnet-latest`; prompt template is domain-specific, not general-purpose.

### New stories
- STORY-004: CSV to JSON transformation (--transform) — parse cACV CSV into structured JSON with all metrics computed in Node.js (attainment %, gap, YTD, run-rate, predictability, risk classification per business rules). Depends on STORY-001.
- STORY-005: HTML dashboard generation (--dashboard) — consume the JSON produced by --transform, generate a self-contained single-file HTML dashboard with Bootstrap CSS + Chart.js inlined, role-based tabs (Executive, MU Lead, CSM, EA), zero external dependencies, fully portable. Depends on STORY-004.

---

## Amendment — 2026-06-25: STORY-003 AI-powered CSV analysis (--analyze)

### Changes to Tech Stack
Added: `@anthropic-ai/sdk` — Anthropic Node.js SDK for LLM API calls from the --analyze tool.

### Changes to Configuration
Added three new env vars: `AI_MODEL`, `AI_MAX_TOKENS`, `AI_API_KEY` — required for the --analyze tool. These are secrets/config that must be present in `.env` before the new story can be used.

### Changes to Guardrails
The `/src/ai/` directory for AI prompt templates is now actively used (previously noted as "if ever added"). Prompt templates are `.md` files with `{{placeholder}}` syntax — no inline prompt strings in source code.

### Changes to Constraints
Superseded decision: "No external services — all processing is local." STORY-003 adds an Anthropic API call. This constraint now applies only to STORY-001 and STORY-002 (PDF/CSV processing remains fully local). The --analyze tool requires network access and a valid AI_API_KEY.

### New story
STORY-003: AI-powered CSV analysis (--analyze) — depends on STORY-001.

---

## Amendment — 2026-06-27: portfolio.json hierarchy restructure, AI pipeline 3-level, industry inference

### Changes to UX Model
The dashboard view separation is now data-hierarchy-aware:
- **Executive / Regional Head view** — consumes customer.summary + customer.solution_areas at SA-level attainment only. No product detail rendered. Produces a high-level roll-up: per-customer overall attainment, SA-level attainment bars, risk summary count. Source: contract:customer-portfolio-shape.summary + contract:solution-area-shape (name, ytd_target, ytd_actuals, attainment_pct only).
- **EA view** — consumes full nested hierarchy: customer → solution_areas → sub_solution_areas → products. Each product card exposes insight, recommendation, and ea_action (AI-populated fields). Product detail is only visible after --analyze has been run (null fields collapse gracefully). Source: contract:product-in-subsa-shape.
- **MU Lead / CSM views** — consume customer.risk_items[] for triage and action lists; also consume SA-level attainment from solution_areas[]. Product detail shown only for flagged risk items.

### Changes to AI Pipeline
The --analyze tool now operates on three distinct levels:
1. **Sub-SA level (haiku model)** — processes each sub-solution-area in isolation; produces narrative context used as input to the product-level pass
2. **Product level (haiku model, via sub-SA response)** — populates product.insight, product.recommendation, and product.ea_action for every product in the sub-SA; written back into the portfolio JSON at the product leaf
3. **Portfolio level (opus model)** — consumes the full enriched portfolio; produces ai_insights.executive_view and ai_insights.pulse_narrative

### Changes to Data Model
Products moved from customer root to sub_solution_areas[].products[]. The flat products[] array and overperforming_products[] at portfolio root are removed. The new hierarchy is: portfolio → customers[] → solution_areas[] → sub_solution_areas[] → products[]. See entity:portfolio-json, entity:customer-portfolio, entity:solution-area, entity:sub-solution-area, entity:product-metrics for full field definitions. industry field added to portfolio root (populated by STORY-006).

### New story
STORY-006: Industry vertical inference (--transform or inference pass) — infers industry vertical from customer name + product portfolio fingerprint. Deterministic (no AI). Depends on STORY-004.

### Superseded decisions
- contract:portfolio-json root-level products[], solution_areas[], at_risk_products[], overperforming_products[], ai_narrative, ai_config fields are removed. Superseded by customer-centric hierarchy.
- contract:product-metrics-shape superseded by contract:product-in-subsa-shape.
- entity:portfolio-snapshot superseded by entity:portfolio-json (new customer-centric structure).

---

## Amendment — 2026-06-28: Clean-slate rewrite — new portfolio.json schema, 5-step AI pipeline, 3-pane dashboard

### Changes to Vision
The system now produces a single unified HTML dashboard (replacing separate executive/EA tab views) with a 3-pane left-drives-right navigation: industry list → customer cards → L3 product detail. The AI pipeline is rewritten as a 5-step bottom-up flow (contract → L2 → L1 → customer → industry), with Steps 1–3 using sonnet and Steps 4–5 using opus.

### Changes to Data Model
The portfolio.json schema is completely restructured. New entity names replacing prior hierarchy: `portfolio` (top-level), `industry_insight` (cross-customer industry narrative), `customer` (per-customer with account_insights), `solutions_l1` (with enterprise_architecture_insights), `solutions_l2` (grouping layer), `solutions_l3` (leaf product with solution_architecture_insights and contract block), `contract` (per-product, with ai_insights and year-keyed month arrays), `contract_month` (new canonical financial record). Metric renames applied throughout: ytd_target → budget_contract_value, ytd_actuals → consumed_contract_value, ytd_acv_act → annual_contract_value. Variances (acv_gap, budget_gap, budget_attainment) are computed fields on each contract_month.

### Changes to AI Pipeline
The 3-level pipeline (sub-SA / product / portfolio) is replaced by a 5-step bottom-up pipeline: Step 1 (contract ai_insights, sonnet), Step 2 (solution_architecture_insights per L2, sonnet), Step 3 (enterprise_architecture_insights per L1, sonnet), Step 4 (account_insights per customer, opus), Step 5 (industry_insights summary, opus). All existing prompt template files (analyze.md, analyze-sa.md) are replaced. The sole product knowledge source is src/ai/sap-product-catalog.json.

### Changes to UX Model
The separate Executive/EA/MU-Lead/CSM tab views are replaced by a single 3-pane unified dashboard. No role-based tabs. Navigation is left-drives-right: industry selection populates middle pane, customer selection populates right pane. Color constants renamed: C_CACV → C_CONSUMED, C_TARGET → C_BUDGET; C_ACV and C_PCT unchanged. Language standards updated: "consumed" replaces "cACV actuals", "budget" replaces "target/YTD target".

### Changes to Actors
actor:executive, actor:mu-lead, actor:csm, actor:ea consolidated into a single actor:stakeholder (all roles view the same unified 3-pane dashboard; no role-based access control). actor:operator updated to reflect new --analyze flag behavior (in-place portfolio enrichment, not stdout).

### Changes to Configuration
AI_MODEL_SENIOR added for Steps 4–5 (opus model). AI_BASE_URL retained. All other vars unchanged.

### Superseded decisions
- 3-level AI pipeline (sub-SA / product / portfolio) superseded by 5-step bottom-up pipeline
- Role-based tab dashboard (Executive / EA / MU Lead / CSM tabs) superseded by 3-pane single merged view
- Old metric names ytd_target, ytd_actuals, ytd_acv_act superseded by budget_contract_value, consumed_contract_value, annual_contract_value throughout all artifacts
- entities portfolio-json, customer-portfolio, solution-area, sub-solution-area, product-metrics, risk-classification, recommendation superseded by new entity names
- actor:executive, actor:mu-lead, actor:csm, actor:ea superseded by actor:stakeholder

---

## Artifact Index

```yaml
data-model:
  file: specs/architecture/data-model.md
  entities: [pdf-input, csv-output, csv-input, tool-invocation, portfolio, industry_insight, customer, solutions_l1, solutions_l2, solutions_l3, contract, contract_month]

actors:
  file: specs/architecture/actors.md
  roles: [operator, stakeholder]

contracts:
  file: specs/architecture/contracts.md
  shapes: [error-envelope, warn-envelope, csv-row, tool-module, cacv-json-record, portfolio-json, industry-insight-shape, customer-shape, solutions-l1-shape, solutions-l2-shape, solutions-l3-shape, contract-block-shape, contract-month-shape, field-mapper-contract, reconciler-error]

patterns:
  file: specs/architecture/patterns.md
  patterns: [cli-dispatch, stream-to-stdout, env-config, exit-code-contract, bottom-up-ai-pipeline, metrics-computation, risk-classification-engine, html-generation]

ux:
  file: specs/architecture/ux.md
  sections: [navigation-model, visual-system, component-conventions, screen-template]

deployment:
  file: specs/architecture/deployment.md
  sections: [target, services, secrets, ingress, cicd]
```
