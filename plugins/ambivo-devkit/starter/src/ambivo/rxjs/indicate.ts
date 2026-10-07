// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { finalize, Subject, tap } from 'rxjs';
import { Observable } from 'rxjs/internal/Observable';
import { prepare } from './prepare';
import { tapError } from './tap-error';
import { debounceTime } from 'rxjs/operators';
import { WritableSignal } from '@angular/core';

export interface IndicateOptions {
  waitForComplete?: boolean;
}

export function indicate<T>(
  indicator: Subject<boolean> | WritableSignal<boolean>,
  options?: IndicateOptions,
): (source: Observable<T>) => Observable<T> {
  return (source: Observable<T>): Observable<T> => {
    if (indicator instanceof Subject) {
      return source.pipe(
        debounceTime(1),
        prepare(() => indicator.next(true)),
        tapError(() => indicator.next(false)),
        options?.waitForComplete === true
          ? finalize(() => indicator.next(false))
          : tap(() => indicator.next(false)),
      );
    } else {
      return source.pipe(
        prepare(() => indicator.set(true)),
        tapError(() => indicator.set(false)),
        options?.waitForComplete === true
          ? finalize(() => indicator.set(false))
          : tap(() => indicator.set(false)),
      );
    }
    return source;
  };
}
