/**
 * ReactiveEngine — deterministic dependency-driven agent cascade.
 *
 * When upstream data changes (PROFILE_UPDATED, etc.) this engine automatically
 * re-computes all downstream agents WITHOUT calling an LLM.  The LLM is
 * reserved for explanation and narrative layers (handled by the graph).
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  Dependency Map                                                  │
 * │                                                                  │
 * │  PROFILE_UPDATED    → simulation, portfolio, risk               │
 * │  TAX_UPDATED        → simulation                                │
 * │  CASHFLOW_UPDATED   → simulation                                │
 * │  SIMULATION_UPDATED → portfolio, risk                           │
 * │  PORTFOLIO_UPDATED  → risk                                      │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Each re-computation is purely deterministic — calls compute functions
 * directly, never an LLM chain.  Existing LLM narrative (rationale,
 * factor descriptions) is preserved in the output.
 */

import { computePortfolioAllocation }    from '../agents/compute/portfolio.compute.js';
import { computeRiskScore }              from '../agents/compute/risk.compute.js';
import { calculateRetirementProjection } from '../utils/financial.calculator.js';
import { EVENTS }                        from '../events/event.emitter.js';
import { log }                           from '../logger.js';

// ── Dependency map ───────────────────────────────────────────────────────────

const DEPENDENCY_MAP = {
  [EVENTS.PROFILE_UPDATED]:    ['simulation', 'portfolio', 'risk'],
  [EVENTS.TAX_UPDATED]:        ['simulation'],
  [EVENTS.CASHFLOW_UPDATED]:   ['simulation'],
  [EVENTS.SIMULATION_UPDATED]: ['portfolio', 'risk'],
  [EVENTS.PORTFOLIO_UPDATED]:  ['risk'],
};

// ── Deterministic compute functions (no LLM) ─────────────────────────────────

/**
 * Recompute retirement simulation from profile.
 * Returns the same shape as SimulationAgent.run() but without an LLM summary
 * (summary is left empty so the graph can fill it later).
 */
function recomputeSimulation(state) {
  if (!state.profile) return null;

  const projection   = calculateRetirementProjection(state.profile);
  const { _inputs }  = projection;

  return {
    can_retire_at_target:            projection.can_retire_at_target,
    projected_savings_at_retirement: projection.projected_savings_at_retirement,
    required_savings_at_retirement:  projection.required_savings_at_retirement,
    savings_gap:                     projection.savings_gap,
    monthly_shortfall_or_surplus:    projection.monthly_shortfall_or_surplus,
    years_of_runway:                 projection.years_of_runway,
    milestones:                      projection.milestones.map((m) => ({ ...m, note: '' })),
    summary: state.simulation?.summary || '', // preserve any existing LLM summary
    assumptions: {
      annual_return:   _inputs.assumedAnnualReturn,
      withdrawal_rule: _inputs.withdrawalRule,
      monthly_savings: _inputs.monthlySavings,
      annual_savings:  _inputs.annualSavings,
    },
  };
}

/**
 * Recompute portfolio allocation from profile + simulation.
 * Preserves any existing LLM-generated rationale text.
 */
function recomputePortfolio(state) {
  if (!state.profile) return null;

  const computed = computePortfolioAllocation(state.profile, state.simulation);
  const { _inputs: _, ...publicComputed } = computed;

  return {
    ...publicComputed,
    rationale: state.portfolio?.rationale || '', // preserve LLM rationale
  };
}

/**
 * Recompute risk score from profile + portfolio + simulation.
 * Preserves any existing LLM-generated factor descriptions and mitigation steps.
 */
function recomputeRisk(state) {
  if (!state.profile || !state.portfolio) return null;

  const computed = computeRiskScore(state.profile, state.portfolio, state.simulation);
  const { _inputs: _, ...publicComputed } = computed;

  return {
    ...publicComputed,
    factors:          state.risk?.factors          || [], // preserve LLM descriptions
    mitigation_steps: state.risk?.mitigation_steps || [],
  };
}

const COMPUTE_FN = {
  simulation: recomputeSimulation,
  portfolio:  recomputePortfolio,
  risk:       recomputeRisk,
};

// ── ReactiveEngine ────────────────────────────────────────────────────────────

export class ReactiveEngine {
  /**
   * @param {import('./state.manager.js').StateManager}           stateManager
   * @param {import('../events/event.emitter.js').AppEventEmitter} eventEmitter
   * @param {import('../memory/redis.memory.js').RedisMemory}     redisMemory
   */
  constructor(stateManager, eventEmitter, redisMemory) {
    this._state   = stateManager;
    this._emitter = eventEmitter;
    this._redis   = redisMemory;
    this._attach();
    log.info('[ReactiveEngine] initialised — dependency map active');
  }

  // ── Event attachment ───────────────────────────────────────────────────────

  _attach() {
    for (const [event, downstream] of Object.entries(DEPENDENCY_MAP)) {
      this._emitter.on(event, ({ sessionId }) => {
        this._cascade(sessionId, event, downstream).catch((err) => {
          log.error(`[ReactiveEngine] cascade error | event=${event} session=${sessionId}: ${err.message}`);
        });
      });
    }
    log.info(`[ReactiveEngine] attached to events: [${Object.keys(DEPENDENCY_MAP).join(', ')}]`);
  }

  // ── Cascade execution ──────────────────────────────────────────────────────

  /**
   * Re-compute each downstream agent in dependency order.
   * Agents are executed sequentially so later ones see updated upstream values.
   *
   * @param {string}   sessionId
   * @param {string}   triggerEvent
   * @param {string[]} downstream
   */
  async _cascade(sessionId, triggerEvent, downstream) {
    log.info(`[ReactiveEngine] ${triggerEvent} → cascade=[${downstream.join(', ')}] session=${sessionId}`);

    // Work on a local copy of state; update it after each recompute so later
    // agents in the same cascade see the freshly computed upstream values.
    let state = this._state.get(sessionId);

    for (const agentName of downstream) {
      const fn = COMPUTE_FN[agentName];
      if (!fn) continue;

      const start  = Date.now();
      const result = fn(state);

      if (!result) {
        log.info(`[ReactiveEngine] skip ${agentName} — prerequisite state missing`);
        continue;
      }

      // Update in-memory state (so next agent in this loop sees updated values)
      state = this._state.update(sessionId, { [agentName]: result });

      // Persist to Redis for durability
      try {
        await this._redis.updateSession(sessionId, { [agentName]: result });
      } catch (err) {
        log.warn(`[ReactiveEngine] Redis persist failed for ${agentName}: ${err.message}`);
      }

      const ms = Date.now() - start;
      log.info(`[ReactiveEngine] ✔ ${agentName} recomputed (${ms}ms)`);

      // Emit event so WebSocket clients receive real-time push
      const emitFn = this._emitMap[agentName];
      if (emitFn) emitFn.call(this, sessionId, result);
    }
  }

  // ── Emit helpers ───────────────────────────────────────────────────────────

  get _emitMap() {
    return {
      simulation: (sid, v) => this._emitter.emitSimulationUpdated(sid, v),
      portfolio:  (sid, v) => this._emitter.emitPortfolioUpdated(sid, v),
      risk:       (sid, v) => this._emitter.emitRiskUpdated(sid, v),
    };
  }

  // ── Session seeding ────────────────────────────────────────────────────────

  /**
   * Seed the StateManager from an existing Redis session.
   * Call this after loading a session so the engine has a starting state
   * before any events fire.
   *
   * @param {string} sessionId
   * @param {object} session    full Redis session object
   */
  seedFromSession(sessionId, session) {
    this._state.seed(sessionId, session);
    log.info(`[ReactiveEngine] seeded session=${sessionId} from Redis`);
  }
}
