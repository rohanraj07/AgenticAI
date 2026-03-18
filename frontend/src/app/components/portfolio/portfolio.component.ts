import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

const COLORS = ['#7c8cf8', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa'];

@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="portfolio">
      <h2>Portfolio Allocation</h2>

      <div style="display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap;">
        <div style="background:#1e2235; border-radius:8px; padding:10px 16px; text-align:center;">
          <div style="font-size:11px; color:#94a3b8">Strategy</div>
          <div style="font-weight:700; text-transform:uppercase; color:#7c8cf8;">
            {{portfolio['strategy']}}
          </div>
        </div>
        <div style="background:#1e2235; border-radius:8px; padding:10px 16px; text-align:center;">
          <div style="font-size:11px; color:#94a3b8">Expected Return</div>
          <div style="font-weight:700; color:#22c55e;">{{portfolio['expected_annual_return_percent']}}% / yr</div>
        </div>
        <div style="background:#1e2235; border-radius:8px; padding:10px 16px; text-align:center;">
          <div style="font-size:11px; color:#94a3b8">Rebalance</div>
          <div style="font-weight:700; color:#f59e0b;">{{portfolio['rebalance_frequency']}}</div>
        </div>
      </div>

      <div *ngFor="let item of allocation; let i = index" style="margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:4px;">
          <span>{{item['asset']}}</span>
          <span style="font-weight:700;">{{item['percent']}}%</span>
        </div>
        <div style="background:#0f1117; border-radius:4px; height:8px; overflow:hidden;">
          <div class="allocation-bar"
               [style.width.%]="item['percent']"
               [style.background]="getColor(i)">
          </div>
        </div>
      </div>

      <div *ngIf="portfolio['rationale']"
           style="color:#94a3b8; font-size:12px; margin-top:12px; font-style:italic;">
        {{portfolio['rationale']}}
      </div>
    </div>
  `,
})
export class PortfolioComponent {
  @Input() portfolio: Record<string, unknown> | null = null;

  get allocation(): Record<string, unknown>[] {
    return (this.portfolio?.['allocation'] as Record<string, unknown>[]) || [];
  }

  getColor(i: number): string {
    return COLORS[i % COLORS.length];
  }
}
