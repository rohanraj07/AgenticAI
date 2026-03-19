import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UploadService, UploadResponse } from '../../services/upload.service';
import { finalize } from 'rxjs/operators';

@Component({
  selector: 'app-file-upload',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="upload-panel">
      <div class="upload-header">
        <span style="color:#7c8cf8; font-weight:600; font-size:13px;">📂 Upload Document</span>
        <span class="pii-badge">🔒 PII-Safe Processing</span>
      </div>

      <!-- Drop zone — only shown when idle -->
      <div *ngIf="!uploading && !pendingResult"
           class="drop-zone"
           [class.dragging]="isDragging"
           (dragover)="onDragOver($event)"
           (dragleave)="isDragging = false"
           (drop)="onDrop($event)"
           (click)="fileInput.click()">
        <input #fileInput type="file" hidden accept=".txt,.json,.csv"
               (change)="onFileSelected($event)">
        <div style="font-size:24px; margin-bottom:8px;">⬆</div>
        <div style="font-size:13px; color:#e2e8f0;">Drop file or click to browse</div>
        <div style="font-size:11px; color:#64748b; margin-top:4px;">Tax docs · Bank statements · .txt or .json</div>
      </div>

      <!-- Uploading spinner -->
      <div *ngIf="uploading" class="drop-zone" style="cursor:default;">
        <div class="spinner" style="margin:0 auto 8px;"></div>
        <div style="font-size:12px; color:#7c8cf8;">Extracting abstracted signals...</div>
        <div style="font-size:11px; color:#64748b; margin-top:4px;">Raw document is never stored</div>
      </div>

      <!-- ── CONFIRMATION STEP ──────────────────────────────── -->
      <div *ngIf="pendingResult && !applied" class="confirm-box">
        <div class="confirm-header">
          <span style="font-size:14px;">📄</span>
          <div>
            <div style="font-size:13px; font-weight:600; color:#e2e8f0;">
              {{ pendingResult.documentType | titlecase }} analyzed
              <span class="conf-badge">{{ pendingResult.confidence }} confidence</span>
            </div>
            <div style="font-size:11px; color:#94a3b8; margin-top:2px;">
              {{ pendingResult.ingestion.abstracted_signals['primary_insight'] }}
            </div>
          </div>
        </div>

        <!-- Abstracted signals preview -->
        <div class="signals-grid">
          <div *ngFor="let kv of signalEntries" class="signal-chip">
            <span class="chip-key">{{ kv.key }}</span>
            <span class="chip-val">{{ kv.value }}</span>
          </div>
        </div>

        <!-- PII guarantee -->
        <div class="pii-row">
          <span>✗ SSN, account numbers, exact amounts — NOT stored</span>
          <span>✓ income_range, bracket, spending_level — stored</span>
        </div>

        <!-- Confirmation question -->
        <div style="font-size:13px; color:#e2e8f0; margin:12px 0 8px; font-weight:500;">
          Apply this data to your financial plan?
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-apply" (click)="applyData()">
            ✓ Yes, update my plan
          </button>
          <button class="btn-discard" (click)="discardData()">
            ✗ Discard
          </button>
        </div>
      </div>

      <!-- Applied state -->
      <div *ngIf="applied" class="applied-box">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:8px;">
          <span style="font-size:16px;">✅</span>
          <span style="font-size:13px; color:#22c55e; font-weight:600;">
            {{ pendingResult?.documentType | titlecase }} applied to your plan
          </span>
        </div>
        <div style="font-size:11px; color:#64748b;">
          pii_stored: {{ pendingResult?.ingestion?.pii_stored }} ·
          raw_document_stored: {{ pendingResult?.ingestion?.raw_document_stored }}
        </div>
        <button class="btn-secondary" (click)="reset()">Upload another document</button>
      </div>

      <!-- Privacy row (always visible when idle) -->
      <div *ngIf="!uploading && !pendingResult && !applied" class="privacy-row">
        <span>✗ Not stored: SSN, account numbers, exact amounts</span>
        <span>✓ Stored: income_range, bracket, spending_level</span>
      </div>

      <!-- Error -->
      <div *ngIf="error" class="error-box">{{ error }}</div>
    </div>
  `,
  styles: [`
    .upload-panel {
      background: #13151f; border: 1px solid #2d3148;
      border-radius: 12px; padding: 14px; margin-bottom: 0;
      border-left: none; border-right: none; border-top: none; border-radius: 0;
    }
    .upload-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
    .pii-badge {
      font-size:10px; background:rgba(34,197,94,0.1); color:#22c55e;
      border:1px solid rgba(34,197,94,0.3); border-radius:10px; padding:2px 8px;
    }
    .drop-zone {
      border:2px dashed #2d3148; border-radius:10px; padding:16px;
      text-align:center; cursor:pointer; transition:border-color 0.2s, background 0.2s;
    }
    .drop-zone:hover, .drop-zone.dragging { border-color:#7c8cf8; background:rgba(124,140,248,0.05); }

    .confirm-box {
      background:#1a1d27; border:1px solid #2d3148; border-radius:10px; padding:12px;
    }
    .confirm-header { display:flex; gap:10px; align-items:flex-start; margin-bottom:10px; }
    .conf-badge {
      font-size:10px; background:rgba(124,140,248,0.15); color:#7c8cf8;
      border-radius:8px; padding:1px 6px; margin-left:6px; font-weight:400;
    }

    .signals-grid { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px; }
    .signal-chip {
      background:#0f1117; border:1px solid #2d3148; border-radius:6px;
      padding:4px 8px; font-size:11px; display:flex; gap:4px;
    }
    .chip-key { color:#64748b; }
    .chip-val { color:#e2e8f0; font-weight:600; }

    .pii-row {
      display:flex; flex-direction:column; gap:2px;
      background:#0f1117; border-radius:6px; padding:6px 8px; margin-bottom:10px;
      font-size:10px; color:#64748b;
    }

    .btn-apply {
      flex:1; background:#7c8cf8; color:#fff; border:none;
      border-radius:8px; padding:8px; font-size:12px; font-weight:600; cursor:pointer;
    }
    .btn-apply:hover { background:#5c6ef5; }
    .btn-discard {
      flex:1; background:transparent; color:#94a3b8;
      border:1px solid #2d3148; border-radius:8px; padding:8px;
      font-size:12px; cursor:pointer;
    }
    .btn-discard:hover { border-color:#ef4444; color:#ef4444; }

    .applied-box {
      background:rgba(34,197,94,0.05); border:1px solid rgba(34,197,94,0.2);
      border-radius:10px; padding:12px;
    }

    .privacy-row {
      display:flex; flex-direction:column; gap:3px;
      background:#0f1117; border-radius:6px; padding:6px 8px; margin-top:8px;
      font-size:10px; color:#64748b;
    }

    .btn-secondary {
      margin-top:8px; width:100%; background:transparent;
      border:1px solid #2d3148; border-radius:8px; color:#94a3b8;
      padding:7px; font-size:12px; cursor:pointer;
    }
    .btn-secondary:hover { border-color:#7c8cf8; color:#7c8cf8; }

    .error-box {
      margin-top:8px; padding:8px 10px; background:rgba(239,68,68,0.1);
      border:1px solid rgba(239,68,68,0.3); border-radius:6px; font-size:12px; color:#ef4444;
    }
    .spinner {
      width:18px; height:18px; border:2px solid #2d3148; border-top-color:#7c8cf8;
      border-radius:50%; animation:spin 0.7s linear infinite; display:inline-block;
    }
    @keyframes spin { to { transform:rotate(360deg); } }
  `],
})
export class FileUploadComponent {
  @Input() sessionId: string | undefined;
  @Output() uploadComplete = new EventEmitter<UploadResponse>();

  isDragging   = false;
  uploading    = false;
  applied      = false;
  error: string | null = null;
  pendingResult: UploadResponse | null = null;

  constructor(private uploadService: UploadService) {}

  get signalEntries(): { key: string; value: string }[] {
    if (!this.pendingResult) return [];
    const signals = this.pendingResult.ingestion.abstracted_signals;
    return Object.entries(signals)
      .filter(([k]) => k !== 'primary_insight' && k !== 'key_signals')
      .map(([key, value]) => ({ key, value: String(value) }));
  }

  onDragOver(e: DragEvent): void { e.preventDefault(); this.isDragging = true; }
  onDrop(e: DragEvent): void {
    e.preventDefault(); this.isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) this.process(file);
  }
  onFileSelected(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.process(file);
  }

  private process(file: File): void {
    this.error         = null;
    this.pendingResult = null;
    this.applied       = false;
    this.uploading     = true;

    this.uploadService.uploadDocument(file, this.sessionId)
      .pipe(finalize(() => (this.uploading = false)))
      .subscribe({
        next:  (res) => { this.pendingResult = res; },
        error: (err) => { this.error = err?.error?.error || err?.message || 'Upload failed'; },
      });
  }

  /** User confirmed — apply the data */
  applyData(): void {
    if (!this.pendingResult) return;
    this.applied = true;
    this.uploadComplete.emit(this.pendingResult);
  }

  /** User discarded — clear pending result, show drop zone again */
  discardData(): void {
    this.pendingResult = null;
    this.applied       = false;
  }

  reset(): void {
    this.pendingResult = null;
    this.applied       = false;
    this.error         = null;
  }
}
