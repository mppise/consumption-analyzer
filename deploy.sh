#!/usr/bin/env bash
# @story STORY-001 | cli-scaffold
# @intent install or reinstall the consumption-analyzer binary so it is available on PATH via npm link
# v3.0.0 — verifies all five tool flags: --pdf2csv, --analyze, --transform, --dashboard, --build-product-catalog

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "ConsumptionAnalyzer — deploy.sh"
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install

echo "Linking binary to PATH..."
npm link

echo ""
echo "Verifying all five tool flags appear in --help..."
HELP_OUTPUT=$(consumption-analyzer --help 2>&1 || true)

for FLAG in "--pdf2csv" "--analyze" "--transform" "--dashboard" "--build-product-catalog"; do
  if echo "$HELP_OUTPUT" | grep -q -- "$FLAG"; then
    echo "  [ok] $FLAG"
  else
    echo "  [FAIL] $FLAG not found in --help output"
    exit 1
  fi
done

echo ""
echo "Done. Run: consumption-analyzer --help"
