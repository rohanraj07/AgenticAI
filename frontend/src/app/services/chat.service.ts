import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ChatRequest {
  sessionId?: string;
  message: string;
}

export interface UiComponent {
  type: string;
  [key: string]: unknown;
}

export interface TraceItem {
  agent: string;
  latencyMs: number;
  output: unknown;
}

export interface ChatResponse {
  sessionId: string;
  message: string;
  ui: UiComponent[];
  data: {
    profile: Record<string, unknown> | null;
    simulation: Record<string, unknown> | null;
    portfolio: Record<string, unknown> | null;
    risk: Record<string, unknown> | null;
  };
  trace: TraceItem[];
}

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly apiBase = '/api';

  constructor(private http: HttpClient) {}

  sendMessage(req: ChatRequest): Observable<ChatResponse> {
    return this.http.post<ChatResponse>(`${this.apiBase}/chat`, req);
  }

  getSession(sessionId: string): Observable<Record<string, unknown>> {
    return this.http.get<Record<string, unknown>>(`${this.apiBase}/session/${sessionId}`);
  }
}
