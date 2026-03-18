import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="profile">
      <h2>User Profile</h2>
      <div class="kv-row"><span class="kv-key">Name</span><span class="kv-val">{{profile['name']}}</span></div>
      <div class="kv-row"><span class="kv-key">Age</span><span class="kv-val">{{profile['age']}}</span></div>
      <div class="kv-row"><span class="kv-key">Annual Income</span><span class="kv-val">\${{$any(profile['income']) | number}}</span></div>
      <div class="kv-row"><span class="kv-key">Current Savings</span><span class="kv-val">\${{$any(profile['savings']) | number}}</span></div>
      <div class="kv-row"><span class="kv-key">Monthly Expenses</span><span class="kv-val">\${{$any(profile['monthly_expenses']) | number}}</span></div>
      <div class="kv-row"><span class="kv-key">Target Retirement Age</span><span class="kv-val">{{profile['retirement_age']}}</span></div>
      <div class="kv-row"><span class="kv-key">Risk Tolerance</span>
        <span class="kv-val" [style.color]="riskColor">{{profile['risk_tolerance']}}</span>
      </div>
      <div class="kv-row" *ngIf="profile['goals']">
        <span class="kv-key">Goals</span>
        <span class="kv-val">{{profile['goals'] | json}}</span>
      </div>
    </div>
  `,
})
export class ProfileComponent {
  @Input() profile: Record<string, unknown> | null = null;

  get riskColor(): string {
    const rt = (this.profile?.['risk_tolerance'] as string) || '';
    if (rt === 'low') return '#22c55e';
    if (rt === 'high') return '#ef4444';
    return '#f59e0b';
  }
}
