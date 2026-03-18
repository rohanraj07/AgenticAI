import { eventEmitter } from '../services.js';
import { EVENTS } from '../events/event.emitter.js';

/** Map sessionId → Set of WebSocket connections */
const sessionClients = new Map();

/**
 * Register all WebSocket handlers.
 * Clients subscribe by sending: { type: "subscribe", sessionId: "..." }
 */
export function setupWebSocket(wss) {
  wss.on('connection', (ws) => {
    let subscribedSession = null;

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === 'subscribe' && msg.sessionId) {
          subscribedSession = msg.sessionId;
          if (!sessionClients.has(subscribedSession)) {
            sessionClients.set(subscribedSession, new Set());
          }
          sessionClients.get(subscribedSession).add(ws);
          ws.send(JSON.stringify({ type: 'subscribed', sessionId: subscribedSession }));
        }

        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on('close', () => {
      if (subscribedSession && sessionClients.has(subscribedSession)) {
        sessionClients.get(subscribedSession).delete(ws);
      }
    });
  });

  // ── Wire reactive events → WebSocket broadcast ────────────────────────────

  function broadcast(sessionId, payload) {
    const clients = sessionClients.get(sessionId);
    if (!clients) return;
    const msg = JSON.stringify(payload);
    for (const client of clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(msg);
      }
    }
  }

  eventEmitter.on(EVENTS.PROFILE_UPDATED, ({ sessionId, profile }) => {
    broadcast(sessionId, { type: 'PROFILE_UPDATED', data: profile });
  });

  eventEmitter.on(EVENTS.SIMULATION_UPDATED, ({ sessionId, simulation }) => {
    broadcast(sessionId, { type: 'SIMULATION_UPDATED', data: simulation });
  });

  eventEmitter.on(EVENTS.PORTFOLIO_UPDATED, ({ sessionId, portfolio }) => {
    broadcast(sessionId, { type: 'PORTFOLIO_UPDATED', data: portfolio });
  });

  eventEmitter.on(EVENTS.RISK_UPDATED, ({ sessionId, risk }) => {
    broadcast(sessionId, { type: 'RISK_UPDATED', data: risk });
  });

  eventEmitter.on(EVENTS.EXPLANATION_READY, ({ sessionId, explanation }) => {
    broadcast(sessionId, { type: 'EXPLANATION_READY', data: explanation });
  });

  eventEmitter.on(EVENTS.AGENT_STARTED, ({ sessionId, agentName }) => {
    broadcast(sessionId, { type: 'AGENT_STARTED', agentName });
  });

  eventEmitter.on(EVENTS.AGENT_COMPLETED, ({ sessionId, agentName, output }) => {
    broadcast(sessionId, { type: 'AGENT_COMPLETED', agentName, output });
  });
}
