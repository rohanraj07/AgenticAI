import { simulationChain } from '../langchain/chains.js';
import { calculateRetirementProjection } from '../utils/financial.calculator.js';
import { log } from '../logger.js';

/**
 * SimulationAgent — retirement projection with deterministic math + LLM narrative.
 *
 * Pipeline:
 *  1. calculateRetirementProjection()  — pure JS math (compound interest, 4% SWR rule)
 *  2. simulationChain (LLM)            — writes summary text + milestone notes ONLY
 *
 * The LLM never calculates numbers. All projection values come from the calculator.
 */
export class SimulationAgent {
  /**
   * @param {object} profile
   * @param {string} message
   * @param {string} ragContext
   * @returns {Promise<object>}
   */
  async run(profile, message, ragContext = '') {
    // ── Step 1: Deterministic math ─────────────────────────────────────────
    const projection = calculateRetirementProjection(profile);
    const { _inputs } = projection;

    log.agent('SimulationAgent [1/2] deterministic projection');
    log.agent(`  Years to retirement: ${_inputs.yearsToRetirement}`);
    log.agent(`  Monthly savings: $${_inputs.monthlySavings.toLocaleString()}/mo`);
    log.agent(`  Annual contributions: $${_inputs.annualSavings.toLocaleString()}/yr`);
    log.agent(`  Projected savings: $${projection.projected_savings_at_retirement.toLocaleString()}`);
    log.agent(`  Required savings (25x rule): $${projection.required_savings_at_retirement.toLocaleString()}`);
    log.agent(`  Can retire at target: ${projection.can_retire_at_target}`);
    log.agent(`  Monthly ${projection.monthly_shortfall_or_surplus >= 0 ? 'surplus' : 'shortfall'}: $${Math.abs(projection.monthly_shortfall_or_surplus).toLocaleString()}`);

    // ── Step 2: LLM writes narrative only ─────────────────────────────────
    log.agent('SimulationAgent [2/2] LLM narrative generation');
    let narrative = { summary: '', milestone_notes: [] };
    try {
      narrative = await simulationChain.invoke({
        projection: JSON.stringify(projection, null, 2),
        profile:    JSON.stringify(profile, null, 2),
        message,
      });
    } catch (err) {
      log.warn(`SimulationAgent: narrative generation failed (${err.message}) — using fallback summary`);
      narrative.summary = projection.can_retire_at_target
        ? `Based on your profile, you are on track to retire at ${profile.retirement_age}. Your projected savings of $${projection.projected_savings_at_retirement.toLocaleString()} exceeds the $${projection.required_savings_at_retirement.toLocaleString()} required (25x annual expenses).`
        : `You have a savings gap of $${projection.savings_gap.toLocaleString()} to retire at ${profile.retirement_age}. Increasing monthly contributions from $${_inputs.monthlySavings.toLocaleString()} would help close this gap.`;
    }

    // ── Merge: attach LLM notes to calculator milestones ──────────────────
    const notes = Array.isArray(narrative.milestone_notes) ? narrative.milestone_notes : [];
    const milestones = projection.milestones.map((m, i) => ({
      ...m,
      note: notes[i] || '',
    }));

    return {
      can_retire_at_target:            projection.can_retire_at_target,
      projected_savings_at_retirement: projection.projected_savings_at_retirement,
      required_savings_at_retirement:  projection.required_savings_at_retirement,
      savings_gap:                     projection.savings_gap,
      monthly_shortfall_or_surplus:    projection.monthly_shortfall_or_surplus,
      years_of_runway:                 projection.years_of_runway,
      milestones,
      summary: narrative.summary || '',
      assumptions: {
        annual_return: _inputs.assumedAnnualReturn,
        withdrawal_rule: _inputs.withdrawalRule,
        monthly_savings: _inputs.monthlySavings,
        annual_savings:  _inputs.annualSavings,
      },
    };
  }
}
