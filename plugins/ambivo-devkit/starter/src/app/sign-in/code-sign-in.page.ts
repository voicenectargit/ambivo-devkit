// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { indicate } from '@am/shared/utils/rxjs';
import { AuthService } from '../core/auth/auth.service';
import { CodeSignInStep } from '../core/auth/auth.types';
import { ApiError } from '../core/api/api-error';
import { errorText, goToStep, safeNext } from './sign-in-step';

const MAX_RESENDS = 3;

/** Sign in with a code sent by email or text, no password. */
@Component({
  selector: 'app-code-sign-in-page',
  imports: [FormsModule, ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (step()?.kind) {
      @case ('code-sent') {
        <h1 class="mat-headline-small" i18n>Enter your code</h1>
        <p class="hint" i18n>We sent a 6-digit code to {{ sentTo() }}.</p>
      }
      @case ('pick-company') {
        <h1 class="mat-headline-small" i18n>Choose your company</h1>
        <p class="hint" i18n>You have an account in more than one company.</p>
      }
      @default {
        <h1 class="mat-headline-small" i18n>Sign in with a code</h1>
        <p class="hint" i18n>We send a code to your email or phone.</p>
      }
    }
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
      @if (needsPassword()) {
        <a mat-flat-button routerLink="/sign-in" [queryParams]="{ next }" i18n>Sign in with password</a>
      }
    }
    @if (notice()) {
      <p class="hint" role="status">{{ notice() }}</p>
    }

    @switch (step()?.kind) {
      @case ('code-sent') {
        <form (ngSubmit)="verify()">
          <mat-form-field appearance="fill">
            <mat-label i18n>Code</mat-label>
            <input matInput inputmode="numeric" autocomplete="one-time-code" maxlength="6" [formControl]="code" />
          </mat-form-field>
          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="busy() || code.invalid" i18n>Continue</button>
            @if (resends() < maxResends) {
              <button mat-stroked-button type="button" [disabled]="busy()" (click)="resend()" i18n>Send a new code</button>
            }
            <button mat-button type="button" (click)="startOver()" i18n>Use a different email or phone</button>
          </div>
        </form>
      }
      @case ('pick-company') {
        <div class="actions">
          @for (company of companies(); track company.tenantId) {
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="send(company.tenantId)">
              {{ company.name }}
            </button>
          }
          <button mat-button type="button" (click)="startOver()" i18n>Back</button>
        </div>
      }
      @default {
        <form (ngSubmit)="send()">
          <mat-form-field appearance="fill">
            <mat-label i18n>Email or phone number</mat-label>
            <input matInput autocomplete="username" [formControl]="identifier" />
            <mat-hint i18n>For a phone, start with + and the country code.</mat-hint>
          </mat-form-field>
          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="busy()" i18n>Send code</button>
            <a mat-button routerLink="/sign-in" [queryParams]="{ next }" i18n>Sign in with password</a>
          </div>
        </form>
      }
    }
    @if (busy()) {
      <mat-progress-bar class="progress-bar" mode="indeterminate" />
    }
  `,
})
export class CodeSignInPage {
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  private router = inject(Router);
  protected next = safeNext(inject(ActivatedRoute).snapshot.queryParamMap.get('next'));

  protected readonly maxResends = MAX_RESENDS;
  protected identifier = new FormControl('', { nonNullable: true, validators: [Validators.required] });
  protected code = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.pattern(/^\d{6}$/)] });
  protected step = signal<CodeSignInStep | null>(null);
  protected busy = signal(false);
  protected error = signal('');
  protected notice = signal('');
  protected needsPassword = signal(false);
  protected resends = signal(0);
  /** The company picked, kept so "Send a new code" goes to the same account. */
  private tenantId: string | undefined;

  protected sentTo(): string {
    const s = this.step();
    return s?.kind === 'code-sent' ? s.destination : '';
  }

  protected companies(): { tenantId: string; name: string }[] {
    const s = this.step();
    return s?.kind === 'pick-company' ? s.companies : [];
  }

  protected send(tenantId?: string, resent = false): void {
    if (this.identifier.invalid) {
      this.error.set($localize`Enter your email or phone number.`);
      return;
    }
    if (tenantId) this.tenantId = tenantId;
    this.clearMessages();
    this.auth
      .sendSignInCode(this.identifier.value, this.tenantId)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (step) => {
          this.code.reset();
          this.step.set(step);
          if (resent) this.notice.set($localize`A new code is on its way to ${this.sentTo()}:destination:.`);
        },
        error: (err) => this.showError(err),
      });
  }

  protected resend(): void {
    this.resends.update((n) => n + 1);
    this.send(undefined, true);
  }

  protected verify(): void {
    const s = this.step();
    if (s?.kind !== 'code-sent' || this.code.invalid) return;
    this.clearMessages();
    this.auth
      .verifySignInCode(s.challengeId, this.code.value)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (nextStep) => goToStep(this.router, nextStep, this.next),
        error: (err) => {
          this.code.reset();
          this.showError(err);
        },
      });
  }

  protected startOver(): void {
    this.tenantId = undefined;
    this.resends.set(0);
    this.clearMessages();
    this.step.set(null);
  }

  private clearMessages(): void {
    this.error.set('');
    this.notice.set('');
    this.needsPassword.set(false);
  }

  private showError(err: unknown): void {
    const code = err instanceof ApiError ? err.code : '';
    if (code === 'OTP_PASSWORD_REQUIRED') {
      this.needsPassword.set(true);
      this.error.set($localize`This account signs in with a password and a second check.`);
      return;
    }
    if (code === 'PHONE_INVALID') {
      this.error.set($localize`Enter the full phone number. Start with + and the country code.`);
      return;
    }
    this.error.set(errorText(err));
  }
}
