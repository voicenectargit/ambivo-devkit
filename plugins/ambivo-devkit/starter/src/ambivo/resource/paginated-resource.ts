// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { computed, linkedSignal, Signal, signal } from '@angular/core';
import { map, Observable, of, startWith } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, switchMap } from 'rxjs/operators';
import { indicate } from '@am/shared/utils/rxjs';
import { PaginatedRequest, PaginatedResponse } from '@am/shared/utils/types';
import { AbstractResource } from './abstract-resource.interface';

type ExtractResponseType<T> = T extends Observable<PaginatedResponse<infer R>> ? R : never;

interface PaginatedResourceConfig<
  TLoader extends (payload: any) => Observable<PaginatedResponse<any>>,
  TOutput = ExtractResponseType<ReturnType<TLoader>>,
> {
  pageSize: number | (() => number);
  params?: () => any;
  stream: TLoader;
  map?: (value: ExtractResponseType<ReturnType<TLoader>>) => TOutput;
}

export function paginatedResource<
  TLoader extends (payload: any) => Observable<PaginatedResponse<any>>,
  TOutput = ExtractResponseType<ReturnType<TLoader>>,
>(config: PaginatedResourceConfig<TLoader, TOutput>) {
  return new PaginatedResource<TLoader, TOutput>(config);
}

export class PaginatedResource<
  TLoader extends (payload: any) => Observable<PaginatedResponse<any>>,
  TOutput = ExtractResponseType<ReturnType<TLoader>>,
> implements
    AbstractResource<
      TOutput,
      PaginatedRequest & Record<string, any>,
      PaginatedResponse<ExtractResponseType<ReturnType<TLoader>>>
    >
{
  request: () => any = () => ({});
  loader!: TLoader;
  map: (value: ExtractResponseType<ReturnType<TLoader>>) => TOutput;
  isLoading = signal(false);
  pageSizeSource = signal<number | (() => number)>(20);
  pageSize = computed(() => {
    const source = this.pageSizeSource();
    return typeof source === 'function' ? source() : source;
  });
  pageIndex = linkedSignal({ source: computed(() => this.request()), computation: () => 0 });
  payload = computed(() => ({
    ...this.request(),
    pageSize: this.pageSize(),
    pageIndex: this.pageIndex(),
  }));

  /**
   * TODO: Remove missing "count" patch after API improved
   */
  response: Signal<PaginatedResponse<ExtractResponseType<ReturnType<TLoader>>> | undefined> =
    toSignal(
      toObservable(this.payload).pipe(
        switchMap((params) =>
          this.loader(params).pipe(
            indicate(this.isLoading),
            map((res) => ({ ...res, count: params.pageIndex ? this.totalCount() : res.count })),
            catchError(() =>
              of({ count: 0, data: [] as ExtractResponseType<ReturnType<TLoader>>[] }),
            ),
            params.pageIndex === 0 ? startWith(undefined) : map((v) => v),
          ),
        ),
      ),
    );

  data = computed<TOutput[] | undefined>(() => {
    const responseData = this.response()?.data;
    return responseData ? responseData.map((item) => this.map(item)) : undefined;
  });

  totalCount = computed(() => this.response()?.count ?? 0);
  totalPages = computed(() => Math.ceil(this.totalCount() / this.pageSize()));
  hasNextPage = computed(() => this.pageIndex() < this.totalPages() - 1);
  hasPrevPage = computed(() => this.pageIndex() > 0);
  isEmpty = computed(() => !this.isLoading() && this.data()?.length === 0);

  constructor(config: PaginatedResourceConfig<TLoader, TOutput>) {
    this.pageSizeSource.set(config.pageSize);
    this.loader = config.stream;
    this.map = config.map ?? ((value) => value as unknown as TOutput);
    if (config.params) this.request = config.params;
  }

  nextPage(): void {
    if (this.hasNextPage()) {
      this.pageIndex.set(this.pageIndex() + 1);
    }
  }

  prevPage(): void {
    if (this.hasPrevPage()) {
      this.pageIndex.set(this.pageIndex() - 1);
    }
  }

  goToPage(pageIndex: number): void {
    if (pageIndex >= 0 && pageIndex < this.totalPages()) {
      this.pageIndex.set(pageIndex);
    }
  }

  setPageSize(pageSize: number): void {
    this.pageSizeSource.set(pageSize);
    this.pageIndex.set(0);
  }

  setPage(page: { pageSize: number; pageIndex: number }): void {
    this.pageSizeSource.set(page.pageSize);
    this.pageIndex.set(page.pageIndex);
  }
}
