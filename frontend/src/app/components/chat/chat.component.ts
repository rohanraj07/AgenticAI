import {
  Component, EventEmitter, OnInit, Output, OnDestroy,
  ViewChild, ElementRef, AfterViewChecked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs/operators';
import { ChatService, ChatResponse } from '../../services/chat.service';
import { WebSocketService, WsMessage } from '../../services/websocket.service';
import { Subscription } from 'rxjs';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const QUICK_ACTIONS = [
  'Can I retire at 55?',
  'Show my risk score',
  'Make portfolio aggressive',
  'Increase savings to $700k',
];

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Quick actions -->
    <div style="padding:12px 16px; border-bottom:1px solid #2d3148; flex-shrink:0;">
      <div style="font-size:12px; color:#94a3b8; margin-bottom:8px;">Quick actions</div>
      <div style="display:flex; flex-wrap:wrap; gap:6px;">
        <button
          *ngFor="let a of quickActions"
          (click)="send(a)"
          [disabled]="loading"
          style="background:#1e2235; border:1px solid #2d3148; border-radius:20px;
                 color:#94a3b8; font-size:11px; padding:4px 10px; cursor:pointer;">
          {{a}}
        </button>
      </div>
    </div>

    <!-- Message list -->
    <div class="chat-messages" #scrollArea>
      <div *ngFor="let msg of messages" [class]="'bubble ' + msg.role">
        {{msg.content}}
      </div>
      <div *ngIf="loading" class="bubble assistant thinking">
        <span class="spinner"></span>&nbsp;Thinking…
      </div>
    </div>

    <!-- Input row — always at the bottom -->
    <div class="chat-input-row" style="flex-shrink:0;">
      <input
        #inputEl
        [(ngModel)]="inputText"
        (keydown.enter)="send()"
        placeholder="Ask about your financial plan…"
        [disabled]="loading" />
      <button class="btn-send" (click)="send()" [disabled]="loading || !inputText.trim()">
        Send
      </button>
    </div>
  `,
})
export class ChatComponent implements OnInit, AfterViewChecked, OnDestroy {
  @Output() responseReceived = new EventEmitter<{
    ui: { type: string }[];
    data: Record<string, unknown>;
    trace: unknown[];
  }>();

  @ViewChild('scrollArea') private scrollArea!: ElementRef<HTMLDivElement>;
  @ViewChild('inputEl') private inputEl!: ElementRef<HTMLInputElement>;

  messages: ChatMessage[] = [];
  inputText = '';
  loading = false;
  sessionId: string | null = null;
  quickActions = QUICK_ACTIONS;

  private wsSub?: Subscription;
  private shouldScroll = false;

  constructor(
    private chatService: ChatService,
    private wsService: WebSocketService,
  ) {}

  ngOnInit(): void {
    this.messages.push({
      role: 'system',
      content: "Hello! I'm your AI financial planner. Ask me anything about your finances, or use the quick actions above.",
    });

    this.wsSub = this.wsService.messages.subscribe((msg: WsMessage) => {
      this.handleWsMessage(msg);
    });
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  send(text?: string): void {
    const message = (text || this.inputText).trim();
    if (!message || this.loading) return;

    this.inputText = '';
    this.loading = true;
    this.messages.push({ role: 'user', content: message });
    this.shouldScroll = true;

    this.chatService
      .sendMessage({ sessionId: this.sessionId ?? undefined, message })
      .pipe(finalize(() => { this.loading = false; }))
      .subscribe({
        next: (res: ChatResponse) => {
          this.sessionId = res.sessionId;
          this.messages.push({ role: 'assistant', content: res.message });
          this.shouldScroll = true;
          this.responseReceived.emit({ ui: res.ui, data: res.data, trace: res.trace });
          this.wsService.connect(res.sessionId);
          // Re-focus input after response
          setTimeout(() => this.inputEl?.nativeElement.focus(), 50);
        },
        error: (err) => {
          const msg = err?.error?.details || err?.error?.error || err.message || 'Unknown error';
          this.messages.push({ role: 'system', content: 'Error: ' + msg });
          this.shouldScroll = true;
        },
      });
  }

  private scrollToBottom(): void {
    try {
      const el = this.scrollArea?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    } catch { /* ignore */ }
  }

  private handleWsMessage(msg: WsMessage): void {
    if (msg.type === 'AGENT_STARTED') {
      // loading indicator already shown
    }
  }

  ngOnDestroy(): void {
    this.wsSub?.unsubscribe();
  }
}
