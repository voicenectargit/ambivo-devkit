// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../core/auth/auth.service';
import { errorText, goToStep, safeNext } from './sign-in-step';

/** Error codes the API puts on `?error=` when a Google or Microsoft sign-in comes back. */
const RETURN_ERRORS: Record<string, string> = {
  APP_ORIGIN_NOT_ALLOWED: $localize`Google and Microsoft sign-in is off for this app. Ask your company admin to turn it on.`,
  ACCOUNT_NOT_FOUND: $localize`No account uses that email. Sign in with your password or a code.`,
  PASSWORD_REQUIRED: $localize`This account signs in with a password and a second check.`,
  SIGN_IN_FAILED: $localize`Sign-in did not finish. Try again.`,
};

/**
 * Google or Microsoft sends the browser here. The API adds `?code=`, a one-time
 * code that works once within 60 seconds, or `?error=`.
 */
@Component({
  selector: 'app-sign-in-return-page',
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error()) {
      <h1 class="mat-headline-small" i18n>Sign-in did not finish</h1>
      <p class="error" role="alert">{{ error() }}</p>
      <a mat-flat-button routerLink="/sign-in" i18n>Back to sign in</a>
    } @else {
      <h1 class="mat-headline-small" i18n>Signing you in</h1>
      <mat-progress-bar class="progress-bar" mode="indeterminate" />
    }
  `,
})
export class SignInReturnPage implements OnInit {
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  protected error = signal('');

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    const code = params.get('code');
    const failure = params.get('error');
    const next = safeNext(this.auth.takeProviderNext());
    const sameTab = this.auth.takeProviderNonceMatches(params.get('nonce'));
    // Take the code out of the address bar and the browser history at once.
    history.replaceState(history.state, '', new URL('sign-in/return', document.baseURI).pathname);

    if (!failure && code && !sameTab) {
      // A return this tab did not start: never sign in with someone else's code.
      this.error.set(RETURN_ERRORS['SIGN_IN_FAILED']);
      return;
    }
    if (failure || !code) {
      this.error.set(RETURN_ERRORS[failure ?? ''] ?? RETURN_ERRORS['SIGN_IN_FAILED']);
      return;
    }
    this.auth
      .finishProviderSignIn(code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (step) => goToStep(this.router, step, next),
        error: (err) => this.error.set(errorText(err)),
      });
  }
}
