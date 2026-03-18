import { plannerChain } from '../langchain/chains.js';

/**
 * PlannerAgent — orchestrator.
 * Decides which sub-agents to call and which UI components to render.
 */
export class PlannerAgent {
  /** @param {string} message @param {string} context @returns {Promise<object>} */
  async run(message, context = '') {
    const raw = await plannerChain.invoke({ message, context });

    // Ensure required fields exist
    const plan = {
      intent: raw.intent || 'Analyse financial question',
      agents: Array.isArray(raw.agents) ? raw.agents : ['profile', 'simulation', 'explanation'],
      ui: Array.isArray(raw.ui) ? raw.ui : [{ type: 'explanation_panel' }],
      params: raw.params || {},
    };

    return plan;
  }
}
