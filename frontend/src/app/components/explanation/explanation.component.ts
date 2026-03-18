import { Component, Input, OnChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-explanation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="card" *ngIf="explanationText">
      <h2>Explanation</h2>
      <p style="font-size:14px; line-height:1.7; color:#e2e8f0;">{{explanationText}}</p>
    </div>
  `,
})
export class ExplanationComponent implements OnChanges {
  @Input() data: Record<string, unknown> = {};
  explanationText = '';

  ngOnChanges(): void {
    // The explanation is delivered via the chat message; here we read it from data if available
    this.explanationText = (this.data?.['explanation'] as string) || '';
  }
}
