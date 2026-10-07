// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Router } from '@angular/router';
import { SignInStep } from '../core/auth/auth.types';
import { ApiError } from '../core/api/api-error';

/** Send the person to the screen for the next sign-in step. */
export function goToStep(router: Router, step: SignInStep, next: string): void {
  const queryParams = { next };
  switch (step.kind) {
    case 'signed-in':
      router.navigateByUrl(next || '/');
      return;
    case 'enter-code':
      router.navigate(['/sign-in/code'], { queryParams });
      return;
    case 'choose-method':
      router.navigate(['/sign-in/method'], { queryParams });
      return;
    case 'set-up-email':
      router.navigate(['/sign-in/set-up'], { queryParams });
      return;
    case 'email-codes-only':
      router.navigate(['/sign-in/email-codes-only']);
      return;
  }
}

/** Only accept a path inside this app as the place to go after sign-in. */
export function safeNext(value: string | null | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const left = err.attemptsRemaining;
    return left !== undefined ? $localize`${err.message}:message: ${left}:count: tries left.` : err.message;
  }
  return $localize`Something went wrong. Try again.`;
}
