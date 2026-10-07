// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Directive, input } from '@angular/core';

export type SpaceToken = '3xs' | '2xs' | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/**
 * amInset — padding as a first-class atom (token-sized, logical properties).
 *
 * Padding lives here, never on `amSurface`: a padded surface with a scroller
 * inside insets the scrollbar away from the rounded edge. Compose:
 * - simple cards:   `<div amSurface amInset="lg">`
 * - scroll regions: inset goes INSIDE the scroller (the scaffold does this)
 * - wide-table scrollers take NO inline inset — the table reaches the surface
 *   edge and carries its gutter in first/last cell padding.
 */
@Directive({
  selector: '[amInset], [amInsetBlock], [amInsetInline]',
  standalone: true,
  host: {
    '[attr.data-am-inset]': 'amInset() || null',
    '[attr.data-am-inset-block]': 'amInsetBlock() || null',
    '[attr.data-am-inset-inline]': 'amInsetInline() || null',
  },
})
export class InsetDirective {
  /** Uniform padding. Bare attribute (`<div amInset>`) yields 'lg'. */
  readonly amInset = input<SpaceToken | '', SpaceToken | ''>('', {
    transform: (v) => (v === '' ? 'lg' : v),
  });
  readonly amInsetBlock = input<SpaceToken | ''>('');
  readonly amInsetInline = input<SpaceToken | 'none' | ''>('');
}
