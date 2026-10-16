// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
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
        // With amStickyLeft it is a bar, the supported both-ways pattern.
        if (
          scroller?.getAttribute('data-am-scroll') === 'both' &&
          !el.hasAttribute('data-am-sticky-left')
        ) {
          console.warn(
            '[amStickyTop] inside amScroll="both" needs amStickyLeft on the same element: ' +
              'alone, a sticky row there spans the content width and scrolls sideways ' +
              'with it. With both it is a bar (see StickyLeftDirective).',
            el,
          );
        }
      },
      { injector: inject(Injector) },
    );
  }
}

declare const ngDevMode: boolean | undefined;
