import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, interval } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import { of } from 'rxjs';

export interface ServiceStatus {
  name: string;
  status: 'ok' | 'fallback' | 'unavailable' | 'checking';
  detail?: string;
}

export interface HealthResponse {
  status: string;
  services: Record<string, { status: string; detail?: string }>;
}

@Injectable({ providedIn: 'root' })
export class HealthService {
  private _services$ = new BehaviorSubject<ServiceStatus[]>([
    { name: 'Backend', status: 'checking' },
    { name: 'Ollama',  status: 'checking' },
    { name: 'Redis',   status: 'checking' },
    { name: 'VectorDB',status: 'checking' },
  ]);

  readonly services$ = this._services$.asObservable();

  constructor(private http: HttpClient) {
    // Poll every 10 seconds
    this.check();
    interval(10_000).pipe(switchMap(() => this.fetchHealth())).subscribe((h) => this.apply(h));
  }

  private check(): void {
    this.fetchHealth().subscribe((h) => this.apply(h));
  }

  private fetchHealth() {
    return this.http.get<HealthResponse>('/api/health').pipe(
      catchError(() => of(null)),
    );
  }

  private apply(h: HealthResponse | null): void {
    if (!h) {
      this._services$.next([
        { name: 'Backend',  status: 'unavailable' },
        { name: 'Ollama',   status: 'unavailable' },
        { name: 'Redis',    status: 'unavailable' },
        { name: 'VectorDB', status: 'unavailable' },
      ]);
      return;
    }

    const s = h.services || {};
    this._services$.next([
      { name: 'Backend',  status: 'ok' },
      { name: 'Ollama',   status: (s['ollama']?.status as ServiceStatus['status'])   || 'unavailable', detail: s['ollama']?.detail },
      { name: 'Redis',    status: (s['redis']?.status as ServiceStatus['status'])    || 'unavailable' },
      { name: 'VectorDB', status: (s['chromadb']?.status as ServiceStatus['status']) || 'unavailable' },
    ]);
  }
}
