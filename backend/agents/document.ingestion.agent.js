import { documentIngestionChain } from '../langchain/chains.js';
import { sanitizeTaxInsights, sanitizeCashflowInsights } from '../utils/pii.sanitizer.js';
import { routeDocument } from '../utils/document.routing.js';
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
 * Supported document types: tax_document, bank_statement, investment_statement, debt_document, unknown
 * Agent + UI routing is determined by document.routing.js ROUTING_MAP.
 */
export class DocumentIngestionAgent {
  /**
   * @param {string} documentText   Raw file content (never persisted)
   * @param {string} fileName       Original filename (for classification hint)
   * @returns {Promise<object>}
   */
  async run(documentText, fileName = '') {
    log.agent(`DocumentIngestionAgent: processing "${fileName}" (${documentText.length} chars)`);
    log.agent('  ⚠️  Raw document text will NOT be stored — extracting abstractions only');

    const result = await documentIngestionChain.invoke({ documentText });

    const docType  = result.document_type || 'unknown';
    const rawValues = result.raw_values   || {};

    log.agent(`  Classification: ${docType} (confidence: ${result.confidence})`);
    log.agent(`  Primary insight: "${result.abstracted_signals?.primary_insight}"`);
    log.agent('  Sanitizing raw values → abstractions (raw values will be discarded)...');

    // ── Sanitize raw values into safe abstractions (by document type) ──────
    let taxInsights        = null;
    let cashflowInsights   = null;
    let portfolioInsights  = null;
    let debtInsights       = null;

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

    if (docType === 'investment_statement') {
      // Extract abstracted portfolio signals (no raw account numbers or exact balances)
      portfolioInsights = {
        portfolio_size_label: _portfolioSizeLabel(rawValues.portfolioValue || 0),
        asset_mix:            rawValues.assetMix || [],
        account_type:         rawValues.accountType || 'unknown',
        performance_label:    rawValues.performanceLabel || 'unknown',
        primary_insight:      result.abstracted_signals?.primary_insight || '',
        _pii_note:            'Exact portfolio value and account numbers were not persisted.',
      };
      log.agent(`  Portfolio abstractions: size=${portfolioInsights.portfolio_size_label}, type=${portfolioInsights.account_type}`);
    }

    if (docType === 'debt_document') {
      // Extract abstracted debt signals (no raw balances or creditor names)
      debtInsights = {
        debt_level_label: _debtLevelLabel(rawValues.totalDebt || 0, rawValues.annualIncome || 0),
        debt_types:       rawValues.debtTypes || [],
        dti_label:        rawValues.debtToIncomeRatio ? _dtiLabel(rawValues.debtToIncomeRatio) : 'unknown',
        primary_insight:  result.abstracted_signals?.primary_insight || '',
        _pii_note:        'Exact debt balances, account numbers, and creditor details were not persisted.',
      };
      log.agent(`  Debt abstractions: level=${debtInsights.debt_level_label}, dti=${debtInsights.dti_label}`);
    }

    log.agent('  ✅ Raw values discarded — only abstracted signals returned');

    // ── Use ROUTING_MAP to determine suggested agents + UI ─────────────────
    const routing = routeDocument(docType);
    log.agent(`  Routing: agents=[${routing.agents.join(', ')}] | ui=[${routing.ui.join(', ')}]`);

    return {
      document_type:       docType,
      confidence:          result.confidence || 'medium',
      abstracted_signals:  result.abstracted_signals || {},
      suggested_agents:    routing.agents,
      suggested_ui:        routing.ui.map((type) => ({ type })),
      // Sanitized insights (only the relevant one will be non-null)
      taxInsights,
      cashflowInsights,
      portfolioInsights,
      debtInsights,
      // Explicit audit fields
      pii_stored:          false,
      raw_document_stored: false,
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _portfolioSizeLabel(value) {
  if (value < 25000)   return 'STARTER';
  if (value < 100000)  return 'GROWING';
  if (value < 500000)  return 'ESTABLISHED';
  if (value < 1000000) return 'SUBSTANTIAL';
  return 'HIGH_NET_WORTH';
}

function _debtLevelLabel(totalDebt, annualIncome) {
  if (!annualIncome || annualIncome === 0) return 'UNKNOWN';
  const ratio = totalDebt / annualIncome;
  if (ratio < 0.2)  return 'LOW';
  if (ratio < 0.5)  return 'MODERATE';
  if (ratio < 1.0)  return 'HIGH';
  return 'VERY_HIGH';
}

function _dtiLabel(dti) {
  if (dti < 0.2)  return 'HEALTHY';
  if (dti < 0.36) return 'MANAGEABLE';
  if (dti < 0.5)  return 'ELEVATED';
  return 'HIGH_RISK';
}
