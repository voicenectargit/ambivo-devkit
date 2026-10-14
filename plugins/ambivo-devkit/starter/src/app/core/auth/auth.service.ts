// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { ApiService } from '../api/api.service';
import { ApiError } from '../api/api-error';
import { APP_CONFIG } from '../config/app-config';
import { SessionTokenStore } from './session-token.store';
import { AuthUser, CodeSignInStep, MfaFactor, SignInProvider, SignInStep, mapUser } from './auth.types';

declare const ngDevMode: boolean | undefined;

/**
 * Sign-in with Ambivo credentials. Same calls as ambivo-nx `AuthService`;
 * tools/sync_from_nx.py --check fails if nx stops making them.
 *
 * Three ways in:
 * - email and password, then a code by email when the account has two-step
 *   verification. Two-step codes go by EMAIL only; this app never sets up SMS.
 * - a code alone, by email or text (`admin/sms/verifications`). An account with
 *   two-step verification on is refused (OTP_PASSWORD_REQUIRED) and uses its password.
 * - Google or Microsoft. The API sends the browser back to `/sign-in/return` with a
 *   one-time code only when the person's company registered this app's address
 *   (`user/tenant/app_origin`). It never creates an account.
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
  private static readonly CODE_TRUST_KEY = 'ambivo_code_device';
  private static readonly NEXT_KEY = 'ambivo_sign_in_next';
  private static readonly NONCE_KEY = 'ambivo_sign_in_nonce';

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

  /**
   * Send a sign-in code to an email address or a phone number.
   * `tenantId` answers the "which company?" question when the address is on
   * accounts in more than one company.
   */
  sendSignInCode(identifier: string, tenantId?: string): Observable<CodeSignInStep> {
    const value = identifier.trim();
    const channel = value.includes('@') ? 'email' : 'sms';
    const trust = this.readStored(AuthService.CODE_TRUST_KEY);
    return this.api
      .post({
        endpoint: 'admin/sms/verifications',
        body: {
          action: 'send_verification_code',
          channel,
          ...(channel === 'email' ? { email: value } : { phone_number: value }),
          ...(this.config.tenantId || tenantId ? { tenant_id: this.config.tenantId || tenantId } : {}),
          ...(trust ? { device_trust: trust } : {}),
        },
      })
      .pipe(
        map((res): CodeSignInStep => {
          if (res?.result === 3 && Array.isArray(res.tenant_list)) {
            return {
              kind: 'pick-company',
              companies: res.tenant_list.map((t: any) => ({ tenantId: t.tenant_id, name: t.name })),
            };
          }
          if (!res?.challenge_id) {
            throw new ApiError($localize`The code could not be sent. Try again.`, 'OTP_SEND_FAILED');
          }
          return {
            kind: 'code-sent',
            challengeId: res.challenge_id,
            channel: res.channel === 'sms' ? 'sms' : 'email',
            destination: res.destination_masked || value,
          };
        }),
      );
  }

  /** Check a sign-in code. Asks for the ordinary web session (`web_session: true`). */
  verifySignInCode(challengeId: string, code: string): Observable<SignInStep> {
    const trust = this.readStored(AuthService.CODE_TRUST_KEY);
    return this.api
      .post({
        endpoint: 'admin/sms/verifications',
        body: {
          action: 'verify_code',
          challenge_id: challengeId,
          code: code.trim(),
          // ⭐ Asks for the ordinary web session. Without it a code sign-in gets the long
          // mobile session (the API ignores is_mobile on this route).
          web_session: true,
          device_id: navigator.userAgent,
          os: navigator.platform,
          ...(trust ? { device_trust: trust } : {}),
        },
      })
      .pipe(
        tap((res) => res?.device_trust && this.writeStored(AuthService.CODE_TRUST_KEY, res.device_trust)),
        map((res) => this.adopt(res)),
      );
  }

  /**
   * Leave for Google or Microsoft. The browser comes back to `/sign-in/return`,
   * and `next` is where it goes after that.
   */
  startProviderSignIn(provider: SignInProvider, next: string): Observable<void> {
    // The nonce ties the return to THIS browser tab. Without it, someone could send
    // a colleague their own return link and sign the colleague in as themselves.
    let nonce: string;
    try {
      nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
      sessionStorage.setItem(AuthService.NEXT_KEY, next);
      sessionStorage.setItem(AuthService.NONCE_KEY, nonce);
    } catch {
      return throwError(() => new ApiError($localize`This browser cannot use Google or Microsoft sign-in here. Sign in another way.`, 'STORAGE_BLOCKED'));
    }
    // Under the app's <base href>, so an app served from a sub-path still comes back to itself.
    const returnUrl = new URL('sign-in/return', document.baseURI);
    returnUrl.searchParams.set('nonce', nonce);
    return this.api
      .post({
        endpoint: `user/register/${provider}`,
        body: {
          app_context: 'tenant',
          prompt_consent: false,
          app_return_url: returnUrl.toString(),
          os: navigator.platform,
          device_id: navigator.userAgent,
        },
      })
      .pipe(
        map((res) => {
          if (!res?.url) throw new ApiError($localize`Sign-in did not start. Try again.`, 'NO_PROVIDER_URL');
          window.location.assign(res.url);
        }),
      );
  }

  /** Did this tab start the sign-in that came back with `nonce`? Read once. */
  takeProviderNonceMatches(nonce: string | null): boolean {
    try {
      const saved = sessionStorage.getItem(AuthService.NONCE_KEY);
      sessionStorage.removeItem(AuthService.NONCE_KEY);
      return !!saved && saved === nonce;
    } catch {
      return false;
    }
  }

  /** Trade the one-time code from `/sign-in/return` for the session. Works once, for 60 seconds. */
  finishProviderSignIn(code: string): Observable<SignInStep> {
    return this.api
      .post({ endpoint: 'user/get_from_token', body: { token: code, device_id: navigator.userAgent } })
      .pipe(map((res) => this.adopt(res)));
  }

  /** Where to go after a Google or Microsoft sign-in, saved before leaving. Read once. */
  takeProviderNext(): string | null {
    try {
      const next = sessionStorage.getItem(AuthService.NEXT_KEY);
      sessionStorage.removeItem(AuthService.NEXT_KEY);
      return next;
    } catch {
      return null;
    }
  }

  /** Has this person's company turned on Google and Microsoft sign-in at this app's address? */
  providerSignInAllowedHere(): Observable<boolean> {
    return this.api
      .get({ endpoint: 'user/tenant/app_origin/list' })
      .pipe(map((res) => (res?.app_origin_list ?? []).some((o: any) => o?.origin === window.location.origin)));
  }

  /** Company admins: turn on Google and Microsoft sign-in at this app's address. */
  allowProviderSignInHere(): Observable<void> {
    return this.api
      .post({ endpoint: 'user/tenant/app_origin', body: { origin: window.location.origin } })
      .pipe(map(() => undefined));
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
  // The 30-day code sign-in device token works the same way: it gives this
  // device its own allowance of wrong codes, and opens nothing on its own.
  private readTrustToken(): string | null {
    return this.readStored(AuthService.TRUST_KEY);
  }

  private writeTrustToken(value: string): void {
    this.writeStored(AuthService.TRUST_KEY, value);
  }

  private readStored(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private writeStored(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage blocked: the next sign-in asks for a code again.
    }
  }
}
