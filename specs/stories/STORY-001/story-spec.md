---
story_id: STORY-001
title: "CLI scaffold and entry point"
depends_on: []
reads:
  actors:    [operator]
  data:      [tool-invocation]
  contracts: [error-envelope, warn-envelope, tool-module]
  patterns:  [cli-dispatch, env-config, exit-code-contract]
---

## Criteria
1. `./deploy.sh` installs dependencies and links binary; `consumption-analyzer` available on PATH after run
2. `consumption-analyzer --help` exits 0; output lists all five tool flags: --pdf2csv, --analyze, --transform, --dashboard, --build-product-catalog
3. `consumption-analyzer` with no flags and no positional arg exits 1; contract:error-envelope written to stderr
4. `src/config/index.js` exports a frozen config with all 9 env vars (DATA_DIR, LOG_LEVEL, PDF_MAX_PAGES, CSV_DELIMITER, AI_MODEL, AI_MODEL_SENIOR, AI_MAX_TOKENS, AI_API_KEY, AI_BASE_URL) with defaults per pattern:env-config
5. `npm test` exits 0 against the scaffold test file with no failing assertions
6. dotenv loaded before any other logic in `src/cli.js`; importing the module does not throw
7. `consumption-analyzer --build-product-catalog` spawns `src/scripts/scrape-sap-products.js`; exit 0 on success, exit 2 on spawn failure
8. `consumption-analyzer <file.pdf|csv>` runs full pipeline; intermediates written to `data/<basename>/`; AI stage non-fatal (warn: on skip); exit 0 on success

## Interfaces
No HTTP endpoints. Entry point is the CLI binary.

  consumption-analyzer --help
    auth:     actor:operator (no auth — local binary)
    response: commander built-in help, all flags listed; exit 0

  consumption-analyzer [no flags, no positional]
    auth:     actor:operator
    response: contract:error-envelope to stderr; exit 1

  consumption-analyzer --<flag> <arg>
    auth:     actor:operator
    guard:    flag registered; dispatches via dynamic import() to tool module
    response: delegates to tool module per contract:tool-module; stdout/stderr per tool
    errors:   1 — UserError thrown · 2 — ProcessingError or unhandled throw

  consumption-analyzer --build-product-catalog
    auth:     actor:operator
    response: spawns src/scripts/scrape-sap-products.js with inherited stdio; exit 0
    errors:   2 — spawn error or child exits non-zero

  consumption-analyzer <file>
    auth:     actor:operator
    guard:    file exists; extension is .pdf or .csv
    response: runPipeline() — stages to data/<basename>/; progress to stderr; exit 0
    errors:   1 — file not found or bad extension · 2 — fatal pipeline stage failure

## Permissions
- actor:operator — all flags and positional pipeline; no auth checks

## State
- invoked → user-error (exit 1): trigger: no flag and no positional arg
- invoked → success (exit 0): trigger: any valid flag or positional file
- full machine: data:tool-invocation.state-machine

## Data
- owns: data:tool-invocation (creates one per run — exit_code populated on completion)
- reads: data:tool-invocation (flag, args, exit_code, error_message)
- new fields: none
