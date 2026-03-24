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
 *
 * v2 additions:
 *   - PriorityQueue for event coalescing when a cascade is already running
 *   - PARTIAL vs FULL recompute distinction (logged for observability)
 *   - _pendingCascades map prevents overlapping cascades per session
 */

import { computePortfolioAllocation }    from '../agents/compute/portfolio.compute.js';
import { computeRiskScore }              from '../agents/compute/risk.compute.js';
import { calculateRetirementProjection } from '../utils/financial.calculator.js';
import { EVENTS }                        from '../events/event.emitter.js';
import { PriorityQueue, EVENT_PRIORITY } from './priority.queue.js';
import { log }                           from '../logger.js';

// ── Dependency map ───────────────────────────────────────────────────────────

const DEPENDENCY_MAP = {
  [EVENTS.PROFILE_UPDATED]:    ['simulation', 'portfolio', 'risk'],
  [EVENTS.TAX_UPDATED]:        ['simulation'],
  [EVENTS.CASHFLOW_UPDATED]:   ['simulation'],
  [EVENTS.SIMULATION_UPDATED]: ['portfolio', 'risk'],
  [EVENTS.PORTFOLIO_UPDATED]:  ['risk'],
};

// ── Recompute type — FULL triggers all downstream; PARTIAL is scoped ──────────

/**
 * Whether an event triggers a full dependency cascade or a partial one.
 * Logged alongside the cascade for observability.
 * @type {Record<string, 'full'|'partial'>}
 */
const RECOMPUTE_TYPE = {
  PROFILE_UPDATED:    'full',    // recompute simulation → portfolio → risk
  TAX_UPDATED:        'partial', // recompute simulation only (tax signals affect savings rate)
  CASHFLOW_UPDATED:   'partial', // recompute simulation only (spending affects surplus)
  SIMULATION_UPDATED: 'partial', // recompute portfolio → risk
  PORTFOLIO_UPDATED:  'partial', // recompute risk only
};

// ── Deterministic compute functions (no LLM) ─────────────────────────────────

/**
 * Recompute retirement simulation from profile.
 * Returns the same shape as SimulationAgent.run() but without an LLM summary
 * (summary is left empty so the graph can fill it later).
 *
 * @param {object} state
 * @returns {object|null}
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
 *
 * @param {object} state
 * @returns {object|null}
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
 *
 * @param {object} state
 * @returns {object|null}
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

    /**
     * Priority queue — coalesces events that arrive while a cascade is running.
     * @type {PriorityQueue}
     */
    this._queue = new PriorityQueue();

    /**
     * Tracks in-progress cascades per session.
     * Key: sessionId, Value: triggering event name.
     * Prevents overlapping cascades for the same session.
     * @type {Map<string, string>}
     */
    this._pendingCascades = new Map();

    this._attach();
    log.info('[ReactiveEngine] initialised — dependency map active (v2: priority queue + partial/full recompute)');
  }

  // ── Event attachment ───────────────────────────────────────────────────────

  /**
   * Attach listeners for every event in DEPENDENCY_MAP.
   * If a cascade is already running for the session, the new event is
   * enqueued (with coalescing) and processed after the current cascade ends.
   *
   * @private
   */
  _attach() {
    for (const [event, downstream] of Object.entries(DEPENDENCY_MAP)) {
      this._emitter.on(event, ({ sessionId, ...payload }) => {
        const priority      = EVENT_PRIORITY[event] ?? 2;
        const recomputeType = RECOMPUTE_TYPE[event]  ?? 'partial';

        // If a cascade is already running for this session, enqueue instead
        if (this._pendingCascades.has(sessionId)) {
          this._queue.enqueue(event, sessionId, payload, priority);
          log.info(
            `[ReactiveEngine] queued ${event} (cascade in progress) session=${sessionId}`,
          );
          return;
        }

        this._runCascade(sessionId, event, downstream, recomputeType).catch((err) => {
          log.error(`[ReactiveEngine] cascade error: ${err.message}`);
        });
      });
    }
    log.info(`[ReactiveEngine] attached to events: [${Object.keys(DEPENDENCY_MAP).join(', ')}]`);
  }

  // ── Cascade orchestration ──────────────────────────────────────────────────

  /**
   * Run a cascade for the session, then drain any events that were queued
   * while it was running.
   *
   * @private
   * @param {string}   sessionId
   * @param {string}   event
   * @param {string[]} downstream
   * @param {string}   recomputeType  'full' | 'partial'
   */
  async _runCascade(sessionId, event, downstream, recomputeType) {
    this._pendingCascades.set(sessionId, event);
    try {
      await this._cascade(sessionId, event, downstream, recomputeType);

      // Drain any events that were enqueued for THIS session while cascading.
      // The full queue is drained but we only act on items for this session
      // (items for other sessions are left to their own cascade runs; here we
      // re-enqueue the others so they are not lost).
      const all     = this._queue.drain();
      const mine    = all.filter((e) => e.sessionId === sessionId);
      const others  = all.filter((e) => e.sessionId !== sessionId);

      // Re-enqueue items belonging to other sessions
      for (const item of others) {
        this._queue.enqueue(item.event, item.sessionId, item.payload, item.priority);
      }

      for (const item of mine) {
        const ds = DEPENDENCY_MAP[item.event];
        if (!ds) continue;
        const type = RECOMPUTE_TYPE[item.event] ?? 'partial';
        await this._cascade(sessionId, item.event, ds, type);
      }
    } finally {
      this._pendingCascades.delete(sessionId);
    }
  }

  // ── Cascade execution ──────────────────────────────────────────────────────

  /**
   * Re-compute each downstream agent in dependency order.
   * Agents are executed sequentially so later ones see updated upstream values.
   *
   * @private
   * @param {string}   sessionId
   * @param {string}   triggerEvent
   * @param {string[]} downstream
   * @param {string}   recomputeType  'full' | 'partial'
   */
  async _cascade(sessionId, triggerEvent, downstream, recomputeType = 'partial') {
    const typeLabel = recomputeType.toUpperCase();
    log.info(
      `[ReactiveEngine] ${triggerEvent} → ${typeLabel} cascade | ` +
      `agents=[${downstream.join(', ')}] session=${sessionId}`,
    );

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

  /**
   * Maps agent names to the corresponding EventEmitter emit method.
   * @private
   * @type {Record<string, Function>}
   */
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
