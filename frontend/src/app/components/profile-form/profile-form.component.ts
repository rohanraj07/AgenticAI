import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface ProfileFormData {
  name: string;
  age: number;
  income: number;
  savings: number;
  monthly_expenses: number;
  retirement_age: number;
  risk_tolerance: 'low' | 'medium' | 'high';
  goals: string;
}

@Component({
  selector: 'app-profile-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  styles: [`
    .form-label { display:block; font-size:11px; color:#94a3b8; margin-bottom:3px; }
    .form-input {
      width:100%; background:#0f1117; border:1px solid #2d3148; border-radius:6px;
      color:#e2e8f0; padding:7px 10px; font-size:13px; outline:none;
    }
    .form-input:focus { border-color:#7c8cf8; }
    .risk-btn {
      flex:1; padding:6px; border:1px solid; border-radius:6px;
      font-size:12px; font-weight:600; cursor:pointer; color:#e2e8f0; background:#1e2235;
    }
  `],
  template: `
    <div *ngIf="!submitted" class="card"
         style="margin-bottom:0; border-radius:0; border-left:none; border-right:none; border-top:none;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin-bottom:0;">Your Financial Profile</h2>
        <button (click)="collapsed = !collapsed"
          style="background:none; border:none; color:#7c8cf8; cursor:pointer; font-size:12px;">
          {{collapsed ? 'Expand' : 'Collapse'}}
        </button>
      </div>

      <div *ngIf="!collapsed">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:12px;">
          <div>
            <label class="form-label">Name</label>
            <input class="form-input" [(ngModel)]="form.name" placeholder="Your name" />
          </div>
          <div>
            <label class="form-label">Age</label>
            <input class="form-input" [(ngModel)]="form.age" type="number" min="18" max="100" />
          </div>
          <div>
            <label class="form-label">Annual Income (\$)</label>
            <input class="form-input" [(ngModel)]="form.income" type="number" min="0" />
          </div>
          <div>
            <label class="form-label">Current Savings (\$)</label>
            <input class="form-input" [(ngModel)]="form.savings" type="number" min="0" />
          </div>
          <div>
            <label class="form-label">Monthly Expenses (\$)</label>
            <input class="form-input" [(ngModel)]="form.monthly_expenses" type="number" min="0" />
          </div>
          <div>
            <label class="form-label">Target Retirement Age</label>
            <input class="form-input" [(ngModel)]="form.retirement_age" type="number" min="40" max="80" />
          </div>
        </div>

        <div style="margin-bottom:10px;">
          <label class="form-label">Risk Tolerance</label>
          <div style="display:flex; gap:8px; margin-top:4px;">
            <button *ngFor="let r of riskOptions"
              class="risk-btn"
              (click)="form.risk_tolerance = r.value"
              [style.background]="form.risk_tolerance === r.value ? r.color : '#1e2235'"
              [style.borderColor]="form.risk_tolerance === r.value ? r.color : '#2d3148'">
              {{r.label}}
            </button>
          </div>
        </div>

        <div style="margin-bottom:12px;">
          <label class="form-label">Financial Goals (comma-separated)</label>
          <input class="form-input" [(ngModel)]="form.goals"
            placeholder="e.g. retire at 55, buy a house, fund college" />
        </div>

        <button class="btn-send" style="width:100%;" (click)="submit()">
          Start Planning
        </button>
      </div>
    </div>

    <!-- Compact summary after submission -->
    <div *ngIf="submitted"
         style="padding:10px 16px; border-bottom:1px solid #2d3148; flex-shrink:0;
                display:flex; align-items:center; justify-content:space-between; font-size:12px;">
      <span style="color:#94a3b8;">
        Profile: <strong style="color:#e2e8f0;">{{resolvedName || form.name}}</strong>,
        age {{form.age}},
        income \${{form.income | number}}
      </span>
      <button (click)="submitted = false; collapsed = false"
        style="background:none; border:none; color:#7c8cf8; cursor:pointer; font-size:11px;">
        Edit
      </button>
    </div>
  `,
})
export class ProfileFormComponent {
  @Output() profileReady = new EventEmitter<string>();
  @Input() resolvedName: string | null = null;

  collapsed = false;
  submitted = false;

  form: ProfileFormData = {
    name: '',
    age: 35,
    income: 80000,
    savings: 200000,
    monthly_expenses: 3500,
    retirement_age: 65,
    risk_tolerance: 'medium',
    goals: 'retire comfortably',
  };

  riskOptions: { value: ProfileFormData['risk_tolerance']; label: string; color: string }[] = [
    { value: 'low',    label: 'Conservative', color: '#22c55e' },
    { value: 'medium', label: 'Balanced',     color: '#f59e0b' },
    { value: 'high',   label: 'Aggressive',   color: '#ef4444' },
  ];

  submit(): void {
    if (!this.form.name.trim()) this.form.name = 'User';
    this.submitted = true;
    this.collapsed = true;

    // Structured message the LLM will parse into a profile
    const msg =
      `My financial profile: Name: ${this.form.name}, Age: ${this.form.age}, ` +
      `Annual income: $${this.form.income}, Current savings: $${this.form.savings}, ` +
      `Monthly expenses: $${this.form.monthly_expenses}, ` +
      `Target retirement age: ${this.form.retirement_age}, ` +
      `Risk tolerance: ${this.form.risk_tolerance}, ` +
      `Goals: ${this.form.goals}. ` +
      `Please analyse my financial situation and tell me if I can retire at my target age.`;

    this.profileReady.emit(msg);
  }
}
