import { riskChain } from '../langchain/chains.js';

/**
 * RiskAgent — scores financial risk and provides mitigation steps.
 */
export class RiskAgent {
  /**
   * @param {object} profile
   * @param {object} portfolio
   * @returns {Promise<object>}
   */
  async run(profile, portfolio) {
    const raw = await riskChain.invoke({
      profile: JSON.stringify(profile, null, 2),
      portfolio: JSON.stringify(portfolio, null, 2),
    });

    const risk = {
      overall_risk_score: Number(raw.overall_risk_score) || 5,
      risk_level: raw.risk_level || 'medium',
      factors: Array.isArray(raw.factors) ? raw.factors : [],
      mitigation_steps: Array.isArray(raw.mitigation_steps) ? raw.mitigation_steps : [],
      stress_test: raw.stress_test || {
        market_crash_20pct_impact: 0,
        inflation_spike_impact: 0,
      },
    };

    return risk;
  }
}
