# Gap — STORY-005: Dashboard — read projected annual fields

## Changes
Update dashboard.js to read the new projected_annual_* fields from L3 contract month records
instead of the now-removed customer.annual_contract_values rollup:

1. **Full-Year ACV cards** (industry summary + per-customer): derive from `ytd_annual_contract_value` (max per L3 per year, summed across L3s) — same as before, this is unchanged
2. **Full-Year Budget cards** (industry summary + per-customer): derive from `projected_annual_budget_contract_value` (take the value from the latest populated month for each L3 per year, sum across L3s)
3. **Full-Year Consumed cards**: derive from `projected_annual_consumed_contract_value` similarly
4. **Variance reads**: rename all reads of `acv_gap` → `ytd_acv_gap`, `budget_gap` → `ytd_budget_gap`, `budget_attainment` → `ytd_budget_attainment`
5. **Remove** all reads of `customer.annual_contract_values` — no longer present in portfolio.json
6. **Remove** all reads of `industry_insights[].aggregated_contracts` — no longer present

## Files affected
- `src/tools/dashboard.js` — removed customerAnnualBudget() and l1AnnualBudget(); added l3AnnualTotals(), l1AnnualTotals(), customerAnnualTotals() walking projected_annual_* fields; updated variance reads to ytd_* names; removed annual_contract_values key skip from contract iteration

## Side-effects on other stories
- None — STORY-004 produces the new fields; dashboard only reads

## Recommended spec update
- STORY-005 Criterion 4: update Full-Year ACV/Budget sourcing description
