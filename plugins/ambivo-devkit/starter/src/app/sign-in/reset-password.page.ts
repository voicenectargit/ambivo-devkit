// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { indicate } from '@am/shared/utils/rxjs';
import { AuthService } from '../core/auth/auth.service';
import { errorText } from './sign-in-step';

@Component({
  selector: 'app-reset-password-page',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mat-headline-small" i18n>Reset your password</h1>
    @if (sentTo()) {
      <p class="hint" role="status" i18n>If {{ sentTo() }} has an account, we emailed it a link to set a new password. Then come back here and sign in.</p>
      <div class="actions">
        <a mat-flat-button routerLink="/sign-in" i18n>Back to sign in</a>
      </div>
    } @else {
      <p class="hint" i18n>Enter your email. We will send you a link to set a new password.</p>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <form (ngSubmit)="send()">
        <mat-form-field appearance="fill">
          <mat-label i18n>Email</mat-label>
          <input matInput type="email" autocomplete="username" [formControl]="email" />
        </mat-form-field>
        <div class="actions">
          <button mat-flat-button type="submit" [disabled]="busy() || email.invalid" i18n>Send link</button>
          <a mat-button routerLink="/sign-in" i18n>Back to sign in</a>
        </div>
      </form>
    }
    @if (busy()) {
      <mat-progress-bar class="progress-bar" mode="indeterminate" />
    }
  `,
})
export class ResetPasswordPage {
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  protected email = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });
  protected busy = signal(false);
  protected error = signal('');
  protected sentTo = signal('');

  protected send(): void {
    if (this.email.invalid) return;
    this.error.set('');
    this.auth
      .requestPasswordReset(this.email.value)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.sentTo.set(this.email.value.trim()),
        error: (err) => this.error.set(errorText(err)),
      });
  }
}
