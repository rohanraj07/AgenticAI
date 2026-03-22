import { plannerChain } from '../langchain/chains.js';
import { log } from '../logger.js';

const SAFE_DEFAULT_PLAN = {
  intent: 'Provide general financial guidance',
  required_agents: ['profile', 'simulation', 'explanation'],
  optional_agents: [],
  missing_data: [],
  confidence: 'low',
  decision_rationale: 'Using safe default plan — planner chain failed or returned invalid output.',
  agents: ['profile', 'simulation', 'explanation'],
  ui: [
    { type: 'profile_summary' },
    { type: 'simulation_chart' },
    { type: 'explanation_panel' },
  ],
  params: {},
};

/**
 * PlannerAgent — orchestrator.
 * Decides which sub-agents to call and which UI components to render.
 *
 * Guardrails applied after LLM output:
 *  - "explanation" is always present
 *  - "portfolio" requires "simulation"
 *  - "risk" requires "portfolio"
 *  - If chain fails, returns SAFE_DEFAULT_PLAN (never throws)
 */
export class PlannerAgent {
  /**
   * @param {string} message
   * @param {string} context        Session context string
   * @param {object} sessionMeta    { profileExists: bool, simulationExists: bool }
   * @returns {Promise<object>}
   */
  async run(message, context = '', sessionMeta = {}) {
    const profileExists   = sessionMeta.profileExists   ? 'yes' : 'no';
    const simulationExists = sessionMeta.simulationExists ? 'yes' : 'no';

    let raw;
    try {
      raw = await plannerChain.invoke({ message, context, profileExists, simulationExists });
    } catch (err) {
      log.agent(`PlannerAgent: chain failed — ${err.message}. Returning safe default plan.`);
      return { ...SAFE_DEFAULT_PLAN };
    }

    if (!raw || typeof raw !== 'object') {
      log.agent('PlannerAgent: chain returned non-object. Returning safe default plan.');
      return { ...SAFE_DEFAULT_PLAN };
    }

    // Build agent list — start from LLM output, apply guardrails
    const agents = Array.isArray(raw.agents) ? [...raw.agents] : [...SAFE_DEFAULT_PLAN.agents];

    // Guardrail: explanation is always last
    if (!agents.includes('explanation')) agents.push('explanation');

    // Guardrail: portfolio requires simulation
    if (agents.includes('portfolio') && !agents.includes('simulation')) {
      agents.splice(agents.indexOf('portfolio'), 0, 'simulation');
    }

    // Guardrail: risk requires portfolio (which requires simulation)
    if (agents.includes('risk') && !agents.includes('portfolio')) {
      const riskIdx = agents.indexOf('risk');
      if (!agents.includes('simulation')) agents.splice(riskIdx, 0, 'simulation');
      agents.splice(agents.indexOf('risk'), 0, 'portfolio');
    }

    const plan = {
      intent:            raw.intent            || SAFE_DEFAULT_PLAN.intent,
      required_agents:   Array.isArray(raw.required_agents)  ? raw.required_agents  : agents,
      optional_agents:   Array.isArray(raw.optional_agents)  ? raw.optional_agents  : [],
      missing_data:      Array.isArray(raw.missing_data)      ? raw.missing_data      : [],
      confidence:        raw.confidence        || 'medium',
      decision_rationale: raw.decision_rationale || '',
      agents,
      ui:     Array.isArray(raw.ui) ? raw.ui : [{ type: 'explanation_panel' }],
      params: raw.params || {},
    };

    log.agent(`PlannerAgent: intent="${plan.intent}" | confidence=${plan.confidence}`);
    log.agent(`  agents: [${plan.agents.join(', ')}] | missing_data: [${plan.missing_data.join(', ')}]`);
    if (plan.decision_rationale) log.agent(`  rationale: ${plan.decision_rationale}`);

    return plan;
  }
}
