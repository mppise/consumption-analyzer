// @story STORY-004 STORY-006 | transform industry-inference
// @intent deterministic industry vertical inference from customer name and product portfolio fingerprint — no AI, no external calls

/**
 * Infer the industry vertical for a customer based on their name and product portfolio.
 *
 * Rules are evaluated in priority order — first match wins.
 * Rule set as specified in STORY-006 story-spec.md:
 *   1. product contains "Traceability Hub" OR "Batch Release Hub" → "Pharma/Life Sciences"
 *   2. customer name matches pharma company list → "Pharma/Life Sciences"
 *   3. customer name matches health/medtech company list → "Healthcare/MedTech"
 *   4. product contains "Commerce Cloud" (no higher rule matched) → "Retail/Commerce"
 *   5. product contains "Watchlist Screening" AND Ariba present → "Financial Services"
 *   6. product contains "Watchlist Screening" (no Ariba) → "Manufacturing"
 *   7. Ariba present AND Concur present AND no higher-priority rule → "Manufacturing"
 *   8. fallback → "Unknown"
 *
 * @param {string} customerName — display name of the customer
 * @param {string[]} productNames — array of logical product names in the portfolio
 * @returns {string} industry vertical label
 */
// @contract input: customerName string, productNames string[] → output: industry string | errors: always returns at least "Unknown"
export function inferIndustry(customerName, productNames) {
  const name = (customerName ?? '').toLowerCase()
  const products = (productNames ?? []).map(p => (p ?? '').toLowerCase())

  // ---- Rule 1: Product fingerprint — pharma-specific products (highest specificity) ----
  // SAP Traceability Hub or Batch Release Hub → Pharma/Life Sciences
  if (products.some(p => p.includes('traceability hub') || p.includes('batch release hub'))) {
    return 'Pharma/Life Sciences'
  }

  // ---- Rule 2: Customer name — pharma company name patterns ----
  const pharmaTerms = [
    'abbvie', 'pfizer', 'novartis', 'roche', 'sanofi', 'bayer', 'merck',
    'astrazeneca', 'lilly', 'gsk', 'amgen', 'genentech', 'biogen',
    'regeneron', 'bms', 'bristol-myers', 'bristol myers', 'astellas',
  ]
  if (pharmaTerms.some(term => name.includes(term))) {
    return 'Pharma/Life Sciences'
  }

  // ---- Rule 3: Customer name — health/medtech company name patterns ----
  const healthTerms = [
    'cardinal health', 'medtronic', 'abbott', 'stryker', 'becton',
    'baxter', 'zimmer', 'boston scientific', 'edwards', 'hologic', 'intuitive',
  ]
  if (healthTerms.some(term => name.includes(term))) {
    return 'Healthcare/MedTech'
  }

  // ---- Rule 4: Product fingerprint — Commerce Cloud → Retail/Commerce ----
  if (products.some(p => p.includes('commerce cloud'))) {
    return 'Retail/Commerce'
  }

  // ---- Rule 5 & 6: Watchlist Screening — Ariba presence determines Financial vs Manufacturing ----
  const hasWatchlist = products.some(p => p.includes('watchlist screening'))
  const hasAriba = products.some(p => p.includes('ariba'))

  if (hasWatchlist && hasAriba) {
    return 'Financial Services'
  }

  if (hasWatchlist) {
    // Rule 6: Watchlist Screening without Ariba → Manufacturing
    return 'Manufacturing'
  }

  // ---- Rule 7: Ariba + Concur (no higher-priority rule matched) → Manufacturing ----
  const hasConcur = products.some(p => p.includes('concur'))
  if (hasAriba && hasConcur) {
    return 'Manufacturing'
  }

  // ---- Rule 8: Fallback ----
  return 'Unknown'
}
