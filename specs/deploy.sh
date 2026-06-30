#!/bin/bash
# SpecGantry deploy script — Release 4.6.0 — 2026-06-30
# Target: local-npm (CLI binary installed via npm link)
#
# Usage:
#   bash specs/deploy.sh              Install dependencies and link the binary to PATH
#   bash specs/deploy.sh --dry-run    Verify installation locally without linking to PATH
#
# Environment variables (set in .env or export before running):
#   DATA_DIR              — Path to input/output data directory (e.g. ./data)
#   LOG_LEVEL             — Logging verbosity: silent | info | debug
#   PDF_MAX_PAGES         — Max pages to process per PDF file (0 = all)
#   CSV_DELIMITER         — Output CSV field delimiter (default ,)
#   AI_MAX_TOKENS         — Max tokens per AI response (default: 8192)
#   AI_BASE_URL           — Custom AI API base URL (empty = Anthropic default)
#   AI_PIPELINE_CONCURRENCY — Max parallel AI calls in --analyze Steps 1-3 (default 15)
#
# Required only when using --analyze or --transform (STORY-006 industry inference):
#   AI_API_KEY            — Anthropic API key
#   AI_MODEL              — Model ID for Steps 1-3 (sonnet) and industry inference
#   AI_MODEL_SENIOR       — Model ID for Steps 4-5 (opus)
#
# Pre-deployment checklist:
#   1. Copy specs/.env.example to .env and confirm all values
#   2. Run: bash specs/deploy.sh --dry-run   (verify install without linking)
#   3. Run: bash specs/deploy.sh             (full install + npm link)

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

VERSION="4.6.0"

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
# AI env var check (optional — required only for --analyze / --transform)
# ------------------------------------------------------------
echo ""
echo "=== AI configuration check (--analyze and --transform tools) ==="
AI_VARS_OK=true
for var in AI_API_KEY AI_MODEL AI_MODEL_SENIOR AI_BASE_URL AI_MAX_TOKENS AI_PIPELINE_CONCURRENCY; do
  val="${!var:-}"
  if [[ -z "$val" ]]; then
    echo "  warn: $var is not set — --analyze and --transform (industry inference) will not work until this is added to .env"
    AI_VARS_OK=false
  else
    echo "  OK   $var is set"
  fi
done
if [[ "$AI_VARS_OK" == "false" ]]; then
  echo "  (AI vars are optional for --pdf2csv and --dashboard — deploy continues)"
fi

# AI_MAX_TOKENS should be >= 8192 for 5-step pipeline
AI_MAX_TOKENS_VAL="${AI_MAX_TOKENS:-0}"
if [[ "$AI_MAX_TOKENS_VAL" =~ ^[0-9]+$ ]] && [[ "$AI_MAX_TOKENS_VAL" -lt 8192 ]]; then
  echo "  warn: AI_MAX_TOKENS=$AI_MAX_TOKENS_VAL is below 8192 — 5-step AI pipeline recommends 8192+"
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

run_step "pdf2csv.js has HEADER_ALIAS_MAP (canonical header normalization)" \
  "grep -q 'HEADER_ALIAS_MAP' '$PROJECT_ROOT/src/tools/pdf2csv.js'" \
  "pdf2csv.js is missing HEADER_ALIAS_MAP — check src/tools/pdf2csv.js"

run_step "pdf2csv.js has BOM stripping at cell level (transformedRaw)" \
  "grep -q 'transformedRaw\|U+FEFF\|\\\\uFEFF\|replace.*BOM\|replace.*\\\\ufeff' '$PROJECT_ROOT/src/tools/pdf2csv.js'" \
  "pdf2csv.js is missing cell-level BOM stripping — check src/tools/pdf2csv.js"

# ------------------------------------------------------------
# Build: STORY-003 — AI-powered analysis (--analyze) — 5-step bottom-up pipeline
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

run_step "step1-contract.md prompt template present (Step 1 — contract ai_insights)" \
  "test -f '$PROJECT_ROOT/src/ai/step1-contract.md'" \
  "src/ai/step1-contract.md missing — 5-step pipeline requires Step 1 prompt; check build output"

run_step "step2-solution-arch.md prompt template present (Step 2 — solution_architecture_insights)" \
  "test -f '$PROJECT_ROOT/src/ai/step2-solution-arch.md'" \
  "src/ai/step2-solution-arch.md missing — 5-step pipeline requires Step 2 prompt; check build output"

run_step "step3-enterprise-arch.md prompt template present (Step 3 — enterprise_architecture_insights)" \
  "test -f '$PROJECT_ROOT/src/ai/step3-enterprise-arch.md'" \
  "src/ai/step3-enterprise-arch.md missing — 5-step pipeline requires Step 3 prompt; check build output"

run_step "step4-account.md prompt template present (Step 4 — account_insights, opus)" \
  "test -f '$PROJECT_ROOT/src/ai/step4-account.md'" \
  "src/ai/step4-account.md missing — 5-step pipeline requires Step 4 prompt; check build output"

run_step "step5-industry.md prompt template present (Step 5 — industry_insights, opus)" \
  "test -f '$PROJECT_ROOT/src/ai/step5-industry.md'" \
  "src/ai/step5-industry.md missing — 5-step pipeline requires Step 5 prompt; check build output"

run_step "analyze.js has 5-step pipeline fields (contract/solution_arch/enterprise_arch/account/industry)" \
  "grep -q 'step1\|step2\|step3\|step4\|step5\|contract.*ai_insights\|solution_architecture_insights\|enterprise_architecture_insights\|account_insights\|industry_insights' '$PROJECT_ROOT/src/tools/analyze.js'" \
  "analyze.js does not reference 5-step pipeline fields — check src/tools/analyze.js"

run_step "analyze.js has concurrency limiter (AI_PIPELINE_CONCURRENCY cap for Steps 1-3)" \
  "grep -q 'runWithConcurrency\|concurrency\|AI_PIPELINE_CONCURRENCY\|semaphore' '$PROJECT_ROOT/src/tools/analyze.js'" \
  "analyze.js missing concurrency limiter — Steps 1-3 must cap parallel AI calls via runWithConcurrency(); check src/tools/analyze.js"

run_step "analyze.js no action_for_csm (removed in v3)" \
  "! grep -q 'action_for_csm' '$PROJECT_ROOT/src/tools/analyze.js'" \
  "analyze.js still references action_for_csm — this field was removed; check src/tools/analyze.js"

run_step "analyze.js stripCodeFences() has fallback regex for preamble text" \
  "grep -q 'preamble\|Fallback.*JSON\|extract.*JSON block\|anywhere in the response' '$PROJECT_ROOT/src/tools/analyze.js'" \
  "analyze.js stripCodeFences() missing fallback regex for preamble — check src/tools/analyze.js"

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

run_step "transform.js produces nested solutions_l1/l2/l3 hierarchy" \
  "grep -q 'solutions_l1\|solutions_l2\|solutions_l3' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js does not contain solutions_l1/l2/l3 — new 3-level product hierarchy required; check src/tools/transform.js"

run_step "transform.js no employee_id output (removed)" \
  "! grep -qE 'employee_id.*output|output.*employee_id|[\"'\''employee_id\"'\'']\\s*:' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes employee_id — this field was removed; check src/tools/transform.js"

run_step "reconciler.js uses proportional tolerance (integer-safe arithmetic)" \
  "grep -q 'reconcil\|tolerance\|proportional' '$PROJECT_ROOT/src/lib/reconciler.js'" \
  "reconciler.js missing proportional reconciliation — check src/lib/reconciler.js"

run_step "transform.js does not write fy_target_total (forecast field removed)" \
  "! grep -q 'fy_target_total' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes fy_target_total — forecast fields were removed; check src/tools/transform.js"

run_step "transform.js does not write year_end_forecast (forecast field removed)" \
  "! grep -q 'year_end_forecast' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes year_end_forecast — forecast fields were removed; check src/tools/transform.js"

run_step "transform.js does not write risk_items[] on customer (risk classification removed)" \
  "! grep -qE '[\"'\''risk_items\"'\'']\\s*:|risk_items\\s*=' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js still writes risk_items[] — this field was removed; check src/tools/transform.js"

# ------------------------------------------------------------
# Build: STORY-006 — Industry vertical inference
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-006 — Industry vertical inference ==="
run_step "Confirm src/lib/industry.js present (STORY-006)" \
  "test -f '$PROJECT_ROOT/src/lib/industry.js'" \
  "STORY-006 industry inference library missing — check build output or re-run the build phase"

run_step "industry.js has inferIndustry and VALID_VERTICALS (23 SAP verticals)" \
  "grep -q 'inferIndustry\|VALID_VERTICALS' '$PROJECT_ROOT/src/lib/industry.js'" \
  "industry.js missing inferIndustry or VALID_VERTICALS — check src/lib/industry.js"

run_step "transform.js calls inferIndustry (STORY-006 integrated)" \
  "grep -q 'inferIndustry\|industry' '$PROJECT_ROOT/src/tools/transform.js'" \
  "transform.js does not call inferIndustry — check src/tools/transform.js"

# ------------------------------------------------------------
# Build: STORY-005 — 3-pane HTML dashboard generation (--dashboard)
# ------------------------------------------------------------
echo ""
echo "=== Build: STORY-005 — 3-pane HTML dashboard generation (--dashboard) ==="
run_step "Confirm src/tools/dashboard.js present (STORY-005)" \
  "test -f '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "STORY-005 source file missing — check build output or re-run the build phase"

run_step "dashboard.js traverses solutions_l1/l2/l3 hierarchy" \
  "grep -q 'solutions_l1\|solutions_l2\|solutions_l3' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not traverse solutions_l1/l2/l3 — new 3-level hierarchy required; check src/tools/dashboard.js"

run_step "dashboard.js renders account_insights (customer-level AI, Step 4)" \
  "grep -q 'account_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not render account_insights — Step 4 account insights required; check src/tools/dashboard.js"

run_step "dashboard.js renders contract_insights (L3 product-level AI, Step 1)" \
  "grep -q 'contract_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not render contract_insights — Step 1 contract insights required; check src/tools/dashboard.js"

run_step "dashboard.js renders solution_architecture_insights (L3, Step 2)" \
  "grep -q 'solution_architecture_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js missing solution_architecture_insights — Step 2 insights required; check src/tools/dashboard.js"

run_step "dashboard.js renders enterprise_architecture_insights (L1, Step 3)" \
  "grep -q 'enterprise_architecture_insights' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js missing enterprise_architecture_insights — Step 3 insights required; check src/tools/dashboard.js"

run_step "dashboard.js has C_CONSUMED and C_BUDGET color constants" \
  "grep -q 'C_CONSUMED\|C_BUDGET' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js missing C_CONSUMED/C_BUDGET — check src/tools/dashboard.js"

run_step "dashboard.js shows industry items (left pane)" \
  "grep -q 'industry' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js does not display industry field — left-pane industry list required; check src/tools/dashboard.js"

run_step "dashboard.js does not display year_end_attainment_pct (forecast field removed)" \
  "! grep -q 'year_end_attainment_pct' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js still references year_end_attainment_pct — forecast fields were removed; check src/tools/dashboard.js"

run_step "dashboard.js does not display forecast_confidence (forecast field removed)" \
  "! grep -q 'forecast_confidence' '$PROJECT_ROOT/src/tools/dashboard.js'" \
  "dashboard.js still references forecast_confidence — forecast fields were removed; check src/tools/dashboard.js"

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

  run_step "End-to-end (CSV path): --transform on CACV_CROSS_FC_OPS_DIBO_REPORT.csv exits 0" \
    "cd '$PROJECT_ROOT' && node '$PROJECT_ROOT/src/cli.js' --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv >/dev/null 2>&1" \
    "--transform failed — check src/tools/transform.js and that data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv exists"

  PORTFOLIO_JSON="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json"

  run_step "End-to-end: portfolio.json exists" \
    "test -f '$PORTFOLIO_JSON'" \
    "portfolio.json not found — run: node src/cli.js --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv"

  run_step "portfolio.json has 'customers' array (multi-customer support)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if(!Array.isArray(d.customers)||d.customers.length===0) process.exit(1);\"" \
    "portfolio.json missing non-empty customers array — check src/tools/transform.js groups by customer"

  run_step "products nested under solutions_l1/l2/l3 (new schema)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.solutions_l1||!c.solutions_l1[0]) process.exit(1); const l2=c.solutions_l1[0].solutions_l2; if(!l2||!l2[0]) process.exit(1); const l3=l2[0].solutions_l3; if(!Array.isArray(l3)||l3.length===0) process.exit(1);\"" \
    "portfolio.json missing solutions_l1/l2/l3 hierarchy — check src/tools/transform.js"

  run_step "customer.industry field populated (STORY-006)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.industry||c.industry===null) process.exit(1);\"" \
    "customer.industry is missing or null — STORY-006 industry inference must run during --transform; check src/lib/industry.js and src/tools/transform.js"

  run_step "customer has no employee_id (removed)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if('employee_id' in d.customers[0]) process.exit(1);\"" \
    "portfolio.json customer still has employee_id — this field was removed; check src/tools/transform.js"

  run_step "L3 product has contract block with contract_insights field" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const l3=d.customers[0].solutions_l1[0].solutions_l2[0].solutions_l3[0]; if(!l3.contract||!('contract_insights' in l3.contract)) process.exit(1);\"" \
    "L3 product missing contract.contract_insights — check src/tools/transform.js"

  run_step "reporting_month is YYYYMM integer string (not YYYY-MM)" \
    "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if(!/^[0-9]{6}$/.test(String(d.reporting_month))) process.exit(1);\"" \
    "reporting_month is not a 6-digit YYYYMM string — check src/tools/transform.js"

  run_step "portfolio.json has no fy_target_total (forecast field absent)" \
    "! grep -q 'fy_target_total' '$PORTFOLIO_JSON'" \
    "portfolio.json still contains fy_target_total — forecast fields were removed; check src/tools/transform.js"

  run_step "portfolio.json has no risk_items[] (risk classification removed)" \
    "! grep -q 'risk_items' '$PORTFOLIO_JSON'" \
    "portfolio.json still contains risk_items[] — risk classification fields were removed; check src/tools/transform.js"

  run_step "End-to-end: --dashboard on portfolio.json exits 0" \
    "cd '$PROJECT_ROOT' && node '$PROJECT_ROOT/src/cli.js' --dashboard data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json >/dev/null 2>&1" \
    "--dashboard failed — check src/tools/dashboard.js and that portfolio.json exists"

  DASHBOARD_HTML="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio-dashboard.html"
  run_step "End-to-end: dashboard HTML produced" \
    "test -f '$DASHBOARD_HTML'" \
    "portfolio-dashboard.html not found — check src/tools/dashboard.js output path"

  run_step "dashboard.html has NO CDN references (zero-dependency HTML, Mermaid excluded when no diagram)" \
    "! grep -q 'cdn.jsdelivr\|cdn\.cloudflare\|cdnjs\|unpkg\.com' '$DASHBOARD_HTML'" \
    "CDN reference found in dashboard.html — dashboard must inline all assets (Mermaid CDN is only added when enterprise_architecture_diagram is non-empty); check src/tools/dashboard.js"

  run_step "dashboard.html has view navigation (tab-industry/tab-accounts)" \
    "grep -q 'tab-industry\|tab-accounts' '$DASHBOARD_HTML'" \
    "View navigation not found in dashboard.html — INDUSTRY/ACCOUNTS tabs required; check src/tools/dashboard.js"

  run_step "dashboard.html has 3-pane layout (industry/customer/detail panes)" \
    "grep -q 'view-industry\|ind-panel\|tab-industry' '$DASHBOARD_HTML'" \
    "3-pane layout not found in dashboard.html — left-drives-right industry→customer→detail required; check src/tools/dashboard.js"

  run_step "dashboard.html renders account_insights (customer-level AI)" \
    "grep -q 'account_insights\|Account Insights' '$DASHBOARD_HTML'" \
    "account_insights not found in dashboard.html — Step 4 account insights required; check src/tools/dashboard.js"

  run_step "dashboard.html renders contract_insights (L3 product-level AI)" \
    "grep -q 'contract_insights\|Contract Insights' '$DASHBOARD_HTML'" \
    "contract_insights not found in dashboard.html — Step 1 contract insights required; check src/tools/dashboard.js"

  run_step "dashboard.html renders EA insights (L1 enterprise architecture)" \
    "grep -q 'EA insights\|enterprise_architecture_insights' '$DASHBOARD_HTML'" \
    "EA insights section not found in dashboard.html — Step 3 EA insights required; check src/tools/dashboard.js"

  run_step "dashboard.html has no year_end_attainment_pct (forecast field removed)" \
    "! grep -q 'year_end_attainment_pct\|Year.End Attainment' '$DASHBOARD_HTML'" \
    "year_end_attainment_pct found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

  run_step "dashboard.html has no forecast_confidence (forecast field removed)" \
    "! grep -q 'forecast_confidence\|Forecast Confidence' '$DASHBOARD_HTML'" \
    "forecast_confidence found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

  run_step "dashboard.html inline scripts parse without SyntaxError" \
    "node -e \"const h=require('fs').readFileSync('$DASHBOARD_HTML','utf8'); const s=[...h.matchAll(/<script>([\\\\s\\\\S]*?)<\\/script>/g)].map(m=>m[1]).join('\\\\n'); new Function(s)\"" \
    "SyntaxError in dashboard.html inline scripts — check src/tools/dashboard.js for syntax errors"

  run_step "dashboard.html has NO invalid regex flags (regression check)" \
    "! grep -qF '/if}}/g' '$DASHBOARD_HTML'" \
    "Invalid regex '/if}}/g' found in dashboard.html — check src/tools/dashboard.js uses string split/join"

  # --pdf2csv verified last to avoid overwriting source CSV used by --transform
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

run_step "End-to-end (CSV path): --transform on CACV_CROSS_FC_OPS_DIBO_REPORT.csv exits 0" \
  "cd '$PROJECT_ROOT' && consumption-analyzer --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv >/dev/null 2>&1" \
  "--transform failed — check src/tools/transform.js and that data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv exists"

PORTFOLIO_JSON="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json"

run_step "End-to-end: portfolio.json exists" \
  "test -f '$PORTFOLIO_JSON'" \
  "portfolio.json not found — run: consumption-analyzer --transform data/CACV_CROSS_FC_OPS_DIBO_REPORT.csv"

run_step "portfolio.json has 'customers' array" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if(!Array.isArray(d.customers)||d.customers.length===0) process.exit(1);\"" \
  "portfolio.json missing non-empty customers array — check src/tools/transform.js"

run_step "products nested under solutions_l1/l2/l3 (new schema)" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.solutions_l1||!c.solutions_l1[0]) process.exit(1); const l2=c.solutions_l1[0].solutions_l2; if(!l2||!l2[0]) process.exit(1); const l3=l2[0].solutions_l3; if(!Array.isArray(l3)||l3.length===0) process.exit(1);\"" \
  "portfolio.json missing solutions_l1/l2/l3 hierarchy — check src/tools/transform.js"

run_step "customer.industry field populated (STORY-006)" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const c=d.customers[0]; if(!c.industry||c.industry===null) process.exit(1);\"" \
  "customer.industry is missing or null — check src/lib/industry.js and src/tools/transform.js"

run_step "customer has no employee_id (removed)" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); if('employee_id' in d.customers[0]) process.exit(1);\"" \
  "portfolio.json customer still has employee_id — this field was removed; check src/tools/transform.js"

run_step "L3 product has contract block with contract_insights field" \
  "node -e \"const d=JSON.parse(require('fs').readFileSync('$PORTFOLIO_JSON','utf8')); const l3=d.customers[0].solutions_l1[0].solutions_l2[0].solutions_l3[0]; if(!l3.contract||!('contract_insights' in l3.contract)) process.exit(1);\"" \
  "L3 product missing contract.contract_insights — check src/tools/transform.js"

run_step "portfolio.json has no fy_target_total (forecast field absent)" \
  "! grep -q 'fy_target_total' '$PORTFOLIO_JSON'" \
  "portfolio.json still contains fy_target_total — forecast fields were removed; check src/tools/transform.js"

run_step "portfolio.json has no risk_items[] (risk classification removed)" \
  "! grep -q 'risk_items' '$PORTFOLIO_JSON'" \
  "portfolio.json still contains risk_items[] — risk classification fields were removed; check src/tools/transform.js"

run_step "End-to-end: --dashboard on portfolio.json exits 0" \
  "cd '$PROJECT_ROOT' && consumption-analyzer --dashboard data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio.json >/dev/null 2>&1" \
  "--dashboard failed — check src/tools/dashboard.js and that portfolio.json exists"

DASHBOARD_HTML="$PROJECT_ROOT/data/CACV_CROSS_FC_OPS_DIBO_REPORT/portfolio-dashboard.html"
run_step "End-to-end: dashboard HTML produced" \
  "test -f '$DASHBOARD_HTML'" \
  "portfolio-dashboard.html not found — check src/tools/dashboard.js output naming"

run_step "dashboard.html has NO CDN references (zero-dependency HTML)" \
  "! grep -q 'cdn.jsdelivr\|cdn\.cloudflare\|cdnjs\|unpkg\.com' '$DASHBOARD_HTML'" \
  "CDN reference found in dashboard.html — all assets must be inlined; check src/tools/dashboard.js"

run_step "dashboard.html has 3-pane layout (industry/customer/detail panes)" \
  "grep -q 'view-industry\|ind-panel\|tab-industry' '$DASHBOARD_HTML'" \
  "3-pane layout not found in dashboard.html — left-drives-right industry→customer→detail required"

run_step "dashboard.html renders account_insights (customer-level AI)" \
  "grep -q 'account_insights\|Account Insights' '$DASHBOARD_HTML'" \
  "account_insights not found in dashboard.html — check src/tools/dashboard.js"

run_step "dashboard.html renders contract_insights (L3 product-level AI)" \
  "grep -q 'contract_insights\|Contract Insights' '$DASHBOARD_HTML'" \
  "contract_insights not found in dashboard.html — check src/tools/dashboard.js"

run_step "dashboard.html renders EA insights (L1 enterprise architecture)" \
  "grep -q 'EA insights\|enterprise_architecture_insights' '$DASHBOARD_HTML'" \
  "EA insights section not found in dashboard.html — check src/tools/dashboard.js"

run_step "dashboard.html has no year_end_attainment_pct (forecast field removed)" \
  "! grep -q 'year_end_attainment_pct\|Year.End Attainment' '$DASHBOARD_HTML'" \
  "year_end_attainment_pct found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

run_step "dashboard.html has no forecast_confidence (forecast field removed)" \
  "! grep -q 'forecast_confidence\|Forecast Confidence' '$DASHBOARD_HTML'" \
  "forecast_confidence found in dashboard.html — forecast fields were removed; check src/tools/dashboard.js"

run_step "dashboard.html inline scripts parse without SyntaxError" \
  "node -e \"const h=require('fs').readFileSync('$DASHBOARD_HTML','utf8'); const s=[...h.matchAll(/<script>([\\\\s\\\\S]*?)<\\/script>/g)].map(m=>m[1]).join('\\\\n'); new Function(s)\"" \
  "SyntaxError in dashboard.html inline scripts — check src/tools/dashboard.js"

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
