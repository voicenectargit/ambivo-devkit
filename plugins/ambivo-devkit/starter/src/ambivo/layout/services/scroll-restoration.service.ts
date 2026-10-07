// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

/**
 * Per-URL scroll position store for `amScroll` viewports.
 * Positions are keyed by router URL + a per-page index of the scroller, so a
 * page with several scroll regions restores each independently. Best-effort:
 * if the Router is absent (tests, isolated stories), restoration is a no-op.
 */
@Injectable({ providedIn: 'root' })
export class ScrollRestorationService {
  private readonly router = inject(Router, { optional: true });
  private readonly store = new Map<string, { top: number; left: number }>();
  private readonly indices = new WeakMap<HTMLElement, number>();
  private counterUrl = '';
  private counter = 0;

  private key(el: HTMLElement): string | null {
    const url = this.router?.url;
    if (!url) return null;
    if (this.counterUrl !== url) {
      this.counterUrl = url;
      this.counter = 0;
    }
    let idx = this.indices.get(el);
    if (idx === undefined) {
      idx = this.counter++;
      this.indices.set(el, idx);
    }
    return `${url}#${idx}`;
  }

  save(el: HTMLElement): void {
    const key = this.key(el);
    if (key && (el.scrollTop || el.scrollLeft)) {
      this.store.set(key, { top: el.scrollTop, left: el.scrollLeft });
    }
  }

  restore(el: HTMLElement): void {
    const key = this.key(el);
    const pos = key ? this.store.get(key) : undefined;
    if (pos) {
      el.scrollTop = pos.top;
      el.scrollLeft = pos.left;
    }
  }
}
