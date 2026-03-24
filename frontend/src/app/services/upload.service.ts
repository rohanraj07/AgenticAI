import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { A2UIComponent } from './chat.service';

export interface UploadResponse {
  sessionId: string;
  message: string;
  documentType: string;
  confidence: string;
  ui: A2UIComponent[];
  data: Record<string, unknown>;
  ingestion: {
    document_type: string;
    abstracted_signals: Record<string, unknown>;
    pii_stored: boolean;
    raw_document_stored: boolean;
  };
  trace: unknown[];
}

@Injectable({ providedIn: 'root' })
export class UploadService {
  private readonly apiUrl = 'http://localhost:3000/api';

  constructor(private http: HttpClient) {}

  uploadDocument(file: File, sessionId?: string): Observable<UploadResponse> {
    const form = new FormData();
    form.append('document', file, file.name);
    if (sessionId) form.append('sessionId', sessionId);
    return this.http.post<UploadResponse>(`${this.apiUrl}/upload`, form);
  }
}
