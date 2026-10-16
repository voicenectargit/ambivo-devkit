// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive, input } from '@angular/core';

/**
 * The five tones a status can take. Each maps once onto colours in
 * `_am-layout.scss` (`--am-tone-<t>-fg|bg|border`): primary and error onto the
 * M3 roles, success and warning onto `light-dark()` pairs (M3 has no such
 * roles), neutral onto the outline and surface roles.
 */
export type ToneToken = 'neutral' | 'primary' | 'success' | 'warning' | 'error';

/**
 * amTone — puts one tone on an element as `--am-tone-fg` (dot, bar, icon,
 * accent), `--am-tone-bg` (tinted background) and `--am-tone-border`.
 *
 * Status pieces — step bar, status dot, notice, meter segment, a late card —
 * read those three variables instead of choosing colours, so every status in
 * the product uses the same five and a theme change reaches all of them.
 */
@Directive({
  selector: '[amTone]',
  standalone: true,
  host: { '[attr.data-am-tone]': 'amTone()' },
})
export class ToneDirective {
  readonly amTone = input<ToneToken, ToneToken | ''>('neutral', {
    transform: (v) => v || 'neutral',
  });
}
