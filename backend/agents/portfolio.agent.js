import { portfolioRationaleChain } from '../langchain/chains.js';
import { computePortfolioAllocation } from './compute/portfolio.compute.js';
import { log } from '../logger.js';

/**
 * PortfolioAgent — deterministic allocation + LLM rationale narrative.
 *
 * Pipeline:
 *  1. computePortfolioAllocation()  — pure JS math (glide path, risk tolerance)
 *  2. portfolioRationaleChain (LLM) — writes rationale text ONLY
 *
 * The LLM never determines allocation percentages, strategy labels, or
 * expected return figures. All numbers come from the compute function.
 */
export class PortfolioAgent {
  /**
   * @param {object} profile     { age, retirement_age, risk_tolerance }
   * @param {object} simulation  { savings_gap, can_retire_at_target }
   * @returns {Promise<object>}
   */
  async run(profile, simulation) {
    // ── Step 1: Deterministic allocation ──────────────────────────────────
    const computed = computePortfolioAllocation(profile, simulation);
    const { _inputs } = computed;

    log.agent('PortfolioAgent [1/2] deterministic allocation');
    log.agent(`  Strategy:  ${computed.strategy}`);
    log.agent(`  Equities:  ${_inputs.equityPercent}% | Glide: ${_inputs.glidePath}`);
    log.agent(`  Return:    ${computed.expected_annual_return_percent}% expected`);
    log.agent(`  Rebalance: ${computed.rebalance_frequency}`);

    // ── Step 2: LLM writes rationale text only ─────────────────────────────
    log.agent('PortfolioAgent [2/2] LLM rationale generation');
    let rationale = '';
    try {
      rationale = await portfolioRationaleChain.invoke({
        allocation:      JSON.stringify(computed.allocation, null, 2),
        strategy:        computed.strategy,
        expected_return: computed.expected_annual_return_percent,
        profile:         JSON.stringify(profile, null, 2),
        simulation:      JSON.stringify(simulation, null, 2),
      });
    } catch (err) {
      log.warn(`PortfolioAgent: rationale generation failed (${err.message}) — using fallback`);
      rationale = `Based on your ${_inputs.riskTolerance} risk tolerance with ${_inputs.yearsToRetirement} years to retirement, a ${computed.strategy} allocation (${_inputs.equityPercent}% equities) is recommended. The glide path is set to ${_inputs.glidePath}.`;
    }

    const { _inputs: _, ...publicComputed } = computed;
    return { ...publicComputed, rationale };
  }
}
