// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Observable, of, Subject, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { APP_CONFIG } from '../config/app-config';
import { ApiError } from './api-error';

export interface ApiRequest {
  /** Path under the API base, e.g. `entity/data`. A leading `/` is ignored. */
  endpoint: string;
  body?: unknown;
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
}

const DEFAULT_ERROR_MESSAGE = $localize`Something went wrong. Try again.`;

function str(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Drop empty values and send objects as JSON, as ambivo-nx does. */
export function toParams(obj?: Record<string, unknown>): HttpParams {
  let params = new HttpParams();
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    params = params.append(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return params;
}

/**
 * Every call to the Ambivo API goes through here.
 *
 * ⭐ The API answers most failures with HTTP 200 and `result: 2` in the body.
 * A 405 for a wrong method arrives the same way. So the HTTP status alone says
 * nothing: this service turns `result: 2` into a thrown `ApiError`, and callers
 * only ever see successes in `next`.
 */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private apiUrl = inject(APP_CONFIG).apiUrl;

  /** Emits when the API says the session is no longer valid (HTTP 401). */
  readonly unauthorized$ = new Subject<void>();

  get<T = any>(request: ApiRequest): Observable<T> {
    return this.request<T>('GET', request);
  }

  post<T = any>(request: ApiRequest): Observable<T> {
    return this.request<T>('POST', request);
  }

  put<T = any>(request: ApiRequest): Observable<T> {
    return this.request<T>('PUT', request);
  }

  delete<T = any>(request: ApiRequest): Observable<T> {
    return this.request<T>('DELETE', request);
  }

  request<T = any>(method: string, request: ApiRequest): Observable<T> {
    const endpoint = request.endpoint.replace(/^\/+/, '');
    const url = new URL(endpoint, new URL(this.apiUrl, window.location.origin)).toString();
    return this.http
      .request<any>(method, url, {
        body: request.body,
        headers: request.headers,
        params: toParams(request.params),
      })
      .pipe(
        catchError((err: HttpErrorResponse) => throwError(() => this.fromHttpError(err, endpoint))),
        switchMap((res) =>
          res?.result === 2 ? throwError(() => this.fromRefusal(res, endpoint)) : of(res as T),
        ),
      );
  }

  private fromHttpError(err: HttpErrorResponse, endpoint: string): ApiError {
    if (err.status === 401) {
      this.unauthorized$.next();
      return new ApiError($localize`Your session has ended. Sign in again.`, 'AUTH_401', endpoint);
    }
    if (err.status === 0) {
      return new ApiError($localize`No connection. Check your internet and try again.`, 'NETWORK_ERROR', endpoint);
    }
    if (err.status === 403) {
      // The Ambivo firewall answers 403 to a browser on an address it does not allow.
      return new ApiError($localize`This address cannot reach Ambivo yet. Ask your administrator.`, 'HTTP_403', endpoint);
    }
    return err.error && typeof err.error === 'object'
      ? this.fromRefusal(err.error, endpoint)
      : new ApiError(DEFAULT_ERROR_MESSAGE, `HTTP_${err.status}`, endpoint);
  }

  /** Read the message and code out of a `result: 2` body. Same order as ambivo-nx. */
  private fromRefusal(res: any, endpoint: string): ApiError {
    const code =
      str(res.error_code) ||
      str(res.data?.error_code) ||
      str(res.error?.error_code) ||
      str(res.error?.code) ||
      str(res.response_code) ||
      str(res.response_code_list?.[0]) ||
      str(res.data?.response_code_list?.[0]) ||
      str(res.response?.response_code) ||
      'UNKNOWN';
    const message =
      str(res.error) ||
      str(res.error?.error) ||
      str(res.error?.message) ||
      str(res.response?.reason) ||
      str(res.response?.message) ||
      str(res.data?.error?.message) ||
      str(res.data?.msg_list?.[0]) ||
      str(res.data?.response_msg?.[0]) ||
      str(res.msg) ||
      str(res.msg_list?.[0]) ||
      str(res.response_msg?.[0]) ||
      str(res.response_msg_list?.[0]) ||
      DEFAULT_ERROR_MESSAGE;
    const raw = res?.attempts_remaining ?? res?.data?.attempts_remaining ?? res?.error?.attempts_remaining;
    const attempts = typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
    const data = res?.data && typeof res.data === 'object' && !Array.isArray(res.data) ? res.data : undefined;
    return new ApiError(message, code, endpoint, attempts, data);
  }
}
