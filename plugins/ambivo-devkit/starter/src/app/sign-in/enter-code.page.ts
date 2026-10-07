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
import { SignInStep } from '../core/auth/auth.types';
import { errorText, goToStep, safeNext } from './sign-in-step';

const MAX_RESENDS = 3;

/** Enter the 6-digit code that was emailed after sign-in. */
@Component({
  selector: 'app-enter-code-page',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (step(); as s) {
      <h1 class="mat-headline-small" i18n>Enter your code</h1>
      <p class="hint" i18n>We emailed a 6-digit code to {{ s.destination }}.</p>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      @if (notice()) {
        <p class="hint" role="status">{{ notice() }}</p>
      }
      <form (ngSubmit)="verify(s)">
        <mat-form-field appearance="fill">
          <mat-label i18n>Code</mat-label>
          <input matInput inputmode="numeric" autocomplete="one-time-code" maxlength="6" [formControl]="code" />
        </mat-form-field>
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="busy() || code.invalid" i18n>Continue</button>
          @if (resends() < maxResends) {
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="resend(s)" i18n>Send a new code</button>
          }
          <a mat-button routerLink="/sign-in" i18n>Back to sign in</a>
        </div>
      </form>
    } @else {
      <p class="hint" i18n>Your sign-in has timed out. Sign in again.</p>
      <a mat-flat-button routerLink="/sign-in" i18n>Sign in</a>
    }
    @if (busy()) {
      <mat-progress-bar class="progress-bar" mode="indeterminate" />
    }
  `,
})
export class EnterCodePage {
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  private router = inject(Router);
  private next = safeNext(inject(ActivatedRoute).snapshot.queryParamMap.get('next'));

  protected readonly maxResends = MAX_RESENDS;
  protected step = computed(() => {
    const s = this.auth.pending();
    return s?.kind === 'enter-code' ? s : null;
  });
  protected code = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{6}$/)] });
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');
  protected resends = signal(0);

  protected verify(step: Extract<SignInStep, { kind: 'enter-code' }>): void {
    if (this.code.invalid) return;
    this.error.set('');
    this.auth
      .verifyCode(step, this.code.value)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (nextStep) => goToStep(this.router, nextStep, this.next),
        error: (err) => {
          this.code.reset();
          this.error.set(errorText(err));
        },
      });
  }

  protected resend(step: Extract<SignInStep, { kind: 'enter-code' }>): void {
    this.resends.update((n) => n + 1);
    this.error.set('');
    this.auth
      .resendCode(step)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.notice.set($localize`A new code is on its way to ${step.destination}:destination:.`),
        error: (err) => this.error.set(errorText(err)),
      });
  }
}
