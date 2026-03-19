import { taxChain } from '../langchain/chains.js';
import { log } from '../logger.js';

/**
 * TaxAgent — Tax efficiency analysis and optimization.
 *
 * Operates ONLY on abstracted tax signals (income_range, tax_bracket, etc.)
 * Never receives or stores raw tax documents, SSNs, or exact dollar amounts.
 */
export class TaxAgent {
  /**
   * @param {object} taxInsights      Sanitized signals from DocumentIngestionAgent
   * @param {object} profile          User profile (abstracted)
   * @param {object} simulation       Simulation results (may be null)
   * @returns {Promise<object>}
   */
  async run(taxInsights, profile, simulation = null) {
    log.agent('TaxAgent: analyzing tax efficiency from abstracted signals');
    log.agent(`  Signals: income=${taxInsights.income_range}, bracket=${taxInsights.tax_bracket}, deductions=${taxInsights.deductions_level}`);

    const result = await taxChain.invoke({
      taxInsights:  JSON.stringify(taxInsights, null, 2),
      profile:      JSON.stringify(profile,     null, 2),
      simulation:   JSON.stringify(simulation || {}, null, 2),
    });

    const tax = {
      tax_efficiency_score:    result.tax_efficiency_score    || 5,
      tax_bracket:             result.tax_bracket             || taxInsights.tax_bracket,
      effective_rate:          result.effective_rate          || taxInsights.effective_rate,
      income_range:            result.income_range            || taxInsights.income_range,
      deductions_level:        result.deductions_level        || taxInsights.deductions_level,
      optimization_strategies: result.optimization_strategies || [],
      retirement_tax_impact:   result.retirement_tax_impact   || '',
      key_insight:             result.key_insight             || '',
      disclaimer:              result.disclaimer              || 'Consult a qualified tax advisor.',
    };

    log.agent(`  Tax efficiency score: ${tax.tax_efficiency_score}/10`);
    log.agent(`  Bracket: ${tax.tax_bracket} | Effective rate: ${tax.effective_rate}`);
    log.agent(`  Strategies: ${tax.optimization_strategies.length} identified`);
    tax.optimization_strategies.forEach((s) =>
      log.agent(`    [${s.priority}] ${s.strategy}: ${s.estimated_impact}`)
    );

    return tax;
  }
}
