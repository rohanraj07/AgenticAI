/**
 * SchemaValidator — enforces the PII-safe Redis storage schema.
 *
 * RULE: Raw numeric PII (exact income, exact expenses, SSN, account numbers)
 * must NEVER be stored in Redis.  Only abstracted range labels are permitted.
 *
 * This validator is called by RedisMemory.updateSession() BEFORE every write.
 * If a violation is detected the write is blocked and an error is thrown so
 * that the bug surfaces immediately rather than silently persisting PII.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │  Safe Redis schema (what IS allowed)                                │
 * │                                                                     │
 * │  profile:    { name, age, savings, retirement_age, risk_tolerance,  │
 * │                goals, income_range?, expense_level? }               │
 * │                ← user-stated income (typed in chat) is allowed as  │
 * │                  a raw number because the user consciously provided │
 * │                  it; document-extracted income must be a label.     │
 * │                                                                     │
 * │  documentInsights: {                                                │
 * │    tax:      { income_range, tax_bracket, effective_rate,           │
 * │                deductions_level, ... }      ← NO raw grossIncome   │
 * │    cashflow: { budget_health, savings_rate_label, spending_level }  │
 * │                                             ← NO raw monthlySpend  │
 * │  }                                                                  │
 * │                                                                     │
 * │  FORBIDDEN at any depth in documentInsights:                        │
 * │    grossIncome, netIncome, totalIncome, monthlyIncome,              │
 * │    monthlySpend, monthlyExpenses, accountNumber, ssn,               │
 * │    routingNumber, taxId, ein                                        │
 * └─────────────────────────────────────────────────────────────────────┘
 */

import { log } from '../logger.js';

// ── Forbidden field names (raw PII that must never reach Redis) ───────────────

/**
 * These field names are absolutely forbidden anywhere inside documentInsights.
 * They represent raw numeric PII extracted from uploaded documents.
 */
const DOCUMENT_FORBIDDEN_FIELDS = new Set([
  'grossIncome',
  'netIncome',
  'totalIncome',
  'monthlyIncome',
  'monthlySpend',
  'monthlyExpenses',
  'accountNumber',
  'account_number',
  'routingNumber',
  'routing_number',
  'ssn',
  'taxId',
  'tax_id',
  'ein',
  'socialSecurityNumber',
]);

/**
 * Required abstracted fields in documentInsights.tax (enforcement).
 * If tax insights are present they MUST use label fields, not raw numbers.
 */
const TAX_REQUIRED_LABEL_FIELDS = ['income_range'];

/**
 * Required abstracted fields in documentInsights.cashflow.
 */
const CASHFLOW_REQUIRED_LABEL_FIELDS = ['budget_health', 'savings_rate_label'];

// ── SchemaValidator ────────────────────────────────────────────────────────────

export class SchemaValidator {

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Validate a session patch before it is written to Redis.
   * Throws a SchemaViolationError if a forbidden field is detected.
   *
   * @param {object} patch  The partial session object being written
   * @throws {SchemaViolationError}
   */
  validateSessionWrite(patch) {
    const violations = this._collectViolations(patch);

    if (violations.length > 0) {
      const msg = `[SchemaValidator] BLOCKED Redis write — PII violations detected:\n` +
        violations.map((v) => `  • ${v}`).join('\n');
      log.error(msg);
      throw new SchemaViolationError(msg, violations);
    }

    log.info(`[SchemaValidator] ✔ session write validated — keys=[${Object.keys(patch).join(', ')}]`);
  }

  /**
   * Validate without throwing — returns violation strings or empty array.
   * Useful for logging/alerting without blocking.
   *
   * @param {object} patch
   * @returns {string[]}  Violation descriptions (empty = clean)
   */
  inspect(patch) {
    return this._collectViolations(patch);
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  /**
   * Collect all violations in a patch object.
   * @param {object} patch
   * @returns {string[]}
   */
  _collectViolations(patch) {
    const violations = [];

    // 1. Check documentInsights for raw PII fields
    if (patch.documentInsights) {
      this._checkDocumentInsights(patch.documentInsights, violations);
    }

    // 2. Check that tax insights use labels if present
    if (patch.documentInsights?.tax) {
      this._checkRequiredLabels(
        'documentInsights.tax',
        patch.documentInsights.tax,
        TAX_REQUIRED_LABEL_FIELDS,
        violations,
      );
    }

    // 3. Check that cashflow insights use labels if present
    if (patch.documentInsights?.cashflow) {
      this._checkRequiredLabels(
        'documentInsights.cashflow',
        patch.documentInsights.cashflow,
        CASHFLOW_REQUIRED_LABEL_FIELDS,
        violations,
      );
    }

    // 4. Check agent output objects (tax, cashflow) for raw values
    if (patch.tax)      this._checkAgentOutput('tax',      patch.tax,      violations);
    if (patch.cashflow) this._checkAgentOutput('cashflow', patch.cashflow, violations);

    return violations;
  }

  /**
   * Recursively scan documentInsights for forbidden raw PII field names.
   */
  _checkDocumentInsights(obj, violations, path = 'documentInsights') {
    if (!obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = `${path}.${key}`;

      if (DOCUMENT_FORBIDDEN_FIELDS.has(key)) {
        violations.push(
          `Forbidden raw PII field "${fullPath}" detected. ` +
          `Use an abstracted label (e.g. income_range, budget_health) instead.`,
        );
        continue;
      }

      // Recurse into nested objects
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        this._checkDocumentInsights(value, violations, fullPath);
      }
    }
  }

  /**
   * Verify that required label fields exist in an insights object.
   */
  _checkRequiredLabels(path, obj, requiredFields, violations) {
    for (const field of requiredFields) {
      if (!(field in obj)) {
        violations.push(
          `Missing required abstracted field "${path}.${field}". ` +
          `Raw document values must be abstracted before storage.`,
        );
      }
    }
  }

  /**
   * Check agent output objects for accidentally included raw values.
   * These should only contain abstracted signals and computed scores.
   */
  _checkAgentOutput(agentName, obj, violations) {
    if (!obj || typeof obj !== 'object') return;

    for (const key of Object.keys(obj)) {
      if (DOCUMENT_FORBIDDEN_FIELDS.has(key)) {
        violations.push(
          `Forbidden raw PII field "${agentName}.${key}" in agent output. ` +
          `Agent outputs must not contain raw document values.`,
        );
      }
    }
  }
}

// ── SchemaViolationError ──────────────────────────────────────────────────────

/**
 * Thrown when a Redis write would store forbidden PII fields.
 */
export class SchemaViolationError extends Error {
  /**
   * @param {string}   message
   * @param {string[]} violations  List of specific violation descriptions
   */
  constructor(message, violations = []) {
    super(message);
    this.name  = 'SchemaViolationError';
    this.violations = violations;
  }
}
