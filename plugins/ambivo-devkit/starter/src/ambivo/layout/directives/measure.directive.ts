// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Directive, input } from '@angular/core';

export type MeasureToken = 'narrow' | 'default' | 'wide';

/**
 * amMeasure — prose width in `ch` (45 / 65 / 80).
 *
 * Encodes the rule `amContainer` cannot express: a header's hint or a page's
 * intro paragraph wants a reading measure while the table beside it wants the
 * full column. Apply to text blocks; `am-header` applies it to its hint
 * automatically.
 */
@Directive({
  selector: '[amMeasure]',
  standalone: true,
  host: { '[attr.data-am-measure]': 'amMeasure()' },
})
export class MeasureDirective {
  readonly amMeasure = input<MeasureToken, MeasureToken | ''>('default', {
    transform: (v) => v || 'default',
  });
}
