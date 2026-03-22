import { taxChain } from '../langchain/chains.js';
import { log } from '../logger.js';
import {
  parseTaxSignals,
  analyzeDeductions,
  rankOptimizationStrategies,
} from './subagents/tax.subagents.js';

/**
 * TaxAgent — Tax efficiency analysis and optimization.
 *
 * Internal pipeline (sub-agents):
 *  1. parseTaxSignals       — validate / normalize incoming signals
 *  2. analyzeDeductions     — score deduction utilization, flag gaps
 *  3. LLM chain             — generate optimization strategies
 *  4. rankOptimizationStrategies — sort strategies by priority, boost gap-related items
 *
 * Operates ONLY on abstracted tax signals — never receives raw PII.
 */
export class TaxAgent {
  /**
   * @param {object} taxInsights      Sanitized signals from DocumentIngestionAgent
   * @param {object} profile          User profile (abstracted)
   * @param {object} simulation       Simulation results (may be null)
   * @returns {Promise<object>}
   */
  async run(taxInsights, profile, simulation = null) {
    // ── Sub-agent 1: Parse + validate signals ──────────────────────────────
    const signals = parseTaxSignals(taxInsights);
    log.agent('TaxAgent [1/4] parseTaxSignals');
    log.agent(`  income=${signals.income_range} | bracket=${signals.tax_bracket} | deductions=${signals.deductions_level}`);

    // ── Sub-agent 2: Analyze deductions ────────────────────────────────────
    const deductionAnalysis = analyzeDeductions(signals);
    log.agent(`TaxAgent [2/4] analyzeDeductions | score=${deductionAnalysis.deduction_score}/4 | gap=${deductionAnalysis.gap_identified}`);
    log.agent(`  ${deductionAnalysis.recommendation}`);

    // ── Sub-agent 3: LLM chain ─────────────────────────────────────────────
    log.agent('TaxAgent [3/4] LLM chain — generating optimization strategies');
    const result = await taxChain.invoke({
      taxInsights:  JSON.stringify(signals, null, 2),
      profile:      JSON.stringify(profile, null, 2),
      simulation:   JSON.stringify(simulation || {}, null, 2),
    });

    // ── Sub-agent 4: Rank + prioritize strategies ──────────────────────────
    const rankedStrategies = rankOptimizationStrategies(
      result.optimization_strategies || [],
      deductionAnalysis,
    );
    log.agent(`TaxAgent [4/4] rankOptimizationStrategies | ${rankedStrategies.length} strategies ranked`);
    rankedStrategies.forEach((s) =>
      log.agent(`  [${s.priority}] ${s.strategy}`)
    );

    const tax = {
      tax_efficiency_score:    result.tax_efficiency_score    || 5,
      tax_bracket:             result.tax_bracket             || signals.tax_bracket,
      effective_rate:          result.effective_rate          || signals.effective_rate,
      income_range:            result.income_range            || signals.income_range,
      deductions_level:        result.deductions_level        || signals.deductions_level,
      deduction_analysis:      deductionAnalysis,
      optimization_strategies: rankedStrategies,
      retirement_tax_impact:   result.retirement_tax_impact   || '',
      key_insight:             result.key_insight             || '',
      disclaimer:              result.disclaimer              || 'Tax analysis based on abstracted signals. Consult a qualified tax advisor.',
    };

    log.agent(`TaxAgent: efficiency=${tax.tax_efficiency_score}/10 | bracket=${tax.tax_bracket} | ${rankedStrategies.length} strategies`);
    return tax;
  }
}
