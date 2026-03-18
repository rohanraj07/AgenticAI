import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-risk',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="risk">
      <h2>Risk Dashboard</h2>

      <div [class]="'risk-score-ring risk-' + riskLevel">
        {{risk['overall_risk_score']}}<span style="font-size:12px">/10</span>
      </div>

      <div style="text-align:center; font-weight:600; margin-bottom:16px; text-transform:uppercase;">
        {{risk['risk_level']}} Risk
      </div>

      <div *ngIf="factors.length">
        <div style="font-size:12px; color:#7c8cf8; font-weight:600; margin-bottom:8px;">RISK FACTORS</div>
        <div *ngFor="let f of factors" style="margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span>{{f['factor']}}</span>
            <span [style.color]="getImpactColor(f)" style="font-weight:600;">
              {{f['impact']}}
            </span>
          </div>
          <div style="font-size:12px; color:#94a3b8;">{{f['description']}}</div>
        </div>
      </div>

      <div *ngIf="mitigationSteps.length" style="margin-top:12px;">
        <div style="font-size:12px; color:#7c8cf8; font-weight:600; margin-bottom:8px;">MITIGATION STEPS</div>
        <ul style="list-style:disc; padding-left:16px; font-size:13px; color:#94a3b8;">
          <li *ngFor="let s of mitigationSteps" style="margin-bottom:4px;">{{s}}</li>
        </ul>
      </div>

      <div *ngIf="risk['stress_test']" style="margin-top:16px; background:#1e2235; border-radius:8px; padding:12px;">
        <div style="font-size:12px; color:#7c8cf8; font-weight:600; margin-bottom:8px;">STRESS TEST</div>
        <div class="kv-row">
          <span class="kv-key">Market crash (-20%)</span>
          <span class="kv-val" style="color:#ef4444;">
            \${{$any(stressTest['market_crash_20pct_impact']) | number:'1.0-0'}}
          </span>
        </div>
        <div class="kv-row">
          <span class="kv-key">Inflation spike</span>
          <span class="kv-val" style="color:#f59e0b;">
            \${{$any(stressTest['inflation_spike_impact']) | number:'1.0-0'}}
          </span>
        </div>
      </div>
    </div>
  `,
})
export class RiskComponent {
  @Input() risk: Record<string, unknown> | null = null;

  get factors(): Record<string, unknown>[] {
    return (this.risk?.['factors'] as Record<string, unknown>[]) || [];
  }
  get mitigationSteps(): string[] {
    return (this.risk?.['mitigation_steps'] as string[]) || [];
  }
  get stressTest(): Record<string, unknown> {
    return (this.risk?.['stress_test'] as Record<string, unknown>) || {};
  }
  get riskLevel(): string {
    const level = (this.risk?.['risk_level'] as string) || '';
    if (level.includes('high')) return 'high';
    if (level === 'low') return 'low';
    return 'medium';
  }

  getImpactColor(f: Record<string, unknown>): string {
    const impact = f['impact'] as string;
    if (impact === 'high' || impact === 'very high') return '#ef4444';
    if (impact === 'medium') return '#f59e0b';
    return '#22c55e';
  }
}
