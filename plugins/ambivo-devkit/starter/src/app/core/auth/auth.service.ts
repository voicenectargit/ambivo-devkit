// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ApiService } from '../api/api.service';
import { ApiError } from '../api/api-error';
import { APP_CONFIG } from '../config/app-config';
import { SessionTokenStore } from './session-token.store';
import { AuthUser, MfaFactor, SignInStep, mapUser } from './auth.types';

declare const ngDevMode: boolean | undefined;

/**
 * Sign-in with Ambivo credentials: email and password, then a code by email
 * when the account has two-step verification. Same calls as ambivo-nx
 * `AuthService`; tools/sync_from_nx.py --check fails if nx stops making them.
 *
 * Phase 1 sends codes by EMAIL only. The API also offers SMS; this app never
 * offers it or sets it up.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private session = inject(SessionTokenStore);
  private config = inject(APP_CONFIG);
  private router = inject(Router);

  private _user = signal<AuthUser | null>(null);
  readonly user = this._user.asReadonly();

  /** The step a sign-in is waiting on, shared by the sign-in screens. */
  readonly pending = signal<SignInStep | null>(null);
  /** "Remember this device" from the sign-in form, carried to the code screen. */
  private rememberDevice = false;

  private static readonly TRUST_KEY = 'ambivo_trust_device';

  constructor() {
    this.api.unauthorized$.subscribe(() => this.endLocally());
    // Development only (`ng serve`): lets the devkit's screenshot tool sign a headless browser in with
    // the sandbox session it already holds. It takes a token and reads nothing back. A production
    // build (`ng build`) sets ngDevMode to false at build time, so the code is not even in the bundle.
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      (globalThis as any).__ambivoDevSignIn = async (token: string) => {
        this.session.set(token);
        await firstValueFrom(this.refreshUser());
        return true;
      };
    }
  }

  get isSignedIn(): boolean {
    return !!this.session.token && !!this._user();
  }

  signIn(email: string, password: string, remember: boolean): Observable<SignInStep> {
    this.rememberDevice = remember;
    const trust = this.readTrustToken();
    return this.api
      .post({
        endpoint: 'user/login',
        body: {
          email: email.trim(),
          password,
          // Only when the deployment names a tenant: then the API refuses users from any other.
          ...(this.config.tenantId ? { tenant_id: this.config.tenantId } : {}),
          // ⭐ Always false. The API trusts this field as sent, and true buys a 180-day token.
          is_mobile: false,
          device_id: navigator.userAgent,
          os: navigator.platform,
          ...(trust ? { trust_device_token: trust } : {}),
        },
      })
      .pipe(map((res) => this.adopt(res)));
  }

  /** Pick a method after sign-in. Only email methods are offered. */
  chooseMethod(preMfaToken: string, factor: MfaFactor): Observable<SignInStep> {
    return this.api
      .post({ endpoint: 'user/mfa/initiate', body: { pre_mfa_token: preMfaToken, factor_id: factor.factorId } })
      .pipe(map((res) => this.adopt(res)));
  }

  verifyCode(step: Extract<SignInStep, { kind: 'enter-code' }>, code: string): Observable<SignInStep> {
    return this.api
      .post({
        endpoint: 'user/mfa/verify',
        body: {
          challenge_code: code.trim(),
          provider_challenge_id: step.challengeId,
          userid: step.userId,
          ...this.trustFields(),
        },
      })
      .pipe(map((res) => this.adopt(res)));
  }

  resendCode(step: Extract<SignInStep, { kind: 'enter-code' }>): Observable<void> {
    const body: Record<string, unknown> = {
      action: 'resend',
      userid: step.userId,
      provider_challenge_id: step.challengeId,
    };
    if (step.factorId) body['authentication_factor_id'] = step.factorId;
    return this.api.post({ endpoint: 'user/mfa/verify', body }).pipe(map(() => undefined));
  }

  /** The account must set up a code method before it can sign in. Send a code to its email. */
  startEmailSetup(enrollmentToken: string): Observable<{ challengeId: string; destination: string }> {
    return this.api
      .post({ endpoint: 'user/mfa/enroll_gate', body: { enrollment_token: enrollmentToken, mfa_type: 'email' } })
      .pipe(
        map((res) => ({
          challengeId: res?.provider_challenge_id ?? '',
          destination: res?.challenge_destination ?? '',
        })),
      );
  }

  finishEmailSetup(enrollmentToken: string, challengeId: string, code: string): Observable<SignInStep> {
    return this.api
      .post({
        endpoint: 'user/mfa/enroll_gate',
        body: {
          enrollment_token: enrollmentToken,
          mfa_type: 'email_verify',
          provider_challenge_id: challengeId,
          challenge_code: code.trim(),
          ...this.trustFields(),
        },
      })
      .pipe(map((res) => this.adopt(res)));
  }

  /**
   * Email a link to set a new password. The link opens Ambivo's own reset page.
   * The API refuses a `link_url` outside its allow-list (ambivo.com plus configured
   * brands), so a partner domain cannot host this page yet. After the reset the
   * person comes back here and signs in.
   */
  requestPasswordReset(email: string): Observable<void> {
    return this.api
      .post({ endpoint: 'user/reset_password', params: { email: email.trim() } })
      .pipe(map(() => undefined));
  }

  /** Reload the signed-in person from `user/data`. */
  refreshUser(): Observable<AuthUser> {
    return this.api.get({ endpoint: 'user/data' }).pipe(
      map((res) => mapUser(res?.user_data)),
      tap((user) => this._user.set(user)),
    );
  }

  signOut(): void {
    if (!this.session.token) return this.endLocally();
    this.api
      .post({ endpoint: 'user/logout' })
      .pipe(catchError(() => of(null)))
      .subscribe(() => this.endLocally());
  }

  /**
   * Does the signed-in person hold ANY of `privileges` on `module`?
   * Mirrors the API's own check (`has_module_access` in ambivo_api gen_utils.py),
   * so a button shown here is a call the API will accept:
   * `all` grants everything; `*` and then the module's own key are each checked;
   * a value of `"*"` means every privilege.
   */
  hasAccess(module: string, privileges: string[] = ['A', 'R']): boolean {
    const access = this._user()?.permissions;
    if (!access) return false;
    if ('all' in access) return true;
    for (const key of ['*', module]) {
      const granted = access[key];
      if (granted === undefined) continue;
      if (granted === '*') return true;
      if (Array.isArray(granted) && privileges.some((p) => granted.includes(p))) return true;
    }
    return false;
  }

  private endLocally(): void {
    this.session.clear();
    this._user.set(null);
    this.pending.set(null);
    this.router.navigate(['/sign-in']);
  }

  /** Turn any sign-in response into the next step, and keep the session when there is one. */
  private adopt(res: any): SignInStep {
    if (res?.trust_device_token) this.writeTrustToken(res.trust_device_token);

    const token: string | undefined = res?.user?.token ?? res?.token;
    if (token && res?.user) {
      const user = mapUser(res.user);
      if (this.config.tenantId && user.tenantId && user.tenantId !== this.config.tenantId) {
        throw new ApiError($localize`This account belongs to a different company. Use the address your company gave you.`, 'WRONG_TENANT');
      }
      this.session.set(token);
      this._user.set(user);
      return this.next({ kind: 'signed-in', user });
    }

    if (res?.requires_mfa_enrollment && res?.enrollment_token) {
      return this.next({ kind: 'set-up-email', enrollmentToken: res.enrollment_token, email: res.email });
    }

    if (res?.requires_factor_selection && res?.pre_mfa_token) {
      const factors: MfaFactor[] = (res.factor_list ?? [])
        .map((f: any) => ({ factorId: f.factor_id, type: f.type, destinationMasked: f.challenge_destination_masked }))
        .filter((f: MfaFactor) => f.type === 'email');
      if (!factors.length) return this.next({ kind: 'email-codes-only' });
      return this.next({ kind: 'choose-method', preMfaToken: res.pre_mfa_token, factors });
    }

    if (res?.provider_challenge_id && res?.userid) {
      if (res.type !== 'email') return this.next({ kind: 'email-codes-only' });
      return this.next({
        kind: 'enter-code',
        userId: res.userid,
        challengeId: res.provider_challenge_id,
        factorId: res.authentication_factor_id || undefined,
        channel: 'email',
        destination: res.challenge_destination,
      });
    }

    throw new ApiError($localize`Sign-in did not finish. Try again.`, 'UNEXPECTED_LOGIN_RESPONSE');
  }

  private next(step: SignInStep): SignInStep {
    this.pending.set(step.kind === 'signed-in' ? null : step);
    return step;
  }

  private trustFields(): Record<string, unknown> {
    return this.rememberDevice ? { trust_device: true, device_id: navigator.userAgent, os: navigator.platform } : {};
  }

  // The 14-day "remember this device" token may live in storage: it skips the
  // code step on this device and is checked against a live record by the API.
  // It is not a session and opens nothing on its own.
  private readTrustToken(): string | null {
    try {
      return localStorage.getItem(AuthService.TRUST_KEY);
    } catch {
      return null;
    }
  }

  private writeTrustToken(value: string): void {
    try {
      localStorage.setItem(AuthService.TRUST_KEY, value);
    } catch {
      // Storage blocked: the next sign-in asks for a code again.
    }
  }
}
