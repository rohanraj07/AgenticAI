import { riskNarrativeChain } from '../langchain/chains.js';
import { computeRiskScore } from './compute/risk.compute.js';
import { log } from '../logger.js';

/**
 * RiskAgent — deterministic risk scoring + LLM factor narrative.
 *
 * Pipeline:
 *  1. computeRiskScore()       — pure JS math (equity concentration, time
 *                                horizon, savings gap → score 1-10 + stress test)
 *  2. riskNarrativeChain (LLM) — writes factor descriptions + mitigation steps ONLY
 *
 * The LLM never assigns the numeric risk score or stress test numbers.
 * All values come from the compute function.
 */
export class RiskAgent {
  /**
   * @param {object} profile     { age, retirement_age }
   * @param {object} portfolio   { allocation }
   * @param {object} simulation  { savings_gap, projected_savings_at_retirement }
   * @returns {Promise<object>}
   */
  async run(profile, portfolio, simulation = {}) {
    // ── Step 1: Deterministic scoring ─────────────────────────────────────
    const computed = computeRiskScore(profile, portfolio, simulation);
    const { _inputs } = computed;

    log.agent('RiskAgent [1/2] deterministic scoring');
    log.agent(`  Score: ${computed.overall_risk_score}/10 | Level: ${computed.risk_level}`);
    log.agent(`  Factors → equity: ${_inputs.equityRisk}/3 | time: ${_inputs.timeRisk}/3 | gap: ${_inputs.gapRisk}/3`);
    log.agent(`  Stress test → crash: $${Math.abs(computed.stress_test.market_crash_20pct_impact).toLocaleString()} | inflation: $${Math.abs(computed.stress_test.inflation_spike_impact).toLocaleString()}`);

    // ── Step 2: LLM writes factor descriptions + mitigation steps only ─────
    log.agent('RiskAgent [2/2] LLM risk narrative generation');
    let factors          = [];
    let mitigation_steps = [];
    try {
      const narrative = await riskNarrativeChain.invoke({
        risk_score:      computed.overall_risk_score,
        risk_level:      computed.risk_level,
        equity_pct:      _inputs.equityPct,
        years_to_retire: _inputs.yearsToRetire,
        savings_gap:     _inputs.savingsGap,
        profile:         JSON.stringify(profile, null, 2),
        portfolio:       JSON.stringify(portfolio, null, 2),
      });
      factors          = Array.isArray(narrative.factors)          ? narrative.factors          : [];
      mitigation_steps = Array.isArray(narrative.mitigation_steps) ? narrative.mitigation_steps : [];
    } catch (err) {
      log.warn(`RiskAgent: narrative generation failed (${err.message}) — using fallback factors`);
      factors = [
        {
          factor:      'Equity Concentration',
          impact:      _inputs.equityRisk >= 3 ? 'high' : 'medium',
          description: `Portfolio holds ${_inputs.equityPct}% in equities.`,
        },
        {
          factor:      'Time Horizon',
          impact:      _inputs.timeRisk >= 3 ? 'high' : 'medium',
          description: `${_inputs.yearsToRetire} years remaining until target retirement age.`,
        },
      ];
      if (_inputs.savingsGap > 0) {
        factors.push({
          factor:      'Savings Gap',
          impact:      _inputs.gapRisk >= 3 ? 'high' : 'medium',
          description: `$${_inputs.savingsGap.toLocaleString()} shortfall to retirement target.`,
        });
        mitigation_steps.push('Increase monthly savings contributions to close the retirement gap.');
      }
      mitigation_steps.push('Maintain diversified portfolio and rebalance on schedule.');
    }

    const { _inputs: _, ...publicComputed } = computed;
    return { ...publicComputed, factors, mitigation_steps };
  }
}
