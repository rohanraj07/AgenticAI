import { explanationChain } from '../langchain/chains.js';

/**
 * ExplanationAgent — produces human-readable financial narrative.
 */
export class ExplanationAgent {
  /**
   * @param {object} profile
   * @param {object} simulation
   * @param {object} portfolio
   * @param {object} risk
   * @param {string} message
   * @returns {Promise<string>}
   */
  async run(profile, simulation, portfolio, risk, message) {
    const explanation = await explanationChain.invoke({
      profile: JSON.stringify(profile, null, 2),
      simulation: JSON.stringify(simulation, null, 2),
      portfolio: JSON.stringify(portfolio, null, 2),
      risk: JSON.stringify(risk, null, 2),
      message,
    });

    return explanation;
  }
}
