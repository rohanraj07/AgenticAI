import { EventEmitter } from 'events';

export const EVENTS = {
  PROFILE_UPDATED:     'PROFILE_UPDATED',
  SIMULATION_UPDATED:  'SIMULATION_UPDATED',
  PORTFOLIO_UPDATED:   'PORTFOLIO_UPDATED',
  RISK_UPDATED:        'RISK_UPDATED',
  TAX_UPDATED:         'TAX_UPDATED',
  CASHFLOW_UPDATED:    'CASHFLOW_UPDATED',
  EXPLANATION_READY:   'EXPLANATION_READY',
  AGENT_STARTED:       'AGENT_STARTED',
  AGENT_COMPLETED:     'AGENT_COMPLETED',
  PLANNER_DECIDED:     'PLANNER_DECIDED',
  SESSION_UPDATED:     'SESSION_UPDATED',
};

/**
 * AppEventEmitter — central reactive event bus.
 * Backend emits events; the WS route listens and broadcasts to connected clients.
 */
export class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }

  emitProfileUpdated(sessionId, profile) {
    this.emit(EVENTS.PROFILE_UPDATED, { sessionId, profile });
  }

  emitSimulationUpdated(sessionId, simulation) {
    this.emit(EVENTS.SIMULATION_UPDATED, { sessionId, simulation });
  }

  emitPortfolioUpdated(sessionId, portfolio) {
    this.emit(EVENTS.PORTFOLIO_UPDATED, { sessionId, portfolio });
  }

  emitRiskUpdated(sessionId, risk) {
    this.emit(EVENTS.RISK_UPDATED, { sessionId, risk });
  }

  emitTaxUpdated(sessionId, tax) {
    this.emit(EVENTS.TAX_UPDATED, { sessionId, tax });
  }

  emitCashflowUpdated(sessionId, cashflow) {
    this.emit(EVENTS.CASHFLOW_UPDATED, { sessionId, cashflow });
  }

  emitExplanationReady(sessionId, explanation) {
    this.emit(EVENTS.EXPLANATION_READY, { sessionId, explanation });
  }

  emitAgentStarted(sessionId, agentName) {
    this.emit(EVENTS.AGENT_STARTED, { sessionId, agentName });
  }

  emitAgentCompleted(sessionId, agentName, latencyMs, output) {
    this.emit(EVENTS.AGENT_COMPLETED, { sessionId, agentName, latencyMs, output });
  }

  emitPlannerDecided(sessionId, plan) {
    this.emit(EVENTS.PLANNER_DECIDED, { sessionId, plan });
  }
}
