import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const MEMORY_DIR = join(process.cwd(), 'data', 'sessions');

/**
 * MarkdownMemory — persists human-readable session context to .md files.
 * Used by the LLM for reasoning (injected as RAG context).
 */
export class MarkdownMemory {
  constructor() {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  }

  filePath(sessionId) {
    return join(MEMORY_DIR, `${sessionId}.md`);
  }

  /** Write full markdown snapshot for a session */
  write(sessionId, profile, simulation, portfolio, risk) {
    const md = `# Financial Planning Session: ${sessionId}

## User Profile
- **Name**: ${profile?.name || 'Unknown'}
- **Age**: ${profile?.age}
- **Income**: $${profile?.income?.toLocaleString()}
- **Savings**: $${profile?.savings?.toLocaleString()}
- **Monthly Expenses**: $${profile?.monthly_expenses?.toLocaleString()}
- **Retirement Age**: ${profile?.retirement_age}
- **Risk Tolerance**: ${profile?.risk_tolerance}
- **Goals**: ${(profile?.goals || []).join(', ')}

## Simulation Results
- **Can Retire At Target**: ${simulation?.can_retire_at_target}
- **Projected Savings**: $${simulation?.projected_savings_at_retirement?.toLocaleString()}
- **Monthly Surplus/Shortfall**: $${simulation?.monthly_shortfall_or_surplus?.toLocaleString()}
- **Years of Runway**: ${simulation?.years_of_runway}
- **Summary**: ${simulation?.summary}

## Portfolio
- **Strategy**: ${portfolio?.strategy}
- **Expected Annual Return**: ${portfolio?.expected_annual_return_percent}%
- **Rebalance Frequency**: ${portfolio?.rebalance_frequency}
- **Allocation**:
${(portfolio?.allocation || []).map((a) => `  - ${a.asset}: ${a.percent}%`).join('\n')}

## Risk
- **Score**: ${risk?.overall_risk_score}/10
- **Level**: ${risk?.risk_level}
- **Mitigation Steps**:
${(risk?.mitigation_steps || []).map((s) => `  - ${s}`).join('\n')}

---
_Last updated: ${new Date().toISOString()}_
`;

    writeFileSync(this.filePath(sessionId), md, 'utf-8');
    return md;
  }

  /** Read markdown context for a session */
  read(sessionId) {
    const fp = this.filePath(sessionId);
    if (!existsSync(fp)) return '';
    return readFileSync(fp, 'utf-8');
  }
}
