import { EventEmitter } from 'events';

/**
 * All application event names.
 * CONFLICT_RESOLVED is emitted by the ConflictResolver when a field value is
 * overwritten by a higher-authority source.
 */
export const EVENTS = {
  PROFILE_UPDATED:    'PROFILE_UPDATED',
  SIMULATION_UPDATED: 'SIMULATION_UPDATED',
  PORTFOLIO_UPDATED:  'PORTFOLIO_UPDATED',
  RISK_UPDATED:       'RISK_UPDATED',
  TAX_UPDATED:        'TAX_UPDATED',
  CASHFLOW_UPDATED:   'CASHFLOW_UPDATED',
  EXPLANATION_READY:  'EXPLANATION_READY',
  AGENT_STARTED:      'AGENT_STARTED',
  AGENT_COMPLETED:    'AGENT_COMPLETED',
  PLANNER_DECIDED:    'PLANNER_DECIDED',
  SESSION_UPDATED:    'SESSION_UPDATED',
  CONFLICT_RESOLVED:  'CONFLICT_RESOLVED',
};

/**
 * AppEventEmitter — central reactive event bus.
 * Backend emits events; the WS route listens and broadcasts to connected clients.
 *
 * v2: every payload now includes a `priority` field and a `timestamp` field
 * so consumers can make scheduling decisions without needing a lookup table.
 */
export class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  /**
   * @param {string} sessionId
   * @param {object} profile
   */
  emitProfileUpdated(sessionId, profile) {
    this.emit(EVENTS.PROFILE_UPDATED, {
      sessionId,
      profile,
      priority:  'HIGH',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} simulation
   */
  emitSimulationUpdated(sessionId, simulation) {
    this.emit(EVENTS.SIMULATION_UPDATED, {
      sessionId,
      simulation,
      priority:  'MEDIUM',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} portfolio
   */
  emitPortfolioUpdated(sessionId, portfolio) {
    this.emit(EVENTS.PORTFOLIO_UPDATED, {
      sessionId,
      portfolio,
      priority:  'MEDIUM',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} risk
   */
  emitRiskUpdated(sessionId, risk) {
    this.emit(EVENTS.RISK_UPDATED, {
      sessionId,
      risk,
      priority:  'LOW',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} tax
   */
  emitTaxUpdated(sessionId, tax) {
    this.emit(EVENTS.TAX_UPDATED, {
      sessionId,
      tax,
      priority:  'MEDIUM',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} cashflow
   */
  emitCashflowUpdated(sessionId, cashflow) {
    this.emit(EVENTS.CASHFLOW_UPDATED, {
      sessionId,
      cashflow,
      priority:  'MEDIUM',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} explanation
   */
  emitExplanationReady(sessionId, explanation) {
    this.emit(EVENTS.EXPLANATION_READY, {
      sessionId,
      explanation,
      priority:  'LOW',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {string} agentName
   */
  emitAgentStarted(sessionId, agentName) {
    this.emit(EVENTS.AGENT_STARTED, {
      sessionId,
      agentName,
      priority:  'LOW',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {string} agentName
   * @param {number} latencyMs
   * @param {object} output
   */
  emitAgentCompleted(sessionId, agentName, latencyMs, output) {
    this.emit(EVENTS.AGENT_COMPLETED, {
      sessionId,
      agentName,
      latencyMs,
      output,
      priority:  'LOW',
      timestamp: Date.now(),
    });
  }

  /**
   * @param {string} sessionId
   * @param {object} plan
   */
  emitPlannerDecided(sessionId, plan) {
    this.emit(EVENTS.PLANNER_DECIDED, {
      sessionId,
      plan,
      priority:  'LOW',
      timestamp: Date.now(),
    });
  }

  /**
   * Emitted when the ConflictResolver overwrites an existing field value with
   * a higher-authority source.  Useful for audit trails and UI provenance display.
   *
   * @param {string} sessionId
   * @param {string} field    Profile field name that was resolved
   * @param {object} winner   Winning candidate: { value, source, confidence, timestamp }
   * @param {object} loser    Losing candidate:  { value, source, confidence, timestamp }
   */
  emitConflictResolved(sessionId, field, winner, loser) {
    this.emit(EVENTS.CONFLICT_RESOLVED, {
      sessionId,
      field,
      winner,
      loser,
      timestamp: Date.now(),
    });
  }
}
