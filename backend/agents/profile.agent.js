import { profileChain } from '../langchain/chains.js';

/**
 * ProfileAgent — extracts and maintains structured user financial profile.
 */
export class ProfileAgent {
  /**
   * @param {string} message
   * @param {string} memory   serialised session memory
   * @param {string} ragContext  retrieved RAG docs
   * @returns {Promise<object>}
   */
  async run(message, memory = '', ragContext = '') {
    const raw = await profileChain.invoke({ message, memory, ragContext });

    const profile = {
      name: raw.name || 'User',
      age: Number(raw.age) || 35,
      income: Number(raw.income) || 80000,
      savings: Number(raw.savings) || 200000,
      monthly_expenses: Number(raw.monthly_expenses) || 3500,
      retirement_age: Number(raw.retirement_age) || 65,
      risk_tolerance: raw.risk_tolerance || 'medium',
      goals: Array.isArray(raw.goals) ? raw.goals : [],
    };

    return profile;
  }
}
