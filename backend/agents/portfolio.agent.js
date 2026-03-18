import { portfolioChain } from '../langchain/chains.js';

/**
 * PortfolioAgent — recommends investment allocation based on profile + simulation.
 */
export class PortfolioAgent {
  /**
   * @param {object} profile
   * @param {object} simulation
   * @returns {Promise<object>}
   */
  async run(profile, simulation) {
    const raw = await portfolioChain.invoke({
      profile: JSON.stringify(profile, null, 2),
      simulation: JSON.stringify(simulation, null, 2),
      riskTolerance: profile?.risk_tolerance || 'medium',
    });

    const portfolio = {
      allocation: Array.isArray(raw.allocation) ? raw.allocation : [
        { asset: 'Equities', percent: 60 },
        { asset: 'Bonds', percent: 30 },
        { asset: 'Real Estate', percent: 5 },
        { asset: 'Cash', percent: 5 },
      ],
      strategy: raw.strategy || 'balanced',
      expected_annual_return_percent: Number(raw.expected_annual_return_percent) || 7,
      rebalance_frequency: raw.rebalance_frequency || 'annually',
      rationale: raw.rationale || '',
    };

    return portfolio;
  }
}
