// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Pages behind sign-in. Sends the person to sign in, then back to where they were going. */
export const signedInGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isSignedIn) return true;
  return inject(Router).createUrlTree(['/sign-in'], { queryParams: { next: state.url } });
};
