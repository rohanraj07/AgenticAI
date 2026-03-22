import { cashflowChain } from '../langchain/chains.js';
import { log } from '../logger.js';
import {
  parseCashflowSignals,
  classifySpendingRisk,
  deriveSavingsInsight,
} from './subagents/cashflow.subagents.js';

/**
 * CashflowAgent — Spending pattern analysis and savings optimization.
 *
 * Internal pipeline (sub-agents):
 *  1. parseCashflowSignals  — validate / normalize incoming signals
 *  2. classifySpendingRisk  — map spending level to risk tier
 *  3. LLM chain             — generate recommendations
 *  4. deriveSavingsInsight  — compute savings acceleration potential
 *
 * Operates ONLY on abstracted cashflow signals — never stores raw transaction data.
 */
export class CashflowAgent {
  /**
   * @param {object} cashflowInsights   Sanitized signals from DocumentIngestionAgent
   * @param {object} profile            User profile
   * @returns {Promise<object>}
   */
  async run(cashflowInsights, profile) {
    // ── Sub-agent 1: Parse + validate signals ──────────────────────────────
    const signals = parseCashflowSignals(cashflowInsights);
    log.agent('CashflowAgent [1/4] parseCashflowSignals');
    log.agent(`  income=${signals.income_range} | spending=${signals.spending_level} | savings=${signals.savings_rate}`);

    // ── Sub-agent 2: Classify spending risk ────────────────────────────────
    const spendingRisk = classifySpendingRisk(signals);
    log.agent(`CashflowAgent [2/4] classifySpendingRisk | risk=${spendingRisk.spending_risk} | intervention=${spendingRisk.requires_intervention}`);
    if (spendingRisk.message) log.agent(`  ⚠ ${spendingRisk.message}`);

    // ── Sub-agent 3: LLM chain ─────────────────────────────────────────────
    log.agent('CashflowAgent [3/4] LLM chain — generating recommendations');
    const result = await cashflowChain.invoke({
      cashflowInsights: JSON.stringify(signals, null, 2),
      profile:          JSON.stringify(profile,  null, 2),
    });

    // ── Sub-agent 4: Derive savings insight ────────────────────────────────
    const savingsInsight = deriveSavingsInsight(signals, spendingRisk);
    log.agent(`CashflowAgent [4/4] deriveSavingsInsight | score=${savingsInsight.savings_score}/5 | potential=${savingsInsight.acceleration_potential}`);

    const cashflow = {
      budget_health:              result.budget_health             || signals.budget_health,
      savings_rate_label:         result.savings_rate_label        || signals.savings_rate,
      spending_level:             result.spending_level            || signals.spending_level,
      spending_risk:              spendingRisk,
      monthly_surplus_indicator:  result.monthly_surplus_indicator || 'neutral',
      top_spending_categories:    result.top_spending_categories   || signals.top_categories,
      recommendations:            result.recommendations           || [],
      savings_acceleration_potential: savingsInsight.acceleration_potential,
      savings_insight:            savingsInsight,
      key_insight:                result.key_insight               || '',
      disclaimer:                 result.disclaimer                || 'Analysis based on abstracted signals. No transaction data was stored.',
    };

    log.agent(`CashflowAgent: budget=${cashflow.budget_health} | spending=${cashflow.spending_level} | ${cashflow.recommendations.length} recommendations`);
    return cashflow;
  }
}
