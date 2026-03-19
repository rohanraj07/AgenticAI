/**
 * PII Sanitizer — Trust-by-Design
 *
 * PRINCIPLE: "Agents never operate on raw PII"
 *
 * This module converts raw financial numbers into abstracted signals.
 * Raw documents are NEVER stored. Only derived insights flow through memory layers.
 *
 * What we sanitize:
 *  - Exact dollar amounts  → income range labels (LOW / MEDIUM / HIGH / VERY_HIGH)
 *  - Tax bracket numbers   → bracket label
 *  - Spending amounts      → spending level
 *  - Account numbers       → [REDACTED]
 *  - SSN / EIN             → [REDACTED]
 *  - Full names (optional) → first name only or [REDACTED]
 */

/**
 * Map an annual income amount to a qualitative range.
 * @param {number} income
 * @returns {string}
 */
export function incomeToRange(income) {
  if (income < 40000)  return 'LOW';
  if (income < 80000)  return 'LOWER_MIDDLE';
  if (income < 130000) return 'MIDDLE';
  if (income < 200000) return 'UPPER_MIDDLE';
  if (income < 400000) return 'HIGH';
  return 'VERY_HIGH';
}

/**
 * Map an effective tax rate to a bracket label.
 * @param {number} effectiveRate  (percentage, e.g. 22)
 * @returns {string}
 */
export function taxRateToLabel(effectiveRate) {
  if (effectiveRate <= 12) return '10-12%';
  if (effectiveRate <= 22) return '22%';
  if (effectiveRate <= 24) return '24%';
  if (effectiveRate <= 32) return '32%';
  if (effectiveRate <= 35) return '35%';
  return '37%+';
}

/**
 * Map a monthly savings rate percentage to a label.
 * @param {number} savingsRatePct  (e.g. 18 for 18%)
 * @returns {string}
 */
export function savingsRateToLevel(savingsRatePct) {
  if (savingsRatePct < 5)  return 'VERY_LOW';
  if (savingsRatePct < 10) return 'LOW';
  if (savingsRatePct < 20) return 'MODERATE';
  if (savingsRatePct < 30) return 'GOOD';
  return 'EXCELLENT';
}

/**
 * Map deductions amount relative to income to a label.
 * @param {number} deductions
 * @param {number} income
 * @returns {string}
 */
export function deductionsToLevel(deductions, income) {
  const pct = income > 0 ? (deductions / income) * 100 : 0;
  if (pct < 10) return 'LOW';
  if (pct < 20) return 'MODERATE';
  if (pct < 35) return 'HIGH';
  return 'VERY_HIGH';
}

/**
 * Map monthly spending relative to income to a label.
 * @param {number} monthlySpend
 * @param {number} monthlyIncome
 * @returns {string}
 */
export function spendingToLevel(monthlySpend, monthlyIncome) {
  const pct = monthlyIncome > 0 ? (monthlySpend / monthlyIncome) * 100 : 0;
  if (pct < 50)  return 'FRUGAL';
  if (pct < 70)  return 'MODERATE';
  if (pct < 85)  return 'ELEVATED';
  if (pct < 100) return 'HIGH';
  return 'OVERSPENDING';
}

/**
 * Sanitize a tax insights object — converts raw numbers to abstracted labels.
 * This is what gets stored in memory; raw values are discarded.
 *
 * @param {object} raw  — { grossIncome, effectiveTaxRate, totalDeductions, taxOwed, ... }
 * @returns {object}    — { income_range, tax_bracket, deductions_level, effective_rate_label, optimization_opportunities }
 */
export function sanitizeTaxInsights(raw) {
  return {
    income_range:       incomeToRange(raw.grossIncome || 0),
    tax_bracket:        taxRateToLabel(raw.marginalRate || raw.effectiveTaxRate || 0),
    effective_rate:     raw.effectiveTaxRate ? `${raw.effectiveTaxRate.toFixed(1)}%` : 'unknown',
    deductions_level:   deductionsToLevel(raw.totalDeductions || 0, raw.grossIncome || 0),
    filing_status:      raw.filingStatus || 'unknown',
    optimization_opportunities: raw.optimization_opportunities || [],
    // Explicitly note what is NOT stored
    _pii_note: 'Raw income, SSN, and exact tax amounts were not persisted. Only abstracted signals stored.',
  };
}

/**
 * Sanitize cashflow insights — converts raw spending data to abstracted signals.
 *
 * @param {object} raw  — { monthlyIncome, monthlySpend, categories, savingsRate, ... }
 * @returns {object}
 */
export function sanitizeCashflowInsights(raw) {
  return {
    income_range:    incomeToRange((raw.monthlyIncome || 0) * 12),
    spending_level:  spendingToLevel(raw.monthlySpend || 0, raw.monthlyIncome || 0),
    savings_rate:    savingsRateToLevel(raw.savingsRate || 0),
    top_categories:  (raw.categories || []).map((c) => c.name || c),  // category names only, no amounts
    budget_health:   raw.budgetHealth || 'unknown',
    _pii_note: 'Exact account balances, transaction amounts, and account numbers were not persisted.',
  };
}

/**
 * Redact a raw text document — replaces patterns that look like PII.
 * Used when logging or storing snippets for audit purposes only.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactDocument(text) {
  return text
    .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN-REDACTED]')         // SSN
    .replace(/\b\d{9}\b/g, '[EIN-REDACTED]')                       // EIN
    .replace(/\b\d{10,17}\b/g, '[ACCOUNT-REDACTED]')               // Account numbers
    .replace(/\$[\d,]+(\.\d{2})?/g, '$[AMOUNT]')                   // Dollar amounts
    .replace(/\b\d{1,3}(,\d{3})+(\.\d{2})?\b/g, '[AMOUNT]');     // Numeric amounts with commas
}
