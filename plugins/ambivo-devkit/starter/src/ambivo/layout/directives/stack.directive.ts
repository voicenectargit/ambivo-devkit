// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Directive, input } from '@angular/core';
import type { SpaceToken } from './inset.directive';

/**
 * amStack — vertical flow with one gap. One of exactly two flow utilities
 * (with amCluster); the set does not grow toward a utility framework.
 */
@Directive({
  selector: '[amStack]',
  standalone: true,
  host: {
    'data-am-stack': '',
    '[attr.data-am-gap]': 'amStackGap()',
  },
})
export class StackDirective {
  readonly amStackGap = input<SpaceToken>('md');
}
