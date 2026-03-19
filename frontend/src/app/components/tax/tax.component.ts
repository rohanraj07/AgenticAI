import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-tax',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="tax">

      <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
        <div class="tax-score-ring" [ngClass]="efficiencyClass">
          {{ $any(tax)['tax_efficiency_score'] }}
        </div>
        <div>
          <h2 style="margin-bottom:4px;">Tax Intelligence</h2>
          <div style="font-size:11px; color:#64748b; background:#0f1117; border:1px solid #2d3148;
                      border-radius:6px; padding:3px 8px; display:inline-block;">
            🔒 PII-Safe — abstracted signals only
          </div>
        </div>
      </div>

      <!-- Key signals -->
      <div class="kv-row">
        <span class="kv-key">Tax Bracket</span>
        <span class="kv-val bracket-badge">{{ $any(tax)['tax_bracket'] }}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Effective Rate</span>
        <span class="kv-val">{{ $any(tax)['effective_rate'] }}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Income Range</span>
        <span class="kv-val">{{ $any(tax)['income_range'] }}</span>
      </div>
      <div class="kv-row">
        <span class="kv-key">Deductions Level</span>
        <span class="kv-val" [style.color]="deductionColor">{{ $any(tax)['deductions_level'] }}</span>
      </div>

      <!-- Key insight -->
      <div *ngIf="$any(tax)['key_insight']" class="insight-box" style="margin-top:14px;">
        <div style="font-size:11px; color:#7c8cf8; font-weight:600; margin-bottom:4px;">KEY INSIGHT</div>
        <div style="font-size:13px; color:#e2e8f0;">{{ $any(tax)['key_insight'] }}</div>
      </div>

      <!-- Retirement tax impact -->
      <div *ngIf="$any(tax)['retirement_tax_impact']" style="margin-top:10px;">
        <div style="font-size:11px; color:#94a3b8; font-weight:600; margin-bottom:4px;">RETIREMENT TAX IMPACT</div>
        <div style="font-size:13px; color:#94a3b8;">{{ $any(tax)['retirement_tax_impact'] }}</div>
      </div>

      <!-- Optimization strategies -->
      <div *ngIf="strategies.length" style="margin-top:16px;">
        <div style="font-size:11px; color:#7c8cf8; font-weight:600; text-transform:uppercase;
                    letter-spacing:0.05em; margin-bottom:10px;">Optimization Strategies</div>
        <div *ngFor="let s of strategies" class="strategy-card" [ngClass]="s.priority">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <span style="font-size:13px; font-weight:600; color:#e2e8f0;">{{ s.strategy }}</span>
            <span class="priority-badge" [ngClass]="s.priority">{{ s.priority }}</span>
          </div>
          <div style="font-size:12px; color:#94a3b8;">{{ s.estimated_impact }}</div>
          <div *ngIf="s.rationale" style="font-size:11px; color:#64748b; margin-top:4px; font-style:italic;">{{ s.rationale }}</div>
        </div>
      </div>

      <!-- Disclaimer -->
      <div style="margin-top:14px; padding:8px; background:#0f1117; border-radius:6px;
                  border-left:2px solid #2d3148; font-size:11px; color:#64748b;">
        {{ $any(tax)['disclaimer'] }}
      </div>
    </div>
  `,
  styles: [`
    .tax-score-ring {
      width: 64px; height: 64px; border-radius: 50%; border: 5px solid;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: 700; flex-shrink: 0;
    }
    .efficiency-low    { border-color: #ef4444; color: #ef4444; }
    .efficiency-medium { border-color: #f59e0b; color: #f59e0b; }
    .efficiency-high   { border-color: #22c55e; color: #22c55e; }

    .bracket-badge {
      background: #1e2235; border: 1px solid #7c8cf8;
      border-radius: 4px; padding: 2px 8px; font-size: 12px;
    }

    .insight-box {
      background: #1a1d27; border: 1px solid #2d3148;
      border-left: 3px solid #7c8cf8; border-radius: 6px; padding: 10px 12px;
    }

    .strategy-card {
      background: #1a1d27; border: 1px solid #2d3148;
      border-radius: 8px; padding: 10px 12px; margin-bottom: 8px;
    }
    .strategy-card.high   { border-left: 3px solid #ef4444; }
    .strategy-card.medium { border-left: 3px solid #f59e0b; }
    .strategy-card.low    { border-left: 3px solid #22c55e; }

    .priority-badge {
      font-size: 10px; font-weight: 700; padding: 2px 6px;
      border-radius: 4px; text-transform: uppercase;
    }
    .priority-badge.high   { background: rgba(239,68,68,0.15); color: #ef4444; }
    .priority-badge.medium { background: rgba(245,158,11,0.15); color: #f59e0b; }
    .priority-badge.low    { background: rgba(34,197,94,0.15);  color: #22c55e; }
  `],
})
export class TaxComponent {
  @Input() tax: Record<string, unknown> | null = null;

  get strategies(): Array<{ strategy: string; estimated_impact: string; priority: string; rationale?: string }> {
    return ($any(this.tax?.['optimization_strategies']) as any[]) || [];
  }

  get efficiencyClass(): string {
    const score = Number(this.tax?.['tax_efficiency_score'] ?? 5);
    if (score >= 7) return 'efficiency-high';
    if (score >= 4) return 'efficiency-medium';
    return 'efficiency-low';
  }

  get deductionColor(): string {
    const level = String(this.tax?.['deductions_level'] ?? '');
    if (level === 'HIGH' || level === 'VERY_HIGH') return '#22c55e';
    if (level === 'MODERATE') return '#f59e0b';
    return '#ef4444';
  }

  $any(v: unknown): any { return v; }
}
