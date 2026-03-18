import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface TraceItem {
  agent: string;
  latencyMs: number;
  output?: unknown;
}

@Component({
  selector: 'app-trace-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card">
      <h2>Execution Trace</h2>
      <div style="font-size:12px; color:#94a3b8; margin-bottom:8px;">
        Total: {{totalMs}}ms across {{traceItems.length}} agents
      </div>
      <div class="trace-item" *ngFor="let t of traceItems">
        <span class="trace-agent">{{t.agent}}</span>
        <div style="flex:1; background:#0f1117; border-radius:3px; height:6px; overflow:hidden; margin:0 8px;">
          <div [style.width.%]="getBarPct(t.latencyMs)"
               style="height:100%; background:#7c8cf8; border-radius:3px; transition:width 0.4s;">
          </div>
        </div>
        <span class="trace-latency">{{t.latencyMs}}ms</span>
      </div>
    </div>
  `,
})
export class TracePanelComponent {
  @Input() set trace(val: unknown[]) {
    this.traceItems = (val || []) as TraceItem[];
    this.maxMs = Math.max(...this.traceItems.map((t) => t.latencyMs), 1);
    this.totalMs = this.traceItems.reduce((sum, t) => sum + t.latencyMs, 0);
  }

  traceItems: TraceItem[] = [];
  maxMs = 1;
  totalMs = 0;

  getBarPct(ms: number): number {
    return Math.round((ms / this.maxMs) * 100);
  }
}
