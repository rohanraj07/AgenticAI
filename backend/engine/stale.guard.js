/**
 * StaleGuard — cancels in-flight cascade computations when a higher-priority
 * event supersedes them.
 *
 * Problem: A PORTFOLIO_UPDATED cascade is running for session X.
 * A PROFILE_UPDATED (higher priority) arrives for the same session.
 * The portfolio cascade result will be immediately overwritten by the full
 * PROFILE cascade anyway — running it to completion is wasted work.
 *
 * Solution: When a HIGH-priority event arrives for a session that already has
 * a cascade running at MEDIUM or LOW priority, the StaleGuard aborts the
 * running cascade via its AbortSignal and the new event runs fresh.
 *
 * Usage in ReactiveEngine:
 *   const signal = staleGuard.register(sessionId, EVENT_PRIORITY[event]);
 *   await _cascade(sessionId, event, downstream, recomputeType, signal);
 *   staleGuard.clear(sessionId);
 *
 * Each compute step in _cascade checks signal.aborted before proceeding.
 */

import { log } from '../logger.js';

export class StaleGuard {
  constructor() {
    /**
     * Map of sessionId → { controller: AbortController, priority: number }
     * @type {Map<string, { controller: AbortController, priority: number }>}
     */
    this._active = new Map();
  }

  /**
   * Register a new cascade for a session.
   *
   * If a cascade is already running for this session AND the incoming event
   * has a strictly higher priority (lower numeric value), the existing
   * cascade is cancelled and a fresh AbortController is returned.
   *
   * If the existing cascade has equal or higher priority, the incoming event
   * should be queued rather than cancelling the current one — this method
   * returns null to signal "do not proceed; enqueue instead".
   *
   * @param {string} sessionId
   * @param {number} incomingPriority  1=HIGH, 2=MEDIUM, 3=LOW
   * @returns {AbortSignal|null}
   *   AbortSignal to pass to the cascade (check signal.aborted between steps),
   *   or null if the caller should enqueue instead of running.
   */
  register(sessionId, incomingPriority) {
    const existing = this._active.get(sessionId);

    if (existing) {
      if (incomingPriority < existing.priority) {
        // Incoming is higher priority — cancel the running cascade
        existing.controller.abort();
        log.warn(
          `[StaleGuard] cancelled stale cascade (priority=${existing.priority}) ` +
          `for higher-priority event (priority=${incomingPriority}) session=${sessionId}`,
        );
      } else {
        // Same or lower priority — caller should enqueue, not cancel
        log.info(
          `[StaleGuard] cascade already running (priority=${existing.priority}), ` +
          `incoming priority=${incomingPriority} → enqueue session=${sessionId}`,
        );
        return null;
      }
    }

    const controller = new AbortController();
    this._active.set(sessionId, { controller, priority: incomingPriority });
    log.info(`[StaleGuard] registered cascade priority=${incomingPriority} session=${sessionId}`);
    return controller.signal;
  }

  /**
   * Clear the registration after a cascade completes normally.
   * Call this in the finally block of _runCascade.
   *
   * @param {string} sessionId
   */
  clear(sessionId) {
    this._active.delete(sessionId);
  }

  /**
   * Check whether the signal for a session is already aborted.
   * Convenience method for cascade step guards.
   *
   * @param {string} sessionId
   * @returns {boolean}
   */
  isAborted(sessionId) {
    return this._active.get(sessionId)?.controller.signal.aborted ?? false;
  }

  /**
   * Number of active cascades across all sessions.
   * @type {number}
   */
  get activeCount() {
    return this._active.size;
  }
}
