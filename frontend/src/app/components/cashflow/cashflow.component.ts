import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-cashflow',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="cashflow">

      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
        <div class="health-badge" [ngClass]="healthClass">{{ budgetHealthLabel }}</div>
        <div>
          <h2 style="margin-bottom:4px;">Cashflow Intelligence</h2>
          <div style="font-size:11px; color:#64748b; background:#0f1117; border:1px solid #2d3148;
                      border-radius:6px; padding:3px 8px; display:inline-block;">
            🔒 PII-Safe — no transaction data stored
          </div>
        </div>
      </div>

      <!-- Signal summary row -->
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:14px;">
        <div class="signal-box">
          <div class="signal-label">Spending Level</div>
          <div class="signal-val" [style.color]="spendingColor">{{ $any(cashflow)['spending_level'] }}</div>
        </div>
        <div class="signal-box">
          <div class="signal-label">Savings Rate</div>
          <div class="signal-val" [style.color]="savingsColor">{{ $any(cashflow)['savings_rate_label'] }}</div>
        </div>
        <div class="signal-box">
          <div class="signal-label">Monthly Surplus</div>
          <div class="signal-val" [style.color]="surplusColor">{{ surplusIcon }} {{ $any(cashflow)['monthly_surplus_indicator'] }}</div>
        </div>
      </div>

      <!-- Top spending categories -->
      <div *ngIf="categories.length" style="margin-bottom:14px;">
        <div style="font-size:11px; color:#94a3b8; font-weight:600; margin-bottom:8px;">TOP SPENDING CATEGORIES</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          <span *ngFor="let cat of categories" class="cat-tag">{{ cat }}</span>
        </div>
      </div>

      <!-- Key insight -->
      <div *ngIf="$any(cashflow)['key_insight']" class="insight-box" style="margin-bottom:14px;">
        <div style="font-size:11px; color:#7c8cf8; font-weight:600; margin-bottom:4px;">KEY INSIGHT</div>
        <div style="font-size:13px; color:#e2e8f0;">{{ $any(cashflow)['key_insight'] }}</div>
      </div>

      <!-- Savings acceleration -->
      <div *ngIf="$any(cashflow)['savings_acceleration_potential']" style="margin-bottom:14px;">
        <div style="font-size:11px; color:#94a3b8; font-weight:600; margin-bottom:4px;">SAVINGS POTENTIAL</div>
        <div style="font-size:13px; color:#94a3b8;">{{ $any(cashflow)['savings_acceleration_potential'] }}</div>
      </div>

      <!-- Recommendations -->
      <div *ngIf="recommendations.length">
        <div style="font-size:11px; color:#7c8cf8; font-weight:600; text-transform:uppercase;
                    letter-spacing:0.05em; margin-bottom:10px;">Recommendations</div>
        <div *ngFor="let r of recommendations" class="rec-card" [ngClass]="r.priority">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="font-size:13px; font-weight:600; color:#e2e8f0;">{{ r.action }}</span>
            <span class="priority-badge" [ngClass]="r.priority">{{ r.priority }}</span>
          </div>
          <div style="font-size:12px; color:#94a3b8;">Saving: {{ r.estimated_monthly_saving }}</div>
          <div *ngIf="r.impact_on_retirement" style="font-size:11px; color:#64748b; margin-top:3px;">
            Retirement impact: {{ r.impact_on_retirement }}
          </div>
        </div>
      </div>

      <!-- Disclaimer -->
      <div style="margin-top:14px; padding:8px; background:#0f1117; border-radius:6px;
                  border-left:2px solid #2d3148; font-size:11px; color:#64748b;">
        {{ $any(cashflow)['disclaimer'] }}
      </div>
    </div>
  `,
  styles: [`
    .health-badge {
      padding: 6px 14px; border-radius: 20px; font-size: 13px;
      font-weight: 700; text-transform: uppercase; flex-shrink: 0;
    }
    .health-excellent { background: rgba(34,197,94,0.15);  color: #22c55e; }
    .health-good      { background: rgba(34,197,94,0.1);   color: #22c55e; }
    .health-fair      { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .health-poor      { background: rgba(239,68,68,0.15);  color: #ef4444; }

    .signal-box {
      background: #1a1d27; border: 1px solid #2d3148;
      border-radius: 8px; padding: 10px; text-align: center;
    }
    .signal-label { font-size: 10px; color: #64748b; margin-bottom: 4px; text-transform: uppercase; }
    .signal-val   { font-size: 12px; font-weight: 700; }

    .cat-tag {
      background: #1e2235; border: 1px solid #2d3148;
      border-radius: 12px; padding: 3px 10px; font-size: 12px; color: #94a3b8;
    }

    .insight-box {
      background: #1a1d27; border: 1px solid #2d3148;
      border-left: 3px solid #7c8cf8; border-radius: 6px; padding: 10px 12px;
    }

    .rec-card {
      background: #1a1d27; border: 1px solid #2d3148;
      border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
    }
    .rec-card.high   { border-left: 3px solid #ef4444; }
    .rec-card.medium { border-left: 3px solid #f59e0b; }
    .rec-card.low    { border-left: 3px solid #22c55e; }

    .priority-badge {
      font-size: 10px; font-weight: 700; padding: 2px 6px;
      border-radius: 4px; text-transform: uppercase;
    }
    .priority-badge.high   { background: rgba(239,68,68,0.15); color: #ef4444; }
    .priority-badge.medium { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .priority-badge.low    { background: rgba(34,197,94,0.15);  color: #22c55e; }
  `],
})
export class CashflowComponent {
  @Input() cashflow: Record<string, unknown> | null = null;

  get categories(): string[] {
    return (this.$any(this.cashflow?.['top_spending_categories']) as string[]) || [];
  }

  get recommendations(): Array<{ action: string; estimated_monthly_saving: string; priority: string; impact_on_retirement?: string }> {
    return (this.$any(this.cashflow?.['recommendations']) as any[]) || [];
  }

  get budgetHealthLabel(): string {
    return String(this.cashflow?.['budget_health'] ?? 'unknown');
  }

  get healthClass(): string {
    const h = this.budgetHealthLabel.toLowerCase();
    if (h === 'excellent') return 'health-excellent';
    if (h === 'good')      return 'health-good';
    if (h === 'fair')      return 'health-fair';
    return 'health-poor';
  }

  get spendingColor(): string {
    const s = String(this.cashflow?.['spending_level'] ?? '');
    if (s === 'FRUGAL')    return '#22c55e';
    if (s === 'MODERATE')  return '#94a3b8';
    if (s === 'ELEVATED')  return '#f59e0b';
    return '#ef4444';
  }

  get savingsColor(): string {
    const s = String(this.cashflow?.['savings_rate_label'] ?? '');
    if (s === 'EXCELLENT' || s === 'GOOD') return '#22c55e';
    if (s === 'MODERATE') return '#f59e0b';
    return '#ef4444';
  }

  get surplusColor(): string {
    const s = String(this.cashflow?.['monthly_surplus_indicator'] ?? '');
    if (s === 'positive') return '#22c55e';
    if (s === 'neutral')  return '#94a3b8';
    return '#ef4444';
  }

  get surplusIcon(): string {
    const s = String(this.cashflow?.['monthly_surplus_indicator'] ?? '');
    if (s === 'positive') return '▲';
    if (s === 'negative') return '▼';
    return '●';
  }

  $any(v: unknown): any { return v; }
}
