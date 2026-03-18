import { EventEmitter } from 'events';

export const EVENTS = {
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  SIMULATION_UPDATED: 'SIMULATION_UPDATED',
  PORTFOLIO_UPDATED: 'PORTFOLIO_UPDATED',
  RISK_UPDATED: 'RISK_UPDATED',
  EXPLANATION_READY: 'EXPLANATION_READY',
  AGENT_STARTED: 'AGENT_STARTED',
  AGENT_COMPLETED: 'AGENT_COMPLETED',
  SESSION_UPDATED: 'SESSION_UPDATED',
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

  emitExplanationReady(sessionId, explanation) {
    this.emit(EVENTS.EXPLANATION_READY, { sessionId, explanation });
  }

  emitAgentStarted(sessionId, agentName) {
    this.emit(EVENTS.AGENT_STARTED, { sessionId, agentName });
  }

  emitAgentCompleted(sessionId, agentName, output) {
    this.emit(EVENTS.AGENT_COMPLETED, { sessionId, agentName, output });
  }
}
