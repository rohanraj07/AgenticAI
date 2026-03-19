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

      <!-- Drop zone -->
      <div class="drop-zone"
           [class.dragging]="isDragging"
           [class.uploading]="uploading"
           (dragover)="onDragOver($event)"
           (dragleave)="isDragging = false"
           (drop)="onDrop($event)"
           (click)="fileInput.click()">

        <input #fileInput type="file" hidden
               accept=".txt,.json,.csv"
               (change)="onFileSelected($event)">

        <div *ngIf="!uploading && !result">
          <div style="font-size:24px; margin-bottom:8px;">⬆</div>
          <div style="font-size:13px; color:#e2e8f0;">Drop file or click to browse</div>
          <div style="font-size:11px; color:#64748b; margin-top:4px;">Tax docs · Bank statements · .txt or .json</div>
        </div>

        <div *ngIf="uploading" style="text-align:center;">
          <div class="spinner" style="margin:0 auto 8px;"></div>
          <div style="font-size:12px; color:#7c8cf8;">Extracting abstracted signals...</div>
          <div style="font-size:11px; color:#64748b; margin-top:4px;">Raw document is never stored</div>
        </div>

        <div *ngIf="result && !uploading" style="text-align:center;">
          <div style="font-size:20px; margin-bottom:6px;">✅</div>
          <div style="font-size:13px; color:#22c55e; font-weight:600;">{{ result.documentType | titlecase }} analyzed</div>
          <div style="font-size:11px; color:#64748b; margin-top:2px;">
            pii_stored: {{ result.ingestion.pii_stored }} · raw_stored: {{ result.ingestion.raw_document_stored }}
          </div>
        </div>
      </div>

      <!-- Privacy guarantee -->
      <div class="privacy-row">
        <span class="guarantee">✗ Not stored: SSN, account numbers, exact amounts</span>
        <span class="guarantee">✓ Stored: income_range, bracket, spending_level</span>
      </div>

      <!-- Result summary (after upload) -->
      <div *ngIf="result" class="result-summary">
        <div style="font-size:11px; color:#7c8cf8; font-weight:600; margin-bottom:6px;">ABSTRACTED SIGNALS EXTRACTED</div>
        <div class="kv-row" *ngFor="let kv of signalEntries">
          <span class="kv-key">{{ kv.key }}</span>
          <span class="kv-val">{{ kv.value }}</span>
        </div>
        <div style="margin-top:6px; font-size:11px; color:#94a3b8; font-style:italic;">
          {{ result.ingestion.abstracted_signals['primary_insight'] }}
        </div>
      </div>

      <!-- Error -->
      <div *ngIf="error" class="error-box">{{ error }}</div>

      <!-- Upload new -->
      <button *ngIf="result" class="btn-secondary" (click)="reset()">Upload another document</button>
    </div>
  `,
  styles: [`
    .upload-panel {
      background: #13151f; border: 1px solid #2d3148;
      border-radius: 12px; padding: 14px; margin-bottom: 12px;
    }
    .upload-header {
      display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;
    }
    .pii-badge {
      font-size: 10px; background: rgba(34,197,94,0.1); color: #22c55e;
      border: 1px solid rgba(34,197,94,0.3); border-radius: 10px; padding: 2px 8px;
    }
    .drop-zone {
      border: 2px dashed #2d3148; border-radius: 10px;
      padding: 20px; text-align: center; cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .drop-zone:hover, .drop-zone.dragging {
      border-color: #7c8cf8; background: rgba(124,140,248,0.05);
    }
    .drop-zone.uploading { cursor: default; border-color: #7c8cf8; }

    .privacy-row {
      display: flex; flex-direction: column; gap: 3px;
      margin-top: 8px; padding: 6px 8px;
      background: #0f1117; border-radius: 6px;
    }
    .guarantee { font-size: 10px; color: #64748b; }

    .result-summary {
      margin-top: 10px; background: #1a1d27; border: 1px solid #2d3148;
      border-radius: 8px; padding: 10px 12px;
    }

    .error-box {
      margin-top: 8px; padding: 8px 10px; background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.3); border-radius: 6px;
      font-size: 12px; color: #ef4444;
    }

    .btn-secondary {
      margin-top: 8px; width: 100%; background: transparent;
      border: 1px solid #2d3148; border-radius: 8px; color: #94a3b8;
      padding: 8px; font-size: 12px; cursor: pointer; transition: border-color 0.2s;
    }
    .btn-secondary:hover { border-color: #7c8cf8; color: #7c8cf8; }

    .kv-row { display:flex; justify-content:space-between; padding:4px 0; font-size:12px; border-bottom:1px solid #1e2235; }
    .kv-row:last-child { border-bottom:none; }
    .kv-key { color:#94a3b8; }
    .kv-val { font-weight:600; }
    .spinner { width:18px; height:18px; border:2px solid #2d3148; border-top-color:#7c8cf8;
               border-radius:50%; animation:spin 0.7s linear infinite; display:inline-block; }
    @keyframes spin { to { transform:rotate(360deg); } }
  `],
})
export class FileUploadComponent {
  @Input() sessionId: string | undefined;
  @Output() uploadComplete = new EventEmitter<UploadResponse>();

  isDragging = false;
  uploading  = false;
  result: UploadResponse | null = null;
  error: string | null = null;

  constructor(private uploadService: UploadService) {}

  get signalEntries(): { key: string; value: string }[] {
    if (!this.result) return [];
    const signals = this.result.ingestion.abstracted_signals;
    return Object.entries(signals)
      .filter(([k]) => k !== 'primary_insight' && k !== 'key_signals')
      .map(([key, value]) => ({ key, value: String(value) }));
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = true;
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.isDragging = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) this.process(file);
  }

  onFileSelected(e: Event): void {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) this.process(file);
  }

  private process(file: File): void {
    this.error    = null;
    this.result   = null;
    this.uploading = true;

    this.uploadService.uploadDocument(file, this.sessionId)
      .pipe(finalize(() => (this.uploading = false)))
      .subscribe({
        next: (res) => {
          this.result = res;
          this.uploadComplete.emit(res);
        },
        error: (err) => {
          this.error = err?.error?.error || err?.message || 'Upload failed';
        },
      });
  }

  reset(): void {
    this.result = null;
    this.error  = null;
  }
}
