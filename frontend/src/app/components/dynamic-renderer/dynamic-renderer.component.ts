import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
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
      <app-profile       *ngIf="comp.type === 'profile_summary'"   [profile]="profile"></app-profile>
      <app-simulation    *ngIf="comp.type === 'simulation_chart'"  [simulation]="simulation"></app-simulation>
      <app-portfolio     *ngIf="comp.type === 'portfolio_view'"    [portfolio]="portfolio"></app-portfolio>
      <app-risk          *ngIf="comp.type === 'risk_dashboard'"    [risk]="risk"></app-risk>
      <app-tax           *ngIf="comp.type === 'tax_panel'"         [tax]="tax"></app-tax>
      <app-cashflow      *ngIf="comp.type === 'cashflow_panel'"    [cashflow]="cashflow"></app-cashflow>
      <app-explanation   *ngIf="comp.type === 'explanation_panel'" [data]="data"></app-explanation>
    </ng-container>

    <app-trace-panel *ngIf="trace?.length" [trace]="trace"></app-trace-panel>
  `,
})
export class DynamicRendererComponent implements OnChanges {
  @Input() uiComponents: { type: string }[] = [];
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
