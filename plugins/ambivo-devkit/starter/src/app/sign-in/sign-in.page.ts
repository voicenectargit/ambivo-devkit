// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { indicate } from '@am/shared/utils/rxjs';
import { AuthService } from '../core/auth/auth.service';
import { errorText, goToStep, safeNext } from './sign-in-step';

@Component({
  selector: 'app-sign-in-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mat-headline-small" i18n>Sign in</h1>
    @if (error()) {
      <p class="error" role="alert">{{ error() }}</p>
    }
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-form-field appearance="fill">
        <mat-label i18n>Email</mat-label>
        <input matInput type="email" autocomplete="username" formControlName="email" />
      </mat-form-field>

      <mat-form-field appearance="fill">
        <mat-label i18n>Password</mat-label>
        <input matInput [type]="showPassword() ? 'text' : 'password'" autocomplete="current-password" formControlName="password" />
        <button
          mat-icon-button
          matSuffix
          type="button"
          [attr.aria-label]="showPassword() ? hidePasswordLabel : showPasswordLabel"
          (click)="showPassword.set(!showPassword())"
        >
          <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
        </button>
      </mat-form-field>

      <mat-checkbox formControlName="remember" i18n>Remember this device</mat-checkbox>

      <div class="actions">
        <button mat-flat-button type="submit" [disabled]="busy()" i18n>Sign in</button>
        <a mat-button routerLink="/reset-password" i18n>Forgot password?</a>
      </div>
    </form>
    @if (busy()) {
      <mat-progress-bar class="progress-bar" mode="indeterminate" />
    }
  `,
})
export class SignInPage {
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  private router = inject(Router);
  private next = safeNext(inject(ActivatedRoute).snapshot.queryParamMap.get('next'));

  protected busy = signal(false);
  protected error = signal('');
  protected showPassword = signal(false);
  protected showPasswordLabel = $localize`Show password`;
  protected hidePasswordLabel = $localize`Hide password`;

  protected form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    remember: new FormControl(true, { nonNullable: true }),
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.error.set($localize`Enter your email and password.`);
      return;
    }
    const { email, password, remember } = this.form.getRawValue();
    this.error.set('');
    this.auth
      .signIn(email, password, remember)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (step) => goToStep(this.router, step, this.next),
        error: (err) => this.error.set(errorText(err)),
      });
  }
}
