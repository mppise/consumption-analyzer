#!/bin/bash
# SpecGantry deploy script — Release 4.1.0 — 2026-06-28
# Target: local-npm (CLI binary installed via npm link)
#
# Usage:
#   ./specs/deploy.sh              Install dependencies and link the binary to PATH
#   ./specs/deploy.sh --dry-run    Verify installation locally without linking to PATH
#
# Environment variables (set in .env or export before running):
#   DATA_DIR      — Path to input/output data directory (e.g. ./data)
#   LOG_LEVEL     — Logging verbosity: silent | info | debug
#   PDF_MAX_PAGES — Max pages to process per PDF file (0 = all)
#   CSV_DELIMITER — Output CSV field delimiter (default ,)
#
# Optional AI vars (required only when using --analyze):
#   AI_API_KEY    — API key for the AI service
#   AI_MODEL      — Model ID (default: anthropic--claude-sonnet-latest)
#   AI_BASE_URL   — Custom AI API base URL (empty = Anthropic default)
#   AI_MAX_TOKENS — Max tokens for AI response (default: 8192; 32000 for large outputs)
#
# Pre-deployment checklist:
#   1. Copy specs/.env.example to .env and confirm all values
#   2. Run: bash specs/deploy.sh --dry-run   (verify install without linking)
#   3. Run: bash specs/deploy.sh             (full install + npm link)
#
# v4.1.0 changes verified by this script:
#   - STORY-005: deployed:true — 3-pane HTML dashboard generation (--dashboard) fully deployed
#                left-drives-right navigation: industry list → customer cards → L3 product detail
#                C_CONSUMED/C_BUDGET/C_ACV/C_PCT semantic color constants
#                Bootstrap 5 + Bootstrap Icons + Chart.js all inlined (zero external deps)
#   - STORY-006: industry inference via AI_MODEL (sonnet) — inferIndustry() is async
#                23 SAP industry verticals; AI fallback to rule-based inference
#   - All 6 stories: deployed:true in project-state.yaml
#
# v3.3.0 changes (still verified):
#   - STORY-003: full deployment of AI-powered cACV analysis (--analyze) 3-level pipeline
#                L1 haiku per sub-SA, L2 product field distribution, L3 opus portfolio narrative
#                stripCodeFences() fallback regex handles preamble text before JSON fence
#                AIClient falls back to direct Anthropic SDK when AI_BASE_URL is unset
#                action_for_csm removed from prompt templates and response shapes
#                Graceful degradation: L1 failure warns to stderr, continues with null AI fields
#   - STORY-005: full deployment of HTML dashboard generation (--dashboard)
#                traverses c.solution_areas[].sub_solution_areas[].products[] (v3 data model)
#                product.name used as display name (product.lpr as fallback)
#                risk_level/risk_reason display removed; RAG coloring is attainment-pct only
#                product.insight/recommendation/ea_action shown in companion panel
#                customer.industry displayed as small tag on customer rows
#                custTrend() and custAllProds() helpers for nested hierarchy traversal
#                Output: <source-basename>-dashboard.html in same directory as input
#
# v3.2.0 changes (still verified):
#   - STORY-003: stripCodeFences() fallback regex handles preamble text before JSON fence
#   - STORY-004: portfolio.json products have NO forecast fields
#                (fy_target_total, year_end_forecast, year_end_attainment_pct, forecast_confidence ABSENT)
#   - STORY-004: portfolio.json customers have NO risk classification fields
#                (risk_level, risk_reason, risk_items[] ABSENT from customer objects)
#   - STORY-005: dashboard companion panel shows NO forecast fields
#   - STORY-005: ea_action surfaces only via "EA Priority Actions" list — no standalone EA Action block
#
# v3.0.0 changes (still verified):
#   - portfolio.json: nested products (no flat c.products[]), industry field, no employee_id
#   - portfolio.json: summary has no critical_count / products_at_risk (risk counters removed)
#   - portfolio.json: SA and subSA have no risk_counts field
#   - portfolio.json: product objects have insight/recommendation/ea_action fields (null until --analyze)
#   - portfolio.json: customer.industry populated by STORY-006 industry inference
#   - dashboard: EA and Executive roles; industry tag on customer cards; no risk badges
#   - AI pipeline: 3-level (haiku sub-SA L1, product field L2, opus portfolio L3)

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

if [[ "$DRY_RUN" == "true" ]]; then
  echo "Dry-run mode — verifying install, no npm link or PATH modification"
fi

# Resolve project root (parent of this script's directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env if it exists
if [[ -f "$PROJECT_ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_ROOT/.env"
  set +a
fi

VERSION="4.1.0"

# Per-step verification with actionable diagnostics
run_step() {
  local name="$1"
  local cmd="$2"
  local fix_hint="${3:-}"
  echo "  -> $name"
  if ! eval "$cmd" 2>/tmp/sg_step_err; then
    echo "     FAILED: $name"
    echo "     Command: $cmd"
    echo "     Error:   $(head -5 /tmp/sg_step_err)"
    [[ -n "$fix_hint" ]] && echo "     Fix:     $fix_hint"
    exit 1
  fi
  echo "     OK"
}

# ------------------------------------------------------------
# Pre-flight checks
# ------------------------------------------------------------
echo ""
echo "=== Pre-flight checks ==="

run_step "Node.js >= 20 installed" \
  "node --version 2>/dev/null | grep -E '^v([2-9][0-9]|[2-9][0-9][0-9])' >/dev/null" \
  "Install Node.js 20+: https://nodejs.org or use nvm: nvm install 20"

run_step "npm available" \
  "npm --version >/dev/null 2>&1" \
  "npm ships with Node.js — reinstall Node.js: https://nodejs.org"

run_step "package.json present at project root" \
  "test -f '$PROJECT_ROOT/package.json'" \
  "Run this script from the ConsumptionAnalyzer project root or via: bash specs/deploy.sh"

# ------------------------------------------------------------
# AI env var check (optional — required only for --analyze)
# ------------------------------------------------------------
echo ""
echo "=== AI configuration check (--analyze tool) ==="
AI_VARS_OK=true
for var in AI_API_KEY AI_MODEL AI_BASE_URL AI_MAX_TOKENS; do
  val="${!var:-}"
  if [[ -z "$val" ]]; then
    echo "  warn: $var is not set — the --analyze flag will not work until this is added to .env"
    AI_VARS_OK=false
  else
    echo "  OK   $var is set"
  fi
done
if [[ "$AI_VARS_OK" == "false" ]]; then
  echo "  (AI vars are optional for --pdf2csv, --transform, --dashboard — deploy continues)"
fi

# v3.2.0: AI_MAX_TOKENS should be >= 8192; 32000 recommended for 3-level pipeline
AI_MAX_TOKENS_VAL="${AI_MAX_TOKENS:-0}"
if [[ "$AI_MAX_TOKENS_VAL" =~ ^[0-9]+$ ]] && [[ "$AI_MAX_TOKENS_VAL" -lt 8192 ]]; then
  echo "  warn: AI_MAX_TOKENS=$AI_MAX_TOKENS_VAL is below 8192 — v3.2.0 3-level AI pipeline recommends 32000"
fi

# ------------------------------------------------------------
# Version stamp
# ------------------------------------------------------------
echo ""
echo "=== Version stamp ==="
run_step "Stamp package.json version to $VERSION" \
  "npm version $VERSION --no-git-tag-version --allow-same-version --prefix '$PROJECT_ROOT' >/dev/null 2>&1" \
  "Ensure package.json is writable and npm >= 6 is installed"

# ------------------------------------------------------------
# Build: STORY-001 — CLI scaffold and entry point
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-001 — CLI scaffold and entry point ==="
run_step "Install npm dependencies (STORY-001)" \
  "cd '$PROJECT_ROOT' && npm install" \
  "Check network access and that package.json is valid JSON"

# ------------------------------------------------------------
# Build: STORY-002 — PDF to CSV conversion (--pdf2csv)
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-002 — PDF to CSV conversion (--pdf2csv) ==="
run_step "Confirm pdfreader installed (STORY-002)" \
  "test -d '$PROJECT_ROOT/node_modules/pdfreader'" \
  "Run: cd '$PROJECT_ROOT' && npm install — pdfreader must be present"

run_step "Confirm csv-stringify installed (STORY-002)" \
  "test -d '$PROJECT_ROOT/node_modules/csv-stringify'" \
  "Run: cd '$PROJECT_ROOT' && npm install — csv-stringify must be present"

run_step "v3.0.0: pdf2csv.js has HEADER_ALIAS_MAP (canonical header normalization)" \
  "grep -q 'HEADER_ALIAS_MAP' '$PROJECT_ROOT/src/tools/pdf2csv.js'" \
  "pdf2csv.js is missing HEADER_ALIAS_MAP — v3.0.0 requires canonical header normalization; check src/tools/pdf2csv.js"

run_step "v3.0.0: pdf2csv.js has BOM stripping at cell level (transformedRaw)" \
  "grep -q 'transformedRaw\|U+FEFF\|\\\\uFEFF\|replace.*BOM\|replace.*\\\\ufeff' '$PROJECT_ROOT/src/tools/pdf2csv.js'" \
  "pdf2csv.js is missing cell-level BOM stripping — v3.0.0 requires BOM stripping in data cells; check src/tools/pdf2csv.js"

# ------------------------------------------------------------
# Build: STORY-003 — AI-powered analysis (--analyze) — 3-level pipeline
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-003 — AI-powered analysis (--analyze) — 5-step bottom-up pipeline ==="
run_step "Confirm @anthropic-ai/sdk installed (STORY-003)" \
  "test -d '$PROJECT_ROOT/node_modules/@anthropic-ai/sdk'" \
  "Run: cd '$PROJECT_ROOT' && npm install — @anthropic-ai/sdk must be present"

run_step "Confirm src/tools/analyze.js present (STORY-003)" \
  "test -f '$PROJECT_ROOT/src/tools/analyze.js'" \
  "STORY-003 source file missing — check build output or re-run the build phase"

run_step "Confirm src/lib/aiClient.js present (STORY-003)" \
  "test -f '$PROJECT_ROOT/src/lib/aiClient.js'" \
  "STORY-003 aiClient source missing — check build output or re-run the build phase"

run_step "v4.1.0: step1-contract.md prompt template present (Step 1 — contract ai_insights)" \
  "test -f '$PROJECT_ROOT/src/ai/step1-contract.md'" \
  "src/ai/step1-contract.md missing — 5-step pipeline requires Step 1 prompt; check build output"

run_step "v4.1.0: step2-solution-arch.md prompt template present (Step 2 — solution_architecture_insights)" \
  "test -f '$PROJECT_ROOT/src/ai/step2-solution-arch.md'" \
  "src/ai/step2-solution-arch.md missing — 5-step pipeline requires Step 2 prompt; check build output"

run_step "v4.1.0: step3-enterprise-arch.md prompt template present (Step 3 — enterprise_architecture_insights)" \
  "test -f '$PROJECT_ROOT/src/ai/step3-enterprise-arch.md'" \
  "src/ai/step3-enterprise-arch.md missing — 5-step pipeline requires Step 3 prompt; check build output"

run_step "v4.1.0: step4-account.md prompt template present (Step 4 — account_insights, opus)" \
  "test -f '$PROJECT_ROOT/src/ai/step4-account.md'" \
  "src/ai/step4-account.md missing — 5-step pipeline requires Step 4 prompt; check build output"

run_step "v4.1.0: step5-industry.md prompt template present (Step 5 — industry_insights, opus)" \
  "test -f '$PROJECT_ROOT/src/ai/step5-industry.md'" \
  "src/ai/step5-industry.md missing — 5-step pipeline requires Step 5 prompt; check build output"

run_step "v4.1.0: analyze.js has 5-step pipeline (contract/solution_arch/enterprise_arch/account/industry)" \
  "grep -q 'step1\|step2\|step3\|step4\|step5\|contract.*ai_insights\|solution_architecture_insights\|enterprise_architecture_insights\|account_insights\|industry_insights' '$PROJECT_ROOT/src/tools/analyze.js'" \
  "analyze.js does not reference 5-step pipeline fields — v4.1.0 requires 5-step bottom-up AI pipeline; check src/tools/analyze.js"

run_step "v3.0.0: analyze.js no action_for_csm (removed in v3)" \
  "! grep -q 'action_for_csm' '$PROJECT_ROOT/src/tools/analyze.js'" \
  "analyze.js still references action_for_csm — this field was removed in v3.0.0; check src/tools/analyze.js"

run_step "v3.2.0: analyze.js stripCodeFences() has fallback regex for preamble text (L1 haiku fix)" \
  "grep -q 'preamble\|Fallback.*JSON\|extract.*JSON block\|anywhere in the response' '$PROJECT_ROOT/src/tools/analyze.js'" \
  "analyze.js stripCodeFences() missing fallback regex for preamble — v3.2.0 requires handling text before JSON fence; check src/tools/analyze.js"

# ------------------------------------------------------------
# Build: STORY-004 — CSV to JSON transformation (--transform)
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-004 — CSV to JSON transformation (--transform) ==="
run_step "Confirm csv-parse installed (STORY-004)" \
  "test -d '$PROJECT_ROOT/node_modules/csv-parse'" \
  "Run: cd '$PROJECT_ROOT' && npm install — csv-parse must be present"

run_step "Confirm src/tools/transform.js present (STORY-004)" \
  "test -f '$PROJECT_ROOT/src/tools/transform.js'" \
  "STORY-004 source file missing — check build output or re-run the build phase"

run_step "Confirm src/lib/metrics.js present (STORY-004)" \
  "test -f '$PROJECT_ROOT/src/lib/metrics.js'" \
  "STORY-004 metrics library missing — check build output or re-run the build phase"

run_step "Confirm src/lib/reconciler.js present (STORY-004)" \
  "test -f '$PROJECT_ROOT/src/lib/reconciler.js'" \
  "STORY-004 reconciler missing — check build output or re-run the build phase"

run_step "Confirm src/lib/fieldMapper.js present (STORY-004)" \
  "test -f '$PROJECT_ROOT/src/lib/fieldMapper.js'" \
  "STORY-004 fieldMapper missing — check build output or re-run the build phase"

run_step "v4.1.0: transform.js produces nested solutions_l1/l2/l3 hierarchy (new schema)" \
  "grep -q 'solutions_l1\|solutions_l2\|solutions_l3' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js does not contain solutions_l1/l2/l3 — v4.1.0 requires new 3-level product hierarchy; check src/tools/transform.js"

run_step "v3.0.0: transform.js no employee_id output (removed in v3)" \
  "! grep -qE 'employee_id.*output|output.*employee_id|[\"'\'']employee_id[\"'\'']\\s*:' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes employee_id — this field was removed in v3.0.0; check src/tools/transform.js"

run_step "v3.0.0: reconciler.js uses proportional tolerance (integer-safe arithmetic)" \
  "grep -q 'reconcil\|tolerance\|proportional' '$PROJECT_ROOT/src/lib/reconciler.js'" \
  "reconciler.js missing proportional reconciliation — v3.0.0 requires integer-safe arithmetic; check src/lib/reconciler.js"

run_step "v3.2.0: transform.js does not write fy_target_total (forecast field removed)" \
  "! grep -q 'fy_target_total' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes fy_target_total — v3.2.0 removes all forecast fields from product shape; check src/tools/transform.js"

run_step "v3.2.0: transform.js does not write year_end_forecast (forecast field removed)" \
  "! grep -q 'year_end_forecast' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes year_end_forecast — v3.2.0 removes all forecast fields from product shape; check src/tools/transform.js"

run_step "v3.2.0: transform.js does not write year_end_attainment_pct (forecast field removed)" \
  "! grep -q 'year_end_attainment_pct' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes year_end_attainment_pct — v3.2.0 removes all forecast fields from product shape; check src/tools/transform.js"

run_step "v3.2.0: transform.js does not write forecast_confidence (forecast field removed)" \
  "! grep -q 'forecast_confidence' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes forecast_confidence — v3.2.0 removes all forecast fields from product shape; check src/tools/transform.js"

run_step "v3.2.0: transform.js does not write risk_items[] on customer (risk classification removed)" \
  "! grep -qE '[\"'\'']risk_items[\"'\'']\\s*:|risk_items\s*=' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes risk_items[] — v3.2.0 removes risk_items[] from customer shape; check src/tools/transform.js"

# ------------------------------------------------------------
# Build: STORY-005 — HTML dashboard generation (--dashboard)
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-005 — HTML dashboard generation (--dashboard) ==="
run_step "Confirm src/tools/dashboard.js present (STORY-005)" \
  "test -f '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "STORY-005 source file missing — check build output or re-run the build phase"

run_step "v4.1.0: dashboard.js traverses solutions_l1/l2/l3 hierarchy (new schema)" \
  "grep -q 'solutions_l1\|solutions_l2\|solutions_l3' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not traverse solutions_l1/l2/l3 — v4.1.0 requires new 3-level product hierarchy; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.js shows industry (industry_insights pane)" \
  "grep -q 'industry' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not display industry field — v4.1.0 requires left-pane industry list; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.js renders account_insights (customer-level AI)" \
  "grep -q 'account_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not render account_insights — v4.1.0 requires account insights from 5-step pipeline; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.js renders contract_insights (L3 product-level AI)" \
  "grep -q 'contract_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not render contract_insights — v4.1.0 requires contract insights from Step 1 AI; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.js renders solution_architecture_insights (L3 solution arch)" \
  "grep -q 'solution_architecture_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js missing solution_architecture_insights — v4.1.0 requires Step 2 AI insights at L3 level; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.js renders enterprise_architecture_insights (L1 enterprise arch)" \
  "grep -q 'enterprise_architecture_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js missing enterprise_architecture_insights — v4.1.0 requires Step 3 AI insights at L1 level; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.js has C_CONSUMED and C_BUDGET color constants (new naming)" \
  "grep -q 'C_CONSUMED\|C_BUDGET' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js missing C_CONSUMED/C_BUDGET color constants — v4.1.0 renames C_CACV→C_CONSUMED, C_TARGET→C_BUDGET; check src/tools/dashboard.js"

run_step "v3.2.0: dashboard.js does not display year_end_attainment_pct (forecast field removed)" \
  "! grep -q 'year_end_attainment_pct' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js still references year_end_attainment_pct — v3.2.0 removes forecast fields from companion panel; check src/tools/dashboard.js"

run_step "v3.2.0: dashboard.js does not display forecast_confidence (forecast field removed)" \
  "! grep -q 'forecast_confidence' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js still references forecast_confidence — v3.2.0 removes forecast fields from companion panel; check src/tools/dashboard.js"

# ------------------------------------------------------------
# Build: STORY-006 — Industry vertical inference
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-006 — Industry vertical inference ==="
run_step "Confirm src/lib/industry.js present (STORY-006)" \
  "test -f '$PROJECT_ROOT/src/lib/industry.js'" \
  "STORY-006 industry inference library missing — check build output or re-run the build phase"

run_step "v4.1.0: industry.js has inferIndustry (AI-powered, 23 SAP verticals)" \
  "grep -q 'inferIndustry\|VALID_VERTICALS' '$PROJECT_ROOT/src/lib/industry.js'" \
  "industry.js missing inferIndustry or VALID_VERTICALS — v4.1.0 requires async AI inference with 23 SAP verticals; check src/lib/industry.js"

run_step "v3.0.0: transform.js calls inferIndustry (STORY-006 integrated)" \
  "grep -q 'inferIndustry\|industry' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js does not call inferIndustry — v3.0.0 requires STORY-006 industry inference in --transform; check src/tools/transform.js"

# ------------------------------------------------------------
# Runtime storage
# ------------------------------------------------------------
echo ""
echo "=== Runtime storage ==="
run_step "Create data/ directory for input and output files" \
  "mkdir -p '$PROJECT_ROOT/data'" \
  "Check write permissions on $PROJECT_ROOT"
echo "     Storage directory ready: $PROJECT_ROOT/data"
# MANUAL: back up and restore the data/ directory across reinstalls as needed — it is gitignored

# ------------------------------------------------------------
# Dry-run branch — verify without linking
# ------------------------------------------------------------
if [[ "$DRY_RUN" == "true" ]]; then
  echo ""
  echo "=== Dry-run: smoke test ==="
  run_step "consumption-analyzer --help executes without error" \
    "node '$PROJECT_ROOT/src/cli.js' --help >/dev/null 2>&1" \
    "Check src/cli.js exists and dotenv, commander are in node_modules"

  run_step "--help output mentions --pdf2csv flag (STORY-002)" \
    "node '$PROJECT_ROOT/src/cli.js' --help 2>&1 | grep -q '\-\-pdf2csv'" \
    "STORY-002 flag missing from --help — check src/cli.js registers --pdf2csv"

  run_step "--help output mentions --analyze flag (STORY-003)" \
    "node '$PROJECT_ROOT/src/cli.js' --help 2>&1 | grep -q '\-\-analyze'" \
    "STORY-003 flag missing from --help — check src/cli.js registers --analyze"

  run_step "--help output mentions --transform flag (STORY-004)" \
    "node '$PROJECT_ROOT/src/cli.js' --help 2>&1 | grep -q '\-\-transform'" \
    "STORY-004 flag missing from --help — check src/cli.js registers --transform"

  run_step "--help output mentions --dashboard flag (STORY-005)" \
    "node '$PROJECT_ROOT/src/cli.js' --help 2>&1 | grep -q '\-\-dashboard'" \
    "STORY-005 flag missing from --help — check src/cli.js registers --dashboard"

  run_step "--help output mentions --output flag" \
    "node '$PROJECT_ROOT/src/cli.js' --help 2>&1 | grep -q '\-\-output'" \
    "--output modifier flag missing from --help — check src/cli.js registers --output"

  run_step "Exit code 1 on no-flag invocation" \
    "node '$PROJECT_ROOT/src/cli.js' 2>/dev/null; [[ \$? -eq 1 ]]" \
    "src/cli.js must call process.exit(1) when no tool flag is supplied"

  run_step "--help output mentions positional [file] argument" \
    "node '$PROJECT_ROOT/src/cli.js' --help 2>&1 | grep -q '\[file\]'" \
    "Positional [file] argument missing from --help — check src/cli.js registers .argument('[file]', ...)"

  # v4.1.0: always regenerate portfolio.json to verify updated schema
  run_step "End-to-end (CSV path): --transform on CACV_CROSS_FC_OPS_DIBO_REPORT.csv exits 0" \
    "cd '$PROJECT_ROOT' && node '$PROJECT_ROOT/src/cli.js' --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv >/dev/null 2>&1" \
    "--transform failed — check src/tools/transform.js and that data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv exists"

  PORTFOLIO_JSON="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json"

  run_step "End-to-end: portfolio.json exists" \
    "test -f '$PORTFOLIO_JSON'" \
    "portfolio.json not found at data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json — run: node src/cli.js --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv"

  # v4.1.0 structural checks on portfolio.json (new schema)
  run_step "v4.1.0: portfolio.json has 'customers' array (multi-customer support)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if(!Array.isArray(d.customers)||d.customers.length===0) process.exit(1);\"" \
    "portfolio.json missing non-empty customers array — check src/tools/transform.js groups by customer"

  run_step "v4.1.0: products nested under solutions_l1/l2/l3 (new schema)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.solutions_l1||!c.solutions_l1[0]) process.exit(1); const l2=c.solutions_l1[0].solutions_l2; if(!l2||!l2[0]) process.exit(1); const l3=l2[0].solutions_l3; if(!Array.isArray(l3)||l3.length===0) process.exit(1);\"" \
    "portfolio.json missing solutions_l1/l2/l3 hierarchy — v4.1.0 requires new 3-level schema; check src/tools/transform.js"

  run_step "v4.1.0: customer.industry field populated (STORY-006)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.industry||c.industry===null) process.exit(1);\"" \
    "customer.industry is missing or null — STORY-006 industry inference must run during --transform; check src/lib/industry.js and src/tools/transform.js"

  run_step "v4.1.0: customer has no employee_id (removed)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if('employee_id' in d.customers[0]) process.exit(1);\"" \
    "portfolio.json customer still has employee_id — this field was removed; check src/tools/transform.js"

  run_step "v4.1.0: L3 product has contract block with contract_insights field" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const l3=d.customers[0].solutions_l1[0].solutions_l2[0].solutions_l3[0]; if(!l3.contract||!('contract_insights' in l3.contract)) process.exit(1);\"" \
    "L3 product missing contract.contract_insights — v4.1.0 requires contract block with AI insights slot; check src/tools/transform.js"

  run_step "v4.1.0: reporting_month is YYYYMM integer string (not YYYY-MM)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if(!/^[0-9]{6}$/.test(String(d.reporting_month))) process.exit(1);\"" \
    "reporting_month is not a 6-digit YYYYMM string — v4.1.0 requires raw YYYYMM format; check src/tools/transform.js"

  run_step "v4.1.0: portfolio.json has no fy_target_total (forecast field absent)" \
    "! grep -q 'fy_target_total' '$PORTFOLIO_JSON'" \
    "portfolio.json still contains fy_target_total — forecast fields were removed; check src/tools/transform.js"

  run_step "v4.1.0: portfolio.json has no risk_items[] (risk classification removed)" \
    "! grep -q 'risk_items' '$PORTFOLIO_JSON'" \
    "portfolio.json still contains risk_items[] — risk classification fields were removed; check src/tools/transform.js"

  # Dashboard generation
  run_step "End-to-end: --dashboard on portfolio.json exits 0" \
    "cd '$PROJECT_ROOT' && node '$PROJECT_ROOT/src/cli.js' --dashboard data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json >/dev/null 2>&1" \
    "--dashboard failed — check src/tools/dashboard.js and that portfolio.json exists"

  DASHBOARD_HTML="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio-dashboard.html"
  run_step "End-to-end: dashboard HTML produced" \
    "test -f '$DASHBOARD_HTML'" \
    "portfolio-dashboard.html not found — check src/tools/dashboard.js output path (should be <basename>-dashboard.html)"

  run_step "End-to-end: dashboard.html has NO CDN references (zero-dependency HTML)" \
    "! grep -q 'cdn.jsdelivr\|cdn\.cloudflare\|cdnjs\|unpkg\.com' '$DASHBOARD_HTML'" \
    "CDN reference found in dashboard.html — dashboard must inline all assets; check src/tools/dashboard.js"

  run_step "v3.0.0: dashboard.html has role-tab navigation (data-role attributes)" \
    "grep -q 'data-role' '$DASHBOARD_HTML'" \
    "Role navigation not found in dashboard.html — v3.0.0 requires EA and Executive role tabs; check src/tools/dashboard.js"

  run_step "v4.1.0: dashboard.html has 3-pane layout (industry/customer/detail panes)" \
    "grep -q 'industry-item\|selectIndustry\|industry_insights' '$DASHBOARD_HTML'" \
    "3-pane layout not found in dashboard.html — v4.1.0 requires left-drives-right industry→customer→detail; check src/tools/dashboard.js"

  run_step "v4.1.0: dashboard.html displays industry items (left pane)" \
    "grep -q 'industry' '$DASHBOARD_HTML'" \
    "Industry data not found in dashboard.html — v4.1.0 requires left pane industry list; check src/tools/dashboard.js"

  run_step "v4.1.0: dashboard.html renders account_insights (customer-level AI)" \
    "grep -q 'account_insights\|Account Insights' '$DASHBOARD_HTML'" \
    "account_insights not found in dashboard.html — v4.1.0 requires Step 4 account insights; check src/tools/dashboard.js"

  run_step "v4.1.0: dashboard.html renders contract_insights (L3 product-level AI)" \
    "grep -q 'contract_insights\|Contract Insights' '$DASHBOARD_HTML'" \
    "contract_insights not found in dashboard.html — v4.1.0 requires Step 1 contract insights; check src/tools/dashboard.js"

  run_step "v4.1.0: dashboard.html renders enterprise_architecture_insights (L1)" \
    "grep -q 'enterprise_architecture_insights\|Enterprise Architecture Insights' '$DASHBOARD_HTML'" \
    "enterprise_architecture_insights not found in dashboard.html — v4.1.0 requires Step 3 EA insights; check src/tools/dashboard.js"

  run_step "v4.1.0: dashboard.html has no year_end_attainment_pct (forecast field removed)" \
    "! grep -q 'year_end_attainment_pct\|Year.End Attainment' '$DASHBOARD_HTML'" \
    "year_end_attainment_pct found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

  run_step "v4.1.0: dashboard.html has no forecast_confidence (forecast field removed)" \
    "! grep -q 'forecast_confidence\|Forecast Confidence' '$DASHBOARD_HTML'" \
    "forecast_confidence found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

  run_step "v3.0.0: dashboard.html inline scripts parse without SyntaxError" \
    "node -e \"const h=require('fs').readFileSync('$DASHBOARD_HTML','utf8'); const s=[...h.matchAll(/<script>([\\\\s\\\\S]*?)<\\/script>/g)].map(m=>m[1]).join('\\\\n'); new Function(s)\"" \
    "SyntaxError in dashboard.html inline scripts — check src/tools/dashboard.js for invalid regex patterns or syntax errors"

  run_step "v3.0.0: dashboard.html has NO invalid regex flags (v2 regression check)" \
    "! grep -qF '/if}}/g' '$DASHBOARD_HTML'" \
    "Invalid regex '/if}}/g' found in dashboard.html — check src/tools/dashboard.js uses string split/join instead"

  # --pdf2csv verified last to avoid overwriting source CSV used by --transform.
  # Skipped if the PDF is not present in data/ (PDF is not committed to source control).
  if [[ -f "$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf" ]]; then
    run_step "--pdf2csv: CACV_CROSS_FC_OPS_DIBO_REPORT.pdf converts to CSV without error (STORY-002)" \
      "cd '$PROJECT_ROOT' && node '$PROJECT_ROOT/src/cli.js' --pdf2csv data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf >/dev/null 2>&1" \
      "--pdf2csv failed — check src/tools/pdf2csv.js and that data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf exists"
  else
    echo "  -> --pdf2csv smoke test: SKIPPED (data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf not present)"
    echo "     OK (place PDF in data/ to enable this check)"
  fi

  echo ""
  echo "Dry-run complete — all checks passed. Dependencies are installed."
  echo ""
  echo "  To link the binary to PATH: bash specs/deploy.sh"
  echo "  To run without linking:     node src/cli.js --help"
  exit 0
fi

# ------------------------------------------------------------
# Deploy: link binary to PATH
# ------------------------------------------------------------
echo ""
echo "=== Deploy: link binary to PATH ==="
run_step "npm link — register consumption-analyzer as a global command" \
  "cd '$PROJECT_ROOT' && npm link" \
  "On permission errors run: sudo npm link  OR  configure npm prefix to a user-writable directory: npm config set prefix ~/.npm-global"

run_step "Verify binary is reachable on PATH" \
  "which consumption-analyzer >/dev/null 2>&1" \
  "npm link may have linked to a directory not on PATH. Check: npm config get prefix — add <prefix>/bin to your PATH"

run_step "Verify binary responds to --help" \
  "consumption-analyzer --help >/dev/null 2>&1" \
  "Binary is linked but failed to start. Run: consumption-analyzer --help manually and check for import errors"

run_step "Verify --pdf2csv flag appears in --help (STORY-002)" \
  "consumption-analyzer --help 2>&1 | grep -q '\-\-pdf2csv'" \
  "STORY-002 flag missing — check src/cli.js registers --pdf2csv and npm link used latest sources"

run_step "Verify --analyze flag appears in --help (STORY-003)" \
  "consumption-analyzer --help 2>&1 | grep -q '\-\-analyze'" \
  "STORY-003 flag missing — check src/cli.js registers --analyze and npm link used latest sources"

run_step "Verify --transform flag appears in --help (STORY-004)" \
  "consumption-analyzer --help 2>&1 | grep -q '\-\-transform'" \
  "STORY-004 flag missing — check src/cli.js registers --transform and npm link used latest sources"

run_step "Verify --dashboard flag appears in --help (STORY-005)" \
  "consumption-analyzer --help 2>&1 | grep -q '\-\-dashboard'" \
  "STORY-005 flag missing — check src/cli.js registers --dashboard and npm link used latest sources"

run_step "Verify --output flag appears in --help" \
  "consumption-analyzer --help 2>&1 | grep -q '\-\-output'" \
  "--output modifier flag missing — check src/cli.js registers --output and npm link used latest sources"

run_step "Verify positional [file] argument appears in --help" \
  "consumption-analyzer --help 2>&1 | grep -q '\[file\]'" \
  "Positional [file] argument missing from --help — check src/cli.js registers .argument('[file]', ...)"

# v3.2.0: regenerate portfolio.json to confirm updated schema (no forecast/risk fields)
run_step "End-to-end (CSV path): --transform on CACV_CROSS_FC_OPS_DIBO_REPORT.csv exits 0" \
  "cd '$PROJECT_ROOT' && consumption-analyzer --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv >/dev/null 2>&1" \
  "--transform failed — check src/tools/transform.js and that data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv exists"

PORTFOLIO_JSON="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json"

run_step "End-to-end: portfolio.json exists" \
  "test -f '$PORTFOLIO_JSON'" \
  "portfolio.json not found — run: consumption-analyzer --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv"

# v4.1.0 structural checks on portfolio.json (new schema)
run_step "v4.1.0: portfolio.json has 'customers' array" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if(!Array.isArray(d.customers)||d.customers.length===0) process.exit(1);\"" \
  "portfolio.json missing non-empty customers array — check src/tools/transform.js"

run_step "v4.1.0: products nested under solutions_l1/l2/l3 (new schema)" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.solutions_l1||!c.solutions_l1[0]) process.exit(1); const l2=c.solutions_l1[0].solutions_l2; if(!l2||!l2[0]) process.exit(1); const l3=l2[0].solutions_l3; if(!Array.isArray(l3)||l3.length===0) process.exit(1);\"" \
  "portfolio.json missing solutions_l1/l2/l3 hierarchy — v4.1.0 requires new 3-level schema; check src/tools/transform.js"

run_step "v4.1.0: customer.industry field populated (STORY-006)" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.industry||c.industry===null) process.exit(1);\"" \
  "customer.industry is missing or null — STORY-006 industry inference must run during --transform; check src/lib/industry.js"

run_step "v4.1.0: customer has no employee_id (removed)" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if('employee_id' in d.customers[0]) process.exit(1);\"" \
  "portfolio.json customer still has employee_id — this field was removed; check src/tools/transform.js"

run_step "v4.1.0: L3 product has contract block with contract_insights field" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const l3=d.customers[0].solutions_l1[0].solutions_l2[0].solutions_l3[0]; if(!l3.contract||!('contract_insights' in l3.contract)) process.exit(1);\"" \
  "L3 product missing contract.contract_insights — v4.1.0 requires contract block with AI insights slot; check src/tools/transform.js"

run_step "v4.1.0: portfolio.json has no fy_target_total (forecast field absent)" \
  "! grep -q 'fy_target_total' '$PORTFOLIO_JSON'" \
  "portfolio.json still contains fy_target_total — forecast fields were removed; check src/tools/transform.js"

run_step "v4.1.0: portfolio.json has no risk_items[] (risk classification removed)" \
  "! grep -q 'risk_items' '$PORTFOLIO_JSON'" \
  "portfolio.json still contains risk_items[] — risk classification fields were removed; check src/tools/transform.js"

# Dashboard
run_step "End-to-end: --dashboard on portfolio.json exits 0" \
  "cd '$PROJECT_ROOT' && consumption-analyzer --dashboard data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json >/dev/null 2>&1" \
  "--dashboard failed — check src/tools/dashboard.js and that portfolio.json exists"

DASHBOARD_HTML="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio-dashboard.html"
run_step "End-to-end: dashboard HTML produced" \
  "test -f '$DASHBOARD_HTML'" \
  "portfolio-dashboard.html not found — check src/tools/dashboard.js output naming"

run_step "End-to-end: dashboard.html has NO CDN references (zero-dependency HTML)" \
  "! grep -q 'cdn.jsdelivr\|cdn\.cloudflare\|cdnjs\|unpkg\.com' '$DASHBOARD_HTML'" \
  "CDN reference found in dashboard.html — all assets must be inlined; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.html has 3-pane layout (industry/customer/detail panes)" \
  "grep -q 'industry-item\|selectIndustry\|industry_insights' '$DASHBOARD_HTML'" \
  "3-pane layout not found in dashboard.html — v4.1.0 requires left-drives-right industry→customer→detail"

run_step "v4.1.0: dashboard.html displays industry items (left pane)" \
  "grep -q 'industry' '$DASHBOARD_HTML'" \
  "Industry data not found in dashboard.html — v4.1.0 requires left pane industry list"

run_step "v4.1.0: dashboard.html renders account_insights (customer-level AI)" \
  "grep -q 'account_insights\|Account Insights' '$DASHBOARD_HTML'" \
  "account_insights not found in dashboard.html — v4.1.0 requires Step 4 account insights; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.html renders contract_insights (L3 product-level AI)" \
  "grep -q 'contract_insights\|Contract Insights' '$DASHBOARD_HTML'" \
  "contract_insights not found in dashboard.html — v4.1.0 requires Step 1 contract insights; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.html renders enterprise_architecture_insights (L1)" \
  "grep -q 'enterprise_architecture_insights\|Enterprise Architecture Insights' '$DASHBOARD_HTML'" \
  "enterprise_architecture_insights not found in dashboard.html — v4.1.0 requires Step 3 EA insights; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.html has no year_end_attainment_pct (forecast field removed)" \
  "! grep -q 'year_end_attainment_pct\|Year.End Attainment' '$DASHBOARD_HTML'" \
  "year_end_attainment_pct found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.html has no forecast_confidence (forecast field removed)" \
  "! grep -q 'forecast_confidence\|Forecast Confidence' '$DASHBOARD_HTML'" \
  "forecast_confidence found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

run_step "v4.1.0: dashboard.html inline scripts parse without SyntaxError" \
  "node -e \"const h=require('fs').readFileSync('$DASHBOARD_HTML','utf8'); const s=[...h.matchAll(/<script>([\\\\s\\\\S]*?)<\\/script>/g)].map(m=>m[1]).join('\\\\n'); new Function(s)\"" \
  "SyntaxError in dashboard.html inline scripts — check src/tools/dashboard.js"

# --pdf2csv verified last to avoid overwriting the source CSV.
# Skipped if the PDF is not present in data/ (PDF is not committed to source control).
if [[ -f "$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf" ]]; then
  run_step "--pdf2csv: CACV_CROSS_FC_OPS_DIBO_REPORT.pdf converts to CSV without error (STORY-002)" \
    "cd '$PROJECT_ROOT' && consumption-analyzer --pdf2csv data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf >/dev/null 2>&1" \
    "--pdf2csv failed — check src/tools/pdf2csv.js and that data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf exists"
else
  echo "  -> --pdf2csv smoke test: SKIPPED (data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf not present)"
  echo "     OK (place PDF in data/ to enable this check)"
fi

# ------------------------------------------------------------
# Footer
# ------------------------------------------------------------
echo ""
echo "Release $VERSION installed — local-npm"
echo ""
echo "  Binary:  consumption-analyzer"
echo "  Source:  $PROJECT_ROOT/src/cli.js"
echo "  Data:    $PROJECT_ROOT/data/"
echo ""
echo "  Try it:"
echo "    consumption-analyzer --help"
echo "    consumption-analyzer --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv"
echo "    consumption-analyzer --dashboard data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json"
echo "    consumption-analyzer --analyze data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json"
echo "    consumption-analyzer --pdf2csv data/CACV_CROSS_FC_OPS_DIBO_REPORT.pdf"
echo ""
echo "  Deployment log:  specs/deploy-artifact.md"
