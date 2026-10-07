// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { afterNextRender, Directive, ElementRef, inject, Injector } from '@angular/core';

/**
 * amStickyTop — depth-1 sticky. Escape hatch, not a framework.
 *
 * For content that pins WHILE ITS SECTION IS IN VIEW inside an amScroll:
 * group headers (A/B/C), date separators, section headings. These replace
 * each other at the same top — native sticky semantics, zero coordination.
 *
 * What earns the directive's existence is the two things features forget:
 * the OPAQUE BACKGROUND (`--am-surface-bg` at any tonal level) and the
 * Z TOKEN (no more z-index archaeology).
 *
 * NOT for permanently pinned rows (toolbar, tab strip, action bar) — those
 * are scaffold rows and were never conceptually sticky. Stated non-goal:
 * no stacked-sticky coordinator; a page needing ONE stacked level sets
 * `--am-sticky-offset` itself.
 */
@Directive({
  selector: '[amStickyTop]',
  standalone: true,
  host: { 'data-am-sticky-top': '' },
})
export class StickyTopDirective {
  constructor() {
    if (!ngDevMode) return;
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(
      () => {
        const scroller = el.closest('[data-am-scroll]');
        if (scroller?.getAttribute('data-am-scroll') === 'both') {
          console.warn(
            '[amStickyTop] is inert inside amScroll="both": a sticky row there spans the ' +
              'content width and scrolls sideways with it. Only table cells may be sticky ' +
              'in a biaxial scroller; permanently pinned rows belong in scaffold slots.',
            el,
          );
        }
      },
      { injector: inject(Injector) },
    );
  }
}

declare const ngDevMode: boolean | undefined;
