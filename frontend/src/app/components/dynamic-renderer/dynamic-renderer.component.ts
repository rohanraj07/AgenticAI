import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { A2UIComponent } from '../../services/chat.service';
import { ProfileComponent }    from '../profile/profile.component';
import { SimulationComponent } from '../simulation/simulation.component';
import { PortfolioComponent }  from '../portfolio/portfolio.component';
import { RiskComponent }       from '../risk/risk.component';
import { ExplanationComponent } from '../explanation/explanation.component';
import { TracePanelComponent } from '../trace-panel/trace-panel.component';
import { TaxComponent }        from '../tax/tax.component';
import { CashflowComponent }   from '../cashflow/cashflow.component';

@Component({
  selector: 'app-dynamic-renderer',
  standalone: true,
  imports: [
    CommonModule,
    ProfileComponent,
    SimulationComponent,
    PortfolioComponent,
    RiskComponent,
    ExplanationComponent,
    TracePanelComponent,
    TaxComponent,
    CashflowComponent,
  ],
  template: `
    <div *ngIf="!uiComponents.length" style="text-align:center; color:#94a3b8; margin-top:80px;">
      <div style="font-size:48px; margin-bottom:16px;">💬</div>
      <div style="font-size:16px;">Ask a financial question to get started.</div>
      <div style="font-size:13px; margin-top:8px; color:#64748b;">
        Try: "Can I retire at 55?" or upload a tax / bank statement document.
      </div>
    </div>

    <ng-container *ngFor="let comp of uiComponents">
      <!-- A2UI v2: insight banner shown per panel -->
      <div *ngIf="comp.insight?.reason"
           style="font-size:11px; color:#64748b; padding:4px 12px 0; font-style:italic;">
        {{comp.insight.reason}}
      </div>
      <app-profile       *ngIf="comp.type === 'profile_summary'"   [profile]="comp.data['name'] ? comp.data : profile"></app-profile>
      <app-simulation    *ngIf="comp.type === 'simulation_chart'"  [simulation]="comp.data['can_retire_at_target'] !== undefined ? comp.data : simulation"></app-simulation>
      <app-portfolio     *ngIf="comp.type === 'portfolio_view'"    [portfolio]="comp.data['strategy'] ? comp.data : portfolio"></app-portfolio>
      <app-risk          *ngIf="comp.type === 'risk_dashboard'"    [risk]="comp.data['overall_risk_score'] !== undefined ? comp.data : risk"></app-risk>
      <app-tax           *ngIf="comp.type === 'tax_panel'"         [tax]="comp.data['tax_efficiency_score'] !== undefined ? comp.data : tax"></app-tax>
      <app-cashflow      *ngIf="comp.type === 'cashflow_panel'"    [cashflow]="comp.data['budget_health'] ? comp.data : cashflow"></app-cashflow>
      <app-explanation   *ngIf="comp.type === 'explanation_panel'" [data]="data"></app-explanation>
    </ng-container>

    <app-trace-panel *ngIf="trace?.length" [trace]="trace"></app-trace-panel>
  `,
})
export class DynamicRendererComponent implements OnChanges {
  @Input() uiComponents: A2UIComponent[] = [];
  @Input() data: Record<string, unknown> = {};
  @Input() trace: unknown[] = [];

  profile:    Record<string, unknown> | null = null;
  simulation: Record<string, unknown> | null = null;
  portfolio:  Record<string, unknown> | null = null;
  risk:       Record<string, unknown> | null = null;
  tax:        Record<string, unknown> | null = null;
  cashflow:   Record<string, unknown> | null = null;

  ngOnChanges(): void {
    this.profile    = (this.data?.['profile']    as Record<string, unknown>) ?? null;
    this.simulation = (this.data?.['simulation'] as Record<string, unknown>) ?? null;
    this.portfolio  = (this.data?.['portfolio']  as Record<string, unknown>) ?? null;
    this.risk       = (this.data?.['risk']       as Record<string, unknown>) ?? null;
    this.tax        = (this.data?.['tax']        as Record<string, unknown>) ?? null;
    this.cashflow   = (this.data?.['cashflow']   as Record<string, unknown>) ?? null;
  }
}
