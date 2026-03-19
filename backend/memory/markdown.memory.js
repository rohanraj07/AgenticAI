import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = join(process.cwd(), 'data', 'sessions');

/**
 * MarkdownMemory — persists human-readable session context to .md files.
 *
 * TRUST-BY-DESIGN: This file stores ONLY abstracted, redacted signals.
 * Raw PII (exact income, SSN, account numbers, tax amounts) is NEVER written here.
 * The LLM reasons from these summaries — not from original documents.
 */
export class MarkdownMemory {
  constructor() {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  }

  filePath(sessionId) {
    return join(MEMORY_DIR, `${sessionId}.md`);
  }

  /**
   * Write full markdown snapshot for a session.
   * All numeric values are already-processed; raw PII must not be passed in here.
   */
  write(sessionId, profile, simulation, portfolio, risk, taxInsights = null, cashflowInsights = null) {
    const sections = [];

    sections.push(`# Financial Planning Session: ${sessionId}`);
    sections.push(`_Generated: ${new Date().toISOString()}_`);
    sections.push(`_⚠️ PII Policy: This file contains abstracted signals only. No raw documents, SSNs, account numbers, or exact monetary values are stored._`);
    sections.push('');

    if (profile) {
      sections.push('## User Profile (Abstracted)');
      sections.push(`- **Age**: ${profile.age} — ${ageGroup(profile.age)}`);
      sections.push(`- **Income Range**: ${profile.income_range || incomeToRange(profile.income || 0)}`);
      sections.push(`- **Savings Level**: ${savingsLevel(profile.savings || 0)}`);
      sections.push(`- **Monthly Expenses**: ${expenseLevel(profile.monthly_expenses || 0, profile.income || 0)}`);
      sections.push(`- **Target Retirement Age**: ${profile.retirement_age}`);
      sections.push(`- **Risk Tolerance**: ${profile.risk_tolerance}`);
      if ((profile.goals || []).length) {
        sections.push(`- **Goals**: ${profile.goals.join(', ')}`);
      }
      sections.push('');
    }

    if (simulation) {
      sections.push('## Simulation Results');
      sections.push(`- **Retirement Feasibility**: ${simulation.can_retire_at_target ? '✅ On Track' : '⚠️ Gap Identified'}`);
      sections.push(`- **Years of Runway**: ${simulation.years_of_runway}`);
      sections.push(`- **Summary**: ${simulation.summary}`);
      sections.push('');
    }

    if (portfolio) {
      sections.push('## Portfolio Strategy');
      sections.push(`- **Strategy**: ${portfolio.strategy}`);
      sections.push(`- **Expected Annual Return**: ${portfolio.expected_annual_return_percent}%`);
      sections.push(`- **Rebalance Frequency**: ${portfolio.rebalance_frequency}`);
      if ((portfolio.allocation || []).length) {
        sections.push('- **Allocation**:');
        (portfolio.allocation || []).forEach((a) => sections.push(`  - ${a.asset}: ${a.percent}%`));
      }
      sections.push('');
    }

    if (risk) {
      sections.push('## Risk Assessment');
      sections.push(`- **Risk Score**: ${risk.overall_risk_score}/10`);
      sections.push(`- **Risk Level**: ${risk.risk_level}`);
      if ((risk.mitigation_steps || []).length) {
        sections.push('- **Mitigation Steps**:');
        (risk.mitigation_steps || []).forEach((s) => sections.push(`  - ${s}`));
      }
      sections.push('');
    }

    if (taxInsights) {
      sections.push('## Tax Intelligence (Abstracted Signals)');
      sections.push(`> 🔒 Raw tax document NOT stored. Only derived signals below.`);
      sections.push(`- **Income Range**: ${taxInsights.income_range}`);
      sections.push(`- **Tax Bracket**: ${taxInsights.tax_bracket}`);
      sections.push(`- **Effective Rate**: ${taxInsights.effective_rate}`);
      sections.push(`- **Deductions Level**: ${taxInsights.deductions_level}`);
      sections.push(`- **Filing Status**: ${taxInsights.filing_status}`);
      if ((taxInsights.optimization_opportunities || []).length) {
        sections.push('- **Optimization Opportunities**:');
        (taxInsights.optimization_opportunities || []).forEach((o) => sections.push(`  - ${o}`));
      }
      sections.push('');
    }

    if (cashflowInsights) {
      sections.push('## Cashflow Intelligence (Abstracted Signals)');
      sections.push(`> 🔒 Raw bank statement NOT stored. Only derived signals below.`);
      sections.push(`- **Income Range**: ${cashflowInsights.income_range}`);
      sections.push(`- **Spending Level**: ${cashflowInsights.spending_level}`);
      sections.push(`- **Savings Rate**: ${cashflowInsights.savings_rate}`);
      sections.push(`- **Budget Health**: ${cashflowInsights.budget_health}`);
      if ((cashflowInsights.top_categories || []).length) {
        sections.push(`- **Top Spending Categories**: ${cashflowInsights.top_categories.join(', ')}`);
      }
      sections.push('');
    }

    sections.push('---');
    sections.push(`_Session context for LLM reasoning. No PII. No raw documents._`);

    const md = sections.join('\n');
    writeFileSync(this.filePath(sessionId), md, 'utf-8');
    return md;
  }

  read(sessionId) {
    const fp = this.filePath(sessionId);
    if (!existsSync(fp)) return '';
    return readFileSync(fp, 'utf-8');
  }
}

function ageGroup(age) {
  if (age < 30) return 'Early Career';
  if (age < 40) return 'Mid Career';
  if (age < 50) return 'Peak Earning';
  if (age < 60) return 'Pre-Retirement';
  return 'Retirement Age';
}

function incomeToRange(income) {
  if (income < 40000)  return 'LOW';
  if (income < 80000)  return 'LOWER_MIDDLE';
  if (income < 130000) return 'MIDDLE';
  if (income < 200000) return 'UPPER_MIDDLE';
  if (income < 400000) return 'HIGH';
  return 'VERY_HIGH';
}

function savingsLevel(savings) {
  if (savings < 10000)  return 'VERY_LOW';
  if (savings < 50000)  return 'LOW';
  if (savings < 200000) return 'MODERATE';
  if (savings < 500000) return 'GOOD';
  if (savings < 1000000) return 'HIGH';
  return 'VERY_HIGH';
}

function expenseLevel(expenses, income) {
  const monthly = income / 12;
  const pct = monthly > 0 ? (expenses / monthly) * 100 : 0;
  if (pct < 40) return 'VERY_LOW';
  if (pct < 60) return 'LOW';
  if (pct < 75) return 'MODERATE';
  if (pct < 90) return 'HIGH';
  return 'VERY_HIGH';
}
