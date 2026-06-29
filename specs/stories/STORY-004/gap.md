# Gap — STORY-004: CSV to JSON transformation — projected annual fields

## Changes
Schema change to every L3 contract month record in portfolio.json:

1. **Rename variance fields** (breaking rename — all consumers must update):
   - `acv_gap` → `ytd_acv_gap`
   - `budget_gap` → `ytd_budget_gap`
   - `budget_attainment` → `ytd_budget_attainment`

2. **Add new per-month fields** (computed at transform time for each month record):
   - `projected_annual_budget_contract_value`: sum of `ytd_budget_contract_value` across ALL 12 months of the year for this L3 product
   - `projected_annual_consumed_contract_value`: sum of `ytd_consumed_contract_value` across ALL 12 months of the year for this L3 product

3. **Add new variance fields** (derived from projected annual values):
   - `projected_annual_acv_gap`: ytd_annual_contract_value − projected_annual_consumed_contract_value
   - `projected_annual_budget_gap`: projected_annual_budget_contract_value − projected_annual_consumed_contract_value
   - `projected_annual_budget_attainment`: (projected_annual_consumed_contract_value / projected_annual_budget_contract_value) × 100

4. **Remove** `customer.annual_contract_values` rollup field — dashboard derives full-year figures from L3 monthly projected fields instead

5. **Remove** `industry_insights[].aggregated_contracts` — dashboard derives industry-level figures from L3 data

## Files affected
- `src/tools/transform.js` — computeVariances() renamed fields; buildL1Hierarchy() adds projected_annual_* fields and stamped on every month record; buildCustomerAnnualContractValues() removed; annual_contract_values removed from customer object assembly; reconcilePortfolio() Check 3 removed; buildIndustryInsights() simplified (no aggregated_contracts rollup computed or emitted)
- `src/tools/verify.js` — Check A (annual_contract_values rollup) removed; Check B variance field names updated to ytd_acv_gap/ytd_budget_gap/ytd_budget_attainment; Check C (industry aggregated_contracts) removed
- `src/tools/analyze.js` — 3 variance field name references updated (ytd_ prefix); aggregated_contracts reference in runStep4() replaced with zero-valued fallback object
- `specs/architecture/contracts.md` — contract:contract-month-shape: renamed variances fields + new projected_annual_* fields; contract:customer-shape: annual_contract_values removed; contract:industry-insight-shape: aggregated_contracts removed
- `specs/architecture/data-model.md` — entity:contract_month: renamed fields + new projected_annual_* fields; entity:customer: annual_contract_values removed; entity:industry_insight: aggregated_contracts removed

## Side-effects on other stories
- STORY-005: dashboard.js must read new projected_annual_* fields and ytd_* variance names; Full-Year ACV/Budget cards now driven by projected_annual_* fields aggregated from L3; remove all reads of customer.annual_contract_values and industry aggregated_contracts

## Recommended spec update
- STORY-004 Criterion 3: update contract_month shape documentation with new/renamed fields
- contracts.md and data-model.md: update as described above
