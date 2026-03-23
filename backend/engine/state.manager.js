/**
 * StateManager — per-session in-process central state store.
 *
 * Each session has a single mutable state object:
 *   { profile, simulation, portfolio, risk, tax, cashflow }
 *
 * All agents read from and write to this store through atomic merges so that
 * the ReactiveEngine always has the latest computed values when it cascades.
 *
 * Note: This is an in-process map. For multi-process or multi-instance
 * deployments, replace the _store with a Redis hash (same interface).
 */
import { log } from '../logger.js';

/**
 * Return an empty state shape — the canonical schema for a session.
 * @returns {object}
 */
export function emptyState() {
  return {
    profile:    null,
    simulation: null,
    portfolio:  null,
    risk:       null,
    tax:        null,
    cashflow:   null,
  };
}

export class StateManager {
  constructor() {
    /** @type {Map<string, object>} sessionId → state */
    this._store = new Map();
  }

  /**
   * Get current state for a session.
   * Returns an empty state object if the session has not been seeded yet.
   * @param {string} sessionId
   * @returns {object}
   */
  get(sessionId) {
    return this._store.get(sessionId) ?? emptyState();
  }

  /**
   * Merge a partial state patch atomically (last-write-wins per key).
   * Only keys present in patch are overwritten; all other keys are preserved.
   *
   * @param {string} sessionId
   * @param {object} patch      e.g. { profile: {...} } or { simulation: {...}, portfolio: {...} }
   * @returns {object}          the new full state after the merge
   */
  update(sessionId, patch) {
    const current = this.get(sessionId);
    const next    = { ...current, ...patch };
    this._store.set(sessionId, next);
    log.info(`[StateManager] session=${sessionId} patched keys=[${Object.keys(patch).join(', ')}]`);
    return next;
  }

  /**
   * Seed a session from a Redis session object.
   * Equivalent to calling update() for all known keys at once.
   * @param {string} sessionId
   * @param {object} session    full Redis session object
   */
  seed(sessionId, session) {
    this.update(sessionId, {
      profile:    session.profile    ?? null,
      simulation: session.simulation ?? null,
      portfolio:  session.portfolio  ?? null,
      risk:       session.risk       ?? null,
      tax:        session.tax        ?? null,
      cashflow:   session.cashflow   ?? null,
    });
  }

  /**
   * Clear all state for a session (call on session expiry or reset).
   * @param {string} sessionId
   */
  clear(sessionId) {
    this._store.delete(sessionId);
    log.info(`[StateManager] session=${sessionId} cleared`);
  }

  /**
   * Returns true if the session has been initialised.
   * @param {string} sessionId
   */
  has(sessionId) {
    return this._store.has(sessionId);
  }
}
