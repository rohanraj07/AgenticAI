/**
 * Tax Sub-agents — internal decomposition of TaxAgent.
 *
 * These are pure functions operating on already-sanitized signals (no raw PII).
 * They add a structured pipeline inside TaxAgent without additional LLM calls:
 *
 *   parseTaxSignals → analyzeDeductions → rankOptimizationStrategies
 */

/**
 * TaxParserSubagent: Validate and normalize incoming tax signals.
 * @param {object} taxInsights  Sanitized signals from DocumentIngestionAgent
 * @returns {object}
 */
export function parseTaxSignals(taxInsights) {
  return {
    income_range:               taxInsights.income_range    || 'UNKNOWN',
    tax_bracket:                taxInsights.tax_bracket     || 'unknown',
    effective_rate:             taxInsights.effective_rate  || 'unknown',
    deductions_level:           taxInsights.deductions_level || 'LOW',
    filing_status:              taxInsights.filing_status   || 'unknown',
    optimization_opportunities: Array.isArray(taxInsights.optimization_opportunities)
      ? taxInsights.optimization_opportunities : [],
  };
}

/**
 * DeductionAnalyzerSubagent: Score deduction utilization and identify gaps.
 * @param {object} signals  Output of parseTaxSignals
 * @returns {object}
 */
export function analyzeDeductions(signals) {
  const levelScore = { LOW: 1, MODERATE: 2, HIGH: 3, VERY_HIGH: 4 };
  const score = levelScore[signals.deductions_level] ?? 1;

  return {
    deduction_score: score,
    utilization:     signals.deductions_level,
    gap_identified:  score < 3,
    recommendation:
      score < 2 ? 'Significant deduction opportunities likely exist — review Schedule A itemized deductions'
      : score < 3 ? 'Some deduction opportunities may remain — compare itemized vs. standard deduction'
      : 'Deduction utilization appears strong',
  };
}

/**
 * TaxOptimizerSubagent: Sort LLM-produced strategies by priority,
 * boosting priority for deduction-related strategies when gaps exist.
 * @param {Array}  strategies        LLM-produced optimization_strategies
 * @param {object} deductionAnalysis Output of analyzeDeductions
 * @returns {Array}
 */
export function rankOptimizationStrategies(strategies = [], deductionAnalysis) {
  const ORDER = { high: 0, medium: 1, low: 2 };

  return strategies
    .map((s) => ({
      ...s,
      // Promote deduction strategies when a gap was identified
      priority:
        deductionAnalysis.gap_identified &&
        typeof s.strategy === 'string' &&
        s.strategy.toLowerCase().includes('deduct')
          ? 'high'
          : s.priority || 'medium',
    }))
    .sort((a, b) => (ORDER[a.priority] ?? 1) - (ORDER[b.priority] ?? 1));
}
