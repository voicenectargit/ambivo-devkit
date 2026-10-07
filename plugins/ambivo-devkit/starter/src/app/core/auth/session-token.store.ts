// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Injectable, signal } from '@angular/core';

/**
 * The session token, held in memory only.
 *
 * ⭐⭐ NEVER WRITE IT TO localStorage, sessionStorage OR A COOKIE. Ambivo's
 * external security assessment rejected a token readable from page script, and
 * ambivo-nx holds it in memory for that reason. The cost: a page reload means
 * signing in again. Ambivo's own apps restore the session from a cookie set on
 * `.ambivo.com`, and that cookie never reaches an app on another domain.
 */
@Injectable({ providedIn: 'root' })
export class SessionTokenStore {
  private _token = signal<string | null>(null);
  readonly token$ = this._token.asReadonly();

  get token(): string | null {
    return this._token();
  }

  set(token: string | null | undefined): void {
    this._token.set(token || null);
  }

  clear(): void {
    this._token.set(null);
  }
}
