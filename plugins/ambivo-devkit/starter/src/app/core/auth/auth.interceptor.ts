// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { inject } from '@angular/core';
import { HttpInterceptorFn } from '@angular/common/http';
import { SessionTokenStore } from './session-token.store';

/** Send the session token as a bearer header. No token, no header. */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const token = inject(SessionTokenStore).token;
  if (!token || request.headers.has('Authorization')) return next(request);
  return next(request.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
};
