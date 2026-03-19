import { Component, OnInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChatComponent } from './components/chat/chat.component';
import { DynamicRendererComponent } from './components/dynamic-renderer/dynamic-renderer.component';
import { ProfileFormComponent } from './components/profile-form/profile-form.component';
import { FileUploadComponent } from './components/file-upload/file-upload.component';
import { HealthService, ServiceStatus } from './services/health.service';
import { UploadResponse } from './services/upload.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, ChatComponent, DynamicRendererComponent, ProfileFormComponent, FileUploadComponent],
  template: `
    <div class="app-shell">

      <!-- Header -->
      <header class="app-header">
        <div class="status-dot"></div>
        <h1>AI Financial Planner</h1>

        <!-- Service status pills -->
        <div style="display:flex; gap:8px; margin-left:auto; align-items:center;">
          <div *ngFor="let s of services"
               [title]="s.detail || s.status"
               style="display:flex; align-items:center; gap:4px; background:#1e2235;
                      border-radius:20px; padding:3px 10px; font-size:11px;">
            <span [style.background]="statusColor(s.status)"
                  style="width:6px; height:6px; border-radius:50%; display:inline-block;"></span>
            <span style="color:#94a3b8;">{{s.name}}</span>
          </div>
          <!-- Reset session button -->
          <button *ngIf="currentSessionId" (click)="resetSession()"
            style="background:#1e2235; border:1px solid #ef4444; border-radius:20px;
                   color:#ef4444; font-size:11px; padding:3px 12px; cursor:pointer;">
            ↺ Reset Session
          </button>
        </div>
      </header>

      <!-- Left: profile form + file upload + chat -->
      <div class="chat-panel">
        <app-profile-form
          [resolvedName]="resolvedProfileName"
          (profileReady)="onProfileReady($event)">
        </app-profile-form>
        <app-file-upload
          [sessionId]="currentSessionId"
          (uploadComplete)="onUploadComplete($event)">
        </app-file-upload>
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
  currentSessionId: string | undefined;

  constructor(private healthService: HealthService) {}

  ngOnInit(): void {
    this.healthService.services$.subscribe((s) => (this.services = s));
  }

  /** Name resolved by LLM — kept in sync with what's shown in the right panel */
  get resolvedProfileName(): string | null {
    return (this.data?.['profile'] as Record<string, unknown>)?.['name'] as string ?? null;
  }

  onProfileReady(message: string): void {
    this.chatRef?.send(message);
  }

  onResponseReceived(response: { ui: { type: string }[]; data: Record<string, unknown>; trace: unknown[]; sessionId?: string }): void {
    // Chat response replaces layout — planner decided the full set of panels
    this.uiComponents = response.ui;
    this.data = { ...this.data, ...response.data };
    this.trace = response.trace;
    if (response.sessionId) this.currentSessionId = response.sessionId;
  }

  onUploadComplete(response: UploadResponse): void {
    // MERGE panels — keep all currently shown panels + add new ones from upload
    // (so tax panel stays when cashflow panel is added, and vice versa)
    const existingTypes = new Set(this.uiComponents.map(c => c.type));
    const newPanels = response.ui.filter(c => !existingTypes.has(c.type));
    this.uiComponents = [...this.uiComponents, ...newPanels];

    // Merge data — deep merge so existing profile/simulation stays intact
    this.data = { ...this.data, ...response.data };
    this.trace = [...(this.trace || []), ...(response.trace || [])];
    if (response.sessionId) this.currentSessionId = response.sessionId;

    // Surface AI explanation in chat now that user confirmed
    this.chatRef?.addAssistantMessage(
      `📄 **${response.documentType.replace(/_/g, ' ')} applied** (${response.confidence} confidence)\n\n` +
      `${response.message}\n\n` +
      `_pii_stored: ${response.ingestion.pii_stored} · raw_document_stored: ${response.ingestion.raw_document_stored}_`
    );
  }

  resetSession(): void {
    const sid = this.currentSessionId;
    // Clear all local state
    this.uiComponents   = [];
    this.data           = {};
    this.trace          = [];
    this.currentSessionId = undefined;

    // Notify backend to clear Redis + markdown file
    fetch(`http://localhost:3000/api/session/${sid}`, { method: 'DELETE' })
      .catch(() => {/* best-effort */});

    // Tell chat to reset
    this.chatRef?.resetSession();
  }

  statusColor(status: string): string {
    if (status === 'ok')       return '#22c55e';
    if (status === 'fallback') return '#f59e0b';
    if (status === 'checking') return '#94a3b8';
    return '#ef4444';
  }
}
