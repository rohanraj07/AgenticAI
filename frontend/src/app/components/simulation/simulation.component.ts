import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-simulation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="simulation">
      <h2>Simulation Results</h2>

      <div style="display:flex; gap:16px; margin-bottom:16px; flex-wrap:wrap;">
        <div style="flex:1; min-width:140px; background:#1e2235; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Retire at Target?</div>
          <div [style.color]="simulation['can_retire_at_target'] ? '#22c55e' : '#ef4444'"
               style="font-size:22px; font-weight:700;">
            {{simulation['can_retire_at_target'] ? 'YES' : 'NO'}}
          </div>
        </div>
        <div style="flex:1; min-width:140px; background:#1e2235; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Projected Savings</div>
          <div style="font-size:18px; font-weight:700; color:#7c8cf8;">
            \${{$any(simulation['projected_savings_at_retirement']) | number:'1.0-0'}}
          </div>
        </div>
        <div style="flex:1; min-width:140px; background:#1e2235; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Monthly Surplus</div>
          <div [style.color]="surplusColor" style="font-size:18px; font-weight:700;">
            \${{$any(simulation['monthly_shortfall_or_surplus']) | number:'1.0-0'}}
          </div>
        </div>
        <div style="flex:1; min-width:140px; background:#1e2235; border-radius:8px; padding:12px; text-align:center;">
          <div style="font-size:11px; color:#94a3b8; margin-bottom:4px;">Years of Runway</div>
          <div style="font-size:18px; font-weight:700; color:#7c8cf8;">{{simulation['years_of_runway']}}</div>
        </div>
      </div>

      <div *ngIf="simulation['summary']" style="color:#94a3b8; font-size:13px; margin-bottom:16px;">
        {{simulation['summary']}}
      </div>

      <div *ngIf="milestones.length">
        <div style="font-size:12px; color:#7c8cf8; font-weight:600; margin-bottom:8px;">MILESTONES</div>
        <div class="timeline">
          <div class="timeline-item" *ngFor="let m of milestones">
            <span class="timeline-year">{{m['year']}}</span>
            <span class="timeline-note">\${{$any(m['savings']) | number:'1.0-0'}} — {{m['note']}}</span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SimulationComponent {
  @Input() simulation: Record<string, unknown> | null = null;

  get milestones(): Record<string, unknown>[] {
    return (this.simulation?.['milestones'] as Record<string, unknown>[]) || [];
  }

  get surplusColor(): string {
    const val = this.simulation?.['monthly_shortfall_or_surplus'];
    return (val as number) >= 0 ? '#22c55e' : '#ef4444';
  }
}
