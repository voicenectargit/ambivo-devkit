// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Observable } from 'rxjs/internal/Observable';
import { Signal } from '@angular/core';

export interface AbstractResource<T, TRequest, TResponse> {
  data: Signal<T[] | undefined>;
  request: () => TRequest;
  loader: (params: TRequest) => Observable<TResponse>;
  nextPage: () => void;
  prevPage: () => void;
  hasNextPage: Signal<boolean>;
  hasPrevPage: Signal<boolean>;
  isLoading: Signal<boolean>;
  isEmpty: Signal<boolean>;
}
