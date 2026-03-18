import { Injectable, OnDestroy } from '@angular/core';
import { Subject, Observable } from 'rxjs';

export interface WsMessage {
  type: string;
  data?: unknown;
  agentName?: string;
  output?: unknown;
  sessionId?: string;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService implements OnDestroy {
  private ws: WebSocket | null = null;
  private messages$ = new Subject<WsMessage>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionId: string | null = null;

  connect(sessionId: string): void {
    this.sessionId = sessionId;
    if (this.ws) this.ws.close();

    const wsUrl = `ws://${window.location.hostname}:3000`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({ type: 'subscribe', sessionId }));
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        this.messages$.next(msg);
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      // Auto-reconnect after 3s
      this.reconnectTimer = setTimeout(() => {
        if (this.sessionId) this.connect(this.sessionId);
      }, 3000);
    };

    this.ws.onerror = (err) => {
      console.error('[WS] error', err);
    };
  }

  get messages(): Observable<WsMessage> {
    return this.messages$.asObservable();
  }

  ngOnDestroy(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.messages$.complete();
  }
}
