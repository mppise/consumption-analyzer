## deployment:target
platform: local-npm
registry: none
registry_identifier: none

## deployment:services
- name: consumption-analyzer
  type: npm-binary
  entry: src/cli.js
  bin: consumption-analyzer
  install: deploy.sh (runs npm install + npm link)

- name: transform
  type: cli-subcommand
  entry: src/tools/transform.js
  invocation: consumption-analyzer --transform <input.csv>
  output: data/<source-basename>-portfolio.json
  scaling: n/a (local CLI, single process)
  port: null

- name: dashboard
  type: cli-subcommand
  entry: src/tools/dashboard.js
  invocation: consumption-analyzer --dashboard <portfolio.json>
  output: data/<source-basename>-dashboard.html
  scaling: n/a (local CLI, single process)
  port: null

## deployment:secrets
strategy: dotenv (.env file at project root, loaded via dotenv package)
vars:
  - DATA_DIR
  - LOG_LEVEL
  - PDF_MAX_PAGES
  - CSV_DELIMITER
  - AI_MODEL
  - AI_MAX_TOKENS
  - AI_API_KEY
  - AI_BASE_URL

## deployment:ingress
domain: none
https: false
load_balancer: none

## deployment:cicd
runner: deploy.sh
steps:
  - npm install
  - npm link
