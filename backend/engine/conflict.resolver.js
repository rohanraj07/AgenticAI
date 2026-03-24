/**
 * ConflictResolver — data source precedence and confidence scoring.
 *
 * When the same profile field arrives from multiple sources (document upload,
 * user statement, LLM inference, system default) this resolver applies a
 * deterministic hierarchy to decide which value wins.
 *
 * Source precedence (highest → lowest):
 *   document_extracted (4) > user_stated (3) > inferred (2) > default (1)
 *
 * Tie-breaking within the same source rank:
 *   1. Higher confidence score wins
 *   2. More recent timestamp wins
 */

import { log } from '../logger.js';

// ── Source rank table ─────────────────────────────────────────────────────────

/**
 * Numeric rank for each recognised data source.
 * Higher number = higher authority.
 * @type {Record<string, number>}
 */
const SOURCE_RANK = {
  document_extracted: 4, // highest — from uploaded document
  user_stated:        3, // user typed explicitly
  inferred:           2, // LLM inferred from context
  default:            1, // fallback / system default
};

/**
 * Fields considered mandatory for a complete profile.
 * Used by scoreDataQuality to detect missing high-importance data.
 */
const CRITICAL_FIELDS    = ['income', 'retirement_age'];
const FULL_PROFILE_FIELDS = [
  'name', 'age', 'income', 'retirement_age',
  'current_savings', 'monthly_savings', 'risk_tolerance',
];

// ── ConflictResolver ──────────────────────────────────────────────────────────

export class ConflictResolver {
  // ── Field-level resolution ─────────────────────────────────────────────────

  /**
   * Given multiple candidate values for a single profile field, return the
   * winning candidate according to source rank → confidence → recency.
   *
   * @param {string} fieldName  Name of the field being resolved (for logging)
   * @param {Array<{value: *, source: string, confidence: number, timestamp: number}>} candidates
   * @returns {{value: *, source: string, confidence: number, timestamp: number}|undefined}
   *          The winning candidate, or undefined if the candidates array is empty.
   */
  resolveField(fieldName, candidates) {
    if (!Array.isArray(candidates) || candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];

    const winner = candidates.reduce((best, current) => {
      const bestRank    = SOURCE_RANK[best.source]    ?? 0;
      const currentRank = SOURCE_RANK[current.source] ?? 0;

      if (currentRank > bestRank) return current;
      if (currentRank < bestRank) return best;

      // Same source rank — compare confidence
      if ((current.confidence ?? 0) > (best.confidence ?? 0)) return current;
      if ((current.confidence ?? 0) < (best.confidence ?? 0)) return best;

      // Same confidence — most recent wins
      return (current.timestamp ?? 0) >= (best.timestamp ?? 0) ? current : best;
    });

    log.info(
      `[ConflictResolver] field="${fieldName}" resolved → source=${winner.source} confidence=${winner.confidence}`,
    );

    return winner;
  }

  // ── Profile-level merge ────────────────────────────────────────────────────

  /**
   * Merge an incoming partial profile into an existing profile.
   *
   * For each field present in `incoming`:
   *   - The existing value (treated as `inferred` if no provenance metadata is
   *     available) and the new value are compared via resolveField.
   *   - The winner's raw value is written to the returned profile.
   *
   * Returns a clean profile object (no provenance metadata).
   *
   * @param {object} existing        Current profile object (may be null/undefined)
   * @param {object} incoming        New partial profile to merge in
   * @param {string} incomingSource  Data source for all incoming fields
   *                                 (one of document_extracted | user_stated | inferred | default)
   * @returns {object}  Merged profile (provenance metadata stripped)
   */
  mergeProfiles(existing, incoming, incomingSource = 'inferred') {
    const base   = existing  ? { ...existing  } : {};
    const update = incoming  ? { ...incoming  } : {};
    const result = { ...base };

    const now = Date.now();

    for (const [field, incomingValue] of Object.entries(update)) {
      if (incomingValue === undefined || incomingValue === null) continue;

      const existingCandidate = base[field] !== undefined && base[field] !== null
        ? {
            value:      base[field],
            source:     'inferred',       // conservative: treat existing as inferred
            confidence: 0.5,
            timestamp:  0,                // existing has no timestamp — treat as old
          }
        : null;

      const incomingCandidate = {
        value:      incomingValue,
        source:     incomingSource,
        confidence: SOURCE_RANK[incomingSource] ? SOURCE_RANK[incomingSource] * 0.25 : 0.5,
        timestamp:  now,
      };

      const candidates = existingCandidate
        ? [existingCandidate, incomingCandidate]
        : [incomingCandidate];

      const winner = this.resolveField(field, candidates);
      result[field] = winner?.value;
    }

    log.info(
      `[ConflictResolver] mergeProfiles complete — source=${incomingSource} fields=[${Object.keys(update).join(', ')}]`,
    );

    return result;
  }

  // ── Data quality scoring ───────────────────────────────────────────────────

  /**
   * Score the completeness/quality of a profile on a 0.0–1.0 scale.
   *
   * Scoring rules:
   *   - Start at 1.0
   *   - Each missing field from FULL_PROFILE_FIELDS deducts an equal share
   *   - Missing critical fields (income, retirement_age) add an extra 0.15 deduction each
   *   - Result is clamped to [0.0, 1.0]
   *
   * @param {object} profile
   * @returns {number}  Quality score in [0.0, 1.0]
   */
  scoreDataQuality(profile) {
    if (!profile || typeof profile !== 'object') return 0.0;

    const totalFields = FULL_PROFILE_FIELDS.length;        // 7
    const baseDeduction = 1.0 / totalFields;               // ~0.143 per field

    let score = 1.0;

    for (const field of FULL_PROFILE_FIELDS) {
      const missing =
        profile[field] === undefined ||
        profile[field] === null      ||
        profile[field] === '';

      if (missing) {
        score -= baseDeduction;
        // Extra penalty for critical fields
        if (CRITICAL_FIELDS.includes(field)) {
          score -= 0.15;
        }
      }
    }

    const clamped = Math.max(0.0, Math.min(1.0, score));
    log.info(`[ConflictResolver] scoreDataQuality → ${clamped.toFixed(3)}`);
    return clamped;
  }
}
