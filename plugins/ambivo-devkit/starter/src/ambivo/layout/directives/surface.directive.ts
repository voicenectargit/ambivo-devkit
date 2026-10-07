// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { booleanAttribute, Directive, inject, input } from '@angular/core';

export type SurfaceLevel =
  | 'surface'
  | 'container-lowest'
  | 'container-low'
  | 'container'
  | 'container-high'
  | 'container-highest';

export type RadiusToken = 'none' | 'sm' | 'md' | 'lg' | 'full';

import { ScrollDirective } from './scroll.directive';

/**
 * amSurface — tonal M3 container: tone + shape + clip. Nothing else.
 *
 * - NO padding (compose `amInset`; padding on the surface would inset the
 *   scrollbar away from the rounded edge).
 * - `overflow: clip` — never `hidden` — so no accidental scroll container is
 *   created and `position: sticky` keeps working inside a child `amScroll`.
 * - Publishes `--am-surface-bg` so sticky descendants stay opaque at any
 *   tonal level.
 *
 * Canonical pairing (scrollbar clipped by the rounded corners):
 * ```html
 * <div amSurface amSurfaceFill>
 *   <div amScroll> … </div>
 * </div>
 * ```
 * `amSurfaceFill` makes the surface adopt its parent's full height so the
 * child scroller gets a bounded viewport; the page component itself still
 * owns its host height (`:host { display: block; block-size: 100% }`).
 *
 * Same-host `amSurface amScroll` remains a legal escape hatch: the surface
 * yields overflow to the scroll axis, but the scrollbar is NOT corner-clipped
 * there — an element cannot clip its own scrollbar.
 */
@Directive({
  selector: '[amSurface]',
  standalone: true,
  host: {
    '[attr.data-am-surface]': 'amSurface()',
    '[attr.data-am-surface-fill]': 'amSurfaceFill() ? "" : null',
    '[style.--am-surface-radius]': 'radiusVar()',
  },
})
export class SurfaceDirective {
  /** Tonal level. Bare attribute (`<div amSurface>`) yields the default. */
  readonly amSurface = input<SurfaceLevel, SurfaceLevel | ''>('surface', {
    transform: (v) => v || 'surface',
  });

  /** Corner radius token. Namespaced: bare `radius` would collide when atoms stack. */
  readonly amSurfaceRadius = input<RadiusToken>('lg');

  /** Fill the parent's height — for a surface that wraps a page/panel scroller. */
  readonly amSurfaceFill = input(false, { transform: booleanAttribute });

  /** Same-host coordination (documented pattern — see class JSDoc). */
  protected readonly scrollSibling = inject(ScrollDirective, { optional: true, self: true });

  protected radiusVar(): string {
    return `var(--am-radius-${this.amSurfaceRadius()})`;
  }
}
