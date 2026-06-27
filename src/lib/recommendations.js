// @story STORY-004 | transform
// @intent static map of risk level → recommendation block (who, message, urgency action, steps) — no AI, fully deterministic

import { RISK } from './risk.js'

/**
 * Static recommendation map keyed by risk level.
 * Each entry conforms to contract:dashboard-recommendation.
 */
const RECOMMENDATION_MAP = {
  [RISK.CRITICAL]: {
    who_to_speak_to: ['CSM', 'MU Lead', 'Executive Sponsor'],
    message_template: 'Critical consumption gap — immediate intervention required',
    urgency_action: 'Escalate to executive sponsor within 48 hours',
    suggested_actions: [
      'Identify root cause of non-utilization',
      'Schedule emergency enablement session',
      'Review contract terms and renewal timeline',
      'Engage SAP support for adoption resources',
      'Set weekly check-in cadence',
    ],
  },
  [RISK.HIGH]: {
    who_to_speak_to: ['CSM', 'MU Lead'],
    message_template: 'Consumption below target — adoption action needed',
    urgency_action: 'Schedule stakeholder review within 2 weeks',
    suggested_actions: [
      'Review adoption blockers with customer',
      'Deliver targeted training/enablement',
      'Align with customer project timeline',
      'Set monthly consumption review',
      'Identify quick-win use cases',
    ],
  },
  [RISK.MEDIUM]: {
    who_to_speak_to: ['CSM'],
    message_template: 'Consumption trending below target — monitor and nudge',
    urgency_action: 'Check in with customer within 30 days',
    suggested_actions: [
      'Review feature utilization',
      'Share best practices and benchmarks',
      'Identify expansion opportunities',
      'Document progress in success plan',
    ],
  },
  [RISK.LOW]: {
    who_to_speak_to: ['CSM'],
    message_template: 'On track — minor optimization opportunity',
    urgency_action: 'Include in next regular check-in',
    suggested_actions: [
      'Acknowledge progress',
      'Identify stretch goals',
      'Document for QBR',
    ],
  },
  [RISK.ON_TRACK]: {
    who_to_speak_to: [],
    message_template: 'Meeting or exceeding targets — strong consumption',
    urgency_action: 'Highlight as success story',
    suggested_actions: [
      'Document for case study',
      'Explore expansion opportunities',
    ],
  },
  [RISK.NO_DATA]: {
    who_to_speak_to: ['CSM', 'EA'],
    message_template: 'No consumption data available — verify deployment',
    urgency_action: 'Confirm product is deployed and in use',
    suggested_actions: [
      'Verify technical setup',
      'Check data reporting pipeline',
      'Confirm contract entitlements',
    ],
  },
}

/**
 * Return the recommendation block for a given risk level and product.
 *
 * @param {string} productId
 * @param {string} riskLevel — one of RISK.*
 * @returns {object} — contract:dashboard-recommendation shape
 */
// @contract input: productId string, riskLevel RISK.* → output: dashboard-recommendation object | errors: falls back to NO_DATA if level unknown
export function getRecommendation(productId, riskLevel) {
  const base = RECOMMENDATION_MAP[riskLevel] ?? RECOMMENDATION_MAP[RISK.NO_DATA]
  return {
    product_id: productId,
    risk_level: riskLevel,
    ...base,
  }
}
