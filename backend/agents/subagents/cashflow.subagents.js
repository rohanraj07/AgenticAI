/**
 * Cashflow Sub-agents — internal decomposition of CashflowAgent.
 *
 * Pure functions operating on already-sanitized signals (no raw PII).
 * Pipeline inside CashflowAgent:
 *
 *   parseCashflowSignals → classifySpendingRisk → deriveSavingsInsight
 */

/**
 * TransactionParserSubagent: Validate and normalize cashflow signals.
 * @param {object} cashflowInsights  Sanitized signals from DocumentIngestionAgent
 * @returns {object}
 */
export function parseCashflowSignals(cashflowInsights) {
  return {
    income_range:    cashflowInsights.income_range   || 'UNKNOWN',
    spending_level:  cashflowInsights.spending_level || 'UNKNOWN',
    savings_rate:    cashflowInsights.savings_rate   || 'UNKNOWN',
    top_categories:  Array.isArray(cashflowInsights.top_categories)
      ? cashflowInsights.top_categories : [],
    budget_health:   cashflowInsights.budget_health  || 'unknown',
  };
}

/**
 * SpendingClassifierSubagent: Map spending level to a risk tier.
 * @param {object} signals  Output of parseCashflowSignals
 * @returns {object}
 */
export function classifySpendingRisk(signals) {
  const riskMap = {
    FRUGAL:      { risk: 'low',      flag: false },
    MODERATE:    { risk: 'low',      flag: false },
    ELEVATED:    { risk: 'medium',   flag: false },
    HIGH:        { risk: 'high',     flag: true  },
    OVERSPENDING:{ risk: 'critical', flag: true  },
  };

  const entry = riskMap[signals.spending_level] || { risk: 'medium', flag: false };
  return {
    spending_risk:         entry.risk,
    requires_intervention: entry.flag,
    message:
      entry.risk === 'critical' ? 'Spending exceeds income — immediate budget review recommended'
      : entry.risk === 'high'   ? 'Spending is high — reducing discretionary expenses would improve savings'
      : null,
  };
}

/**
 * SavingsInsightSubagent: Determine savings acceleration potential.
 * @param {object} signals       Output of parseCashflowSignals
 * @param {object} spendingRisk  Output of classifySpendingRisk
 * @returns {object}
 */
export function deriveSavingsInsight(signals, spendingRisk) {
  const savingsScore = { VERY_LOW: 1, LOW: 2, MODERATE: 3, GOOD: 4, EXCELLENT: 5 };
  const score = savingsScore[signals.savings_rate] ?? 2;

  const potential =
    score < 3 ? 'High — significant room to increase savings rate'
    : score < 4 ? 'Moderate — targeted reductions could meaningfully improve savings'
    : 'Low — savings rate is already strong, focus on investment optimization';

  return {
    savings_score:           score,
    acceleration_potential:  potential,
    priority:                spendingRisk.requires_intervention ? 'high' : score < 3 ? 'medium' : 'low',
  };
}
