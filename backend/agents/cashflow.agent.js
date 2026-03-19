import { cashflowChain } from '../langchain/chains.js';
import { log } from '../logger.js';

/**
 * CashflowAgent — Spending pattern analysis and savings optimization.
 *
 * Operates ONLY on abstracted cashflow signals (spending_level, savings_rate, etc.)
 * Never receives or stores raw bank statements, transactions, or account numbers.
 */
export class CashflowAgent {
  /**
   * @param {object} cashflowInsights   Sanitized signals from DocumentIngestionAgent
   * @param {object} profile            User profile
   * @returns {Promise<object>}
   */
  async run(cashflowInsights, profile) {
    log.agent('CashflowAgent: analyzing spending patterns from abstracted signals');
    log.agent(`  Signals: income=${cashflowInsights.income_range}, spending=${cashflowInsights.spending_level}, savings=${cashflowInsights.savings_rate}`);

    const result = await cashflowChain.invoke({
      cashflowInsights: JSON.stringify(cashflowInsights, null, 2),
      profile:          JSON.stringify(profile,          null, 2),
    });

    const cashflow = {
      budget_health:               result.budget_health               || cashflowInsights.budget_health || 'unknown',
      savings_rate_label:          result.savings_rate_label          || cashflowInsights.savings_rate,
      spending_level:              result.spending_level              || cashflowInsights.spending_level,
      monthly_surplus_indicator:   result.monthly_surplus_indicator   || 'neutral',
      top_spending_categories:     result.top_spending_categories     || cashflowInsights.top_categories || [],
      recommendations:             result.recommendations             || [],
      savings_acceleration_potential: result.savings_acceleration_potential || '',
      key_insight:                 result.key_insight                 || '',
      disclaimer:                  result.disclaimer                  || 'Analysis based on abstracted signals. No transaction data was stored.',
    };

    log.agent(`  Budget health: ${cashflow.budget_health} | Spending: ${cashflow.spending_level} | Savings: ${cashflow.savings_rate_label}`);
    log.agent(`  Surplus indicator: ${cashflow.monthly_surplus_indicator}`);
    log.agent(`  Recommendations: ${cashflow.recommendations.length} identified`);
    cashflow.recommendations.forEach((r) =>
      log.agent(`    [${r.priority}] ${r.action}`)
    );

    return cashflow;
  }
}
