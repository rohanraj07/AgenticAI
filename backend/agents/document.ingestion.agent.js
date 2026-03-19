import { documentIngestionChain } from '../langchain/chains.js';
import { sanitizeTaxInsights, sanitizeCashflowInsights } from '../utils/pii.sanitizer.js';
import { log } from '../logger.js';

/**
 * DocumentIngestionAgent — Multi-modal document understanding.
 *
 * TRUST-BY-DESIGN:
 *  1. Receives raw document text (never stored)
 *  2. Uses LLM to classify + extract ephemeral raw_values
 *  3. Immediately passes raw_values through PII sanitizer
 *  4. Returns ONLY abstracted signals — raw_values are discarded
 *
 * "The raw document is seen once, abstracted, then forgotten."
 */
export class DocumentIngestionAgent {
  /**
   * @param {string} documentText   Raw file content (never persisted)
   * @param {string} fileName       Original filename (for classification hint)
   * @returns {Promise<object>}
   */
  async run(documentText, fileName = '') {
    log.agent(`DocumentIngestionAgent: processing "${fileName}" (${documentText.length} chars of raw text)`);
    log.agent('  ⚠️  Raw document text will NOT be stored — extracting abstractions only');

    const result = await documentIngestionChain.invoke({ documentText });

    const docType = result.document_type || 'unknown';
    const rawValues = result.raw_values || {};

    log.agent(`  Classification: ${docType} (confidence: ${result.confidence})`);
    log.agent(`  Primary insight: "${result.abstracted_signals?.primary_insight}"`);
    log.agent('  Sanitizing raw values → abstractions (raw values will be discarded)...');

    // ── Sanitize raw values into safe abstractions ──────────────────────────
    let taxInsights = null;
    let cashflowInsights = null;

    if (docType === 'tax_document') {
      taxInsights = sanitizeTaxInsights({
        grossIncome:    rawValues.grossIncome    || 0,
        effectiveTaxRate: rawValues.effectiveTaxRate || 0,
        marginalRate:   rawValues.marginalRate   || 0,
        totalDeductions: rawValues.totalDeductions || 0,
        filingStatus:   rawValues.filingStatus   || 'unknown',
        optimization_opportunities: rawValues.optimization_opportunities || [],
      });
      log.agent(`  Tax abstractions: income_range=${taxInsights.income_range}, bracket=${taxInsights.tax_bracket}, deductions=${taxInsights.deductions_level}`);
    }

    if (docType === 'bank_statement') {
      cashflowInsights = sanitizeCashflowInsights({
        monthlyIncome: rawValues.monthlyIncome || 0,
        monthlySpend:  rawValues.monthlySpend  || 0,
        savingsRate:   rawValues.savingsRate   || 0,
        budgetHealth:  rawValues.budgetHealth  || 'unknown',
        categories:    rawValues.categories    || [],
      });
      log.agent(`  Cashflow abstractions: income_range=${cashflowInsights.income_range}, spending=${cashflowInsights.spending_level}, savings=${cashflowInsights.savings_rate}`);
    }

    log.agent('  ✅ Raw values discarded — only abstracted signals returned');

    return {
      document_type:       docType,
      confidence:          result.confidence || 'medium',
      abstracted_signals:  result.abstracted_signals || {},
      suggested_agents:    result.suggested_agents  || [],
      suggested_ui:        result.suggested_ui      || [],
      // Sanitized insights passed downstream (NOT the raw values)
      taxInsights,
      cashflowInsights,
      // Explicit audit fields
      pii_stored:          false,
      raw_document_stored: false,
    };
  }
}
