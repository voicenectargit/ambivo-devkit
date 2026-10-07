// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Observable } from 'rxjs/internal/Observable';
import { tap } from 'rxjs';

/**
 * Do something on error
 * Example:
 * observable$.pipe(tapError(()=>this._snackbar.open('Something went wrong')))
 * @param callback
 */
export function tapError(callback: (error?: any) => void) {
  return function <T>(source: Observable<T>): Observable<T> {
    return source.pipe(tap(null, callback));
  };
}
