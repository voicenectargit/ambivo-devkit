// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Directive, input } from '@angular/core';

export type ContainerSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

/**
 * amContainer — caps the readable content column while the surface behind
 * stays full-width. LEFT-aligned against the page gutter, by design:
 * a centred variable-width column makes the heading jump horizontally on
 * every route change. There is deliberately NO `align` input — centring is a
 * property of focus pages (sign-in, onboarding) and lives in page-owned CSS.
 *
 * Sizes are their own scale, NOT the viewport breakpoints (a container equal
 * to the breakpoint touches both edges at exactly that width).
 */
@Directive({
  selector: '[amContainer]',
  standalone: true,
  host: { '[attr.data-am-container]': 'amContainer()' },
})
export class ContainerDirective {
  readonly amContainer = input<ContainerSize, ContainerSize | ''>('full', {
    transform: (v) => v || 'full',
  });
}
