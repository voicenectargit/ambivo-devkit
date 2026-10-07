// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  forwardRef,
  inject,
  Injector,
  input,
  signal,
  type Signal,
} from '@angular/core';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { ScrollRestorationService } from '../services/scroll-restoration.service';

export type ScrollAxis = 'block' | 'inline' | 'both';

/**
 * Injection surface for "the nearest scroll viewport". `ScrollDirective`
 * provides itself as this, so descendants can `inject(ScrollRef)` to reach the
 * enclosing scroller (e.g. a virtual-scroll grid needing the viewport element).
 */
export abstract class ScrollRef {
  abstract readonly scrollElement: Signal<HTMLElement | null>;
}

/**
 * amScroll — one scroll viewport. No registry, no sticky coordination.
 *
 * Axis is a single enum on one directive — deliberately NOT amScrollX/Y:
 * split directives invite putting the axes on different elements, which
 * silently breaks sticky table headers (sticky pins only against the single
 * container that owns both axes).
 *
 * - `block` (default): vertical scroll, horizontal CLIPPED — accidental
 *   x-overflow is a visible bug, not a shipped scrollbar.
 * - `inline`: chip rows, tab strips, lanes.
 * - `both`: wide tables. Never wrap a table in a separate inline scroller
 *   inside a block scroller.
 *
 * Owns: keyboard access (WCAG 2.1.1), `--am-scroll-vw`, scroll restoration,
 * dev-mode shrink warning.
 */
@Directive({
  selector: '[amScroll]',
  standalone: true,
  hostDirectives: [CdkScrollable],
  providers: [{ provide: ScrollRef, useExisting: forwardRef(() => ScrollDirective) }],
  host: {
    '[attr.data-am-scroll]': 'amScroll()',
    '[attr.tabindex]': 'tabindex()',
    '[attr.role]': 'role()',
    '[attr.aria-label]': 'amScrollLabel() || null',
  },
})
export class ScrollDirective implements ScrollRef {
  /** Scroll axis. Bare attribute yields 'block'. */
  readonly amScroll = input<ScrollAxis, ScrollAxis | ''>('block', {
    transform: (v) => v || 'block',
  });

  /** Accessible name — required for `inline`/`both` (always focusable). */
  readonly amScrollLabel = input<string>('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly restoration = inject(ScrollRestorationService, { optional: true });

  /** True while `block`-axis content actually overflows (drives tabindex). */
  private readonly overflowing = signal(false);

  readonly scrollElement = signal<HTMLElement | null>(null);

  protected tabindex(): string | null {
    if (this.amScroll() !== 'block') return '0';
    return this.overflowing() ? '0' : null;
  }

  protected role(): string | null {
    return this.tabindex() !== null ? 'region' : null;
  }

  constructor() {
    const el = this.host.nativeElement;
    this.scrollElement.set(el);
    const destroyRef = inject(DestroyRef);

    if (ngDevMode && this.amScroll() !== 'block' && !this.amScrollLabel()) {
      console.warn(
        '[amScroll] inline/both scrollers are always keyboard-focusable and need an accessible name — set amScrollLabel.',
        el,
      );
    }

    afterNextRender(
      () => {
        // Restore before the user sees a jump.
        this.restoration?.restore(el);

        let raf = 0;
        const measure = () => {
          raf = 0;
          // Batched DOM write outside the observer callback (loop-notification safety).
          el.style.setProperty('--am-scroll-vw', `${el.clientWidth}px`);
          this.overflowing.set(el.scrollHeight > el.clientHeight + 1);

          if (ngDevMode) {
            // Heuristic: the host grew past its parent instead of scrolling —
            // an ancestor grid/flex track is missing minmax(0, …) / min-size: 0.
            const parent = el.parentElement;
            if (
              parent &&
              el.scrollHeight <= el.clientHeight + 1 &&
              el.clientHeight > parent.clientHeight + 1
            ) {
              console.warn(
                '[amScroll] host cannot scroll — an ancestor row/column never allowed shrinking. ' +
                  'Add minmax(0, 1fr) / min-block-size: 0 on the track that contains it.',
                el,
              );
            }
          }
        };
        const ro = new ResizeObserver(() => {
          if (!raf) raf = requestAnimationFrame(measure);
        });
        ro.observe(el);
        measure();

        destroyRef.onDestroy(() => {
          if (raf) cancelAnimationFrame(raf);
          ro.disconnect();
          this.restoration?.save(el);
        });
      },
      { injector: this.injector },
    );
  }
}

declare const ngDevMode: boolean | undefined;
