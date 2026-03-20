import { simulationChain } from '../langchain/chains.js';

/**
 * SimulationAgent — runs financial projections based on profile data.
 */
export class SimulationAgent {
  /**
   * @param {object} profile
   * @param {string} message
   * @param {string} ragContext
   * @returns {Promise<object>}
   */
  async run(profile, message, ragContext = '') {
    const raw = await simulationChain.invoke({
      profile: JSON.stringify(profile, null, 2),
      message,
      ragContext,
      currentYear: new Date().getFullYear(),
    });

    const simulation = {
      can_retire_at_target: Boolean(raw.can_retire_at_target),
      projected_savings_at_retirement: Number(raw.projected_savings_at_retirement) || 0,
      monthly_shortfall_or_surplus: Number(raw.monthly_shortfall_or_surplus) || 0,
      years_of_runway: Number(raw.years_of_runway) || 0,
      milestones: Array.isArray(raw.milestones) ? raw.milestones : [],
      summary: raw.summary || '',
    };

    return simulation;
  }
}
