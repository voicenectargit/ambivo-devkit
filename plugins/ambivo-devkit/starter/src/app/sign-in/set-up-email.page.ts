// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { indicate } from '@am/shared/utils/rxjs';
import { AuthService } from '../core/auth/auth.service';
import { errorText, goToStep, safeNext } from './sign-in-step';

/**
 * The company requires a sign-in code and this account has none set up yet.
 * Set up codes by email, then finish signing in.
 */
@Component({
  selector: 'app-set-up-email-page',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (step(); as s) {
      <h1 class="mat-headline-small" i18n>Set up sign-in codes</h1>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (!challengeId()) {
        <p class="hint" i18n>Your company asks for a code each time you sign in. We will email codes to {{ s.email }}.</p>
        <div class="actions">
          <button mat-flat-button type="button" [disabled]="busy()" (click)="start(s.enrollmentToken)" i18n>Email me a code</button>
          <a mat-button routerLink="/sign-in" i18n>Back to sign in</a>
        </div>
      } @else {
        <p class="hint" i18n>We emailed a 6-digit code to {{ destination() }}.</p>
        <form (ngSubmit)="finish(s.enrollmentToken)">
          <mat-form-field appearance="fill">
            <mat-label i18n>Code</mat-label>
            <input matInput inputmode="numeric" autocomplete="one-time-code" maxlength="6" [formControl]="code" />
          </mat-form-field>
          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="busy() || code.invalid" i18n>Finish setup</button>
          </div>
        </form>
      }
    } @else {
      <p class="hint" i18n>Your sign-in has timed out. Sign in again.</p>
      <a mat-flat-button routerLink="/sign-in" i18n>Sign in</a>
    }
    @if (busy()) {
      <mat-progress-bar class="progress-bar" mode="indeterminate" />
    }
  `,
})
export class SetUpEmailPage {
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  private router = inject(Router);
  private next = safeNext(inject(ActivatedRoute).snapshot.queryParamMap.get('next'));

  protected step = computed(() => {
    const s = this.auth.pending();
    return s?.kind === 'set-up-email' ? s : null;
  });
  protected code = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{6}$/)] });
  protected challengeId = signal('');
  protected destination = signal('');
  protected busy = signal(false);
  protected error = signal('');

  protected start(enrollmentToken: string): void {
    this.error.set('');
    this.auth
      .startEmailSetup(enrollmentToken)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: ({ challengeId, destination }) => {
          this.challengeId.set(challengeId);
          this.destination.set(destination);
        },
        error: (err) =>
          this.error.set(
            err?.code === 'EMAIL_MFA_REQUIRES_CONFIRMED_EMAIL'
              ? $localize`Your email address is not confirmed yet. Confirm it from the email Ambivo sent you, then sign in again.`
              : errorText(err),
          ),
      });
  }

  protected finish(enrollmentToken: string): void {
    if (this.code.invalid) return;
    this.error.set('');
    this.auth
      .finishEmailSetup(enrollmentToken, this.challengeId(), this.code.value)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (step) => goToStep(this.router, step, this.next),
        error: (err) => {
          this.code.reset();
          this.error.set(errorText(err));
        },
      });
  }
}
