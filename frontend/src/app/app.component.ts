import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatComponent } from './components/chat/chat.component';
import { DynamicRendererComponent } from './components/dynamic-renderer/dynamic-renderer.component';
import { ProfileFormComponent } from './components/profile-form/profile-form.component';
import { HealthService, ServiceStatus } from './services/health.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ChatComponent, DynamicRendererComponent, ProfileFormComponent],
  template: `
    <div class="app-shell">

      <!-- Header with service status -->
      <header class="app-header">
        <div class="status-dot"></div>
        <h1>AI Financial Planner</h1>

        <!-- Service status pills -->
        <div style="display:flex; gap:8px; margin-left:auto;">
          <div *ngFor="let s of services"
               [title]="s.detail || s.status"
               style="display:flex; align-items:center; gap:4px; background:#1e2235;
                      border-radius:20px; padding:3px 10px; font-size:11px;">
            <span [style.background]="statusColor(s.status)"
                  style="width:6px; height:6px; border-radius:50%; display:inline-block;"></span>
            <span style="color:#94a3b8;">{{s.name}}</span>
          </div>
        </div>
      </header>

      <!-- Left: profile form + chat -->
      <div class="chat-panel">
        <app-profile-form (profileReady)="onProfileReady($event)"></app-profile-form>
        <app-chat #chatRef (responseReceived)="onResponseReceived($event)"></app-chat>
      </div>

      <!-- Right: dynamic rendered components -->
      <div class="main-panel">
        <app-dynamic-renderer [uiComponents]="uiComponents" [data]="data" [trace]="trace">
        </app-dynamic-renderer>
      </div>
    </div>
  `,
})
export class AppComponent implements OnInit {
  @ViewChild('chatRef') chatRef!: ChatComponent;

  uiComponents: { type: string }[] = [];
  data: Record<string, unknown> = {};
  trace: unknown[] = [];
  services: ServiceStatus[] = [];

  constructor(private healthService: HealthService) {}

  ngOnInit(): void {
    this.healthService.services$.subscribe((s) => (this.services = s));
  }

  onProfileReady(message: string): void {
    // Route the structured profile message straight into the chat
    this.chatRef?.send(message);
  }

  onResponseReceived(response: { ui: { type: string }[]; data: Record<string, unknown>; trace: unknown[] }): void {
    this.uiComponents = response.ui;
    this.data = response.data;
    this.trace = response.trace;
  }

  statusColor(status: string): string {
    if (status === 'ok') return '#22c55e';
    if (status === 'fallback') return '#f59e0b';
    if (status === 'checking') return '#94a3b8';
    return '#ef4444';
  }
}
