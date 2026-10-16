// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive, input } from '@angular/core';

export type TextRole = 'secondary';

/**
 * amText — the text's colour role, from M3. Type is the M3 class
 * (`display-medium`, `body-small`, … — Figma's text styles), so the two are
 * independent:
 *
 * ```html
 * <div class="body-small" amText="secondary">Updated 2 hours ago</div>
 * ```
 *
 * - `secondary`: on-surface-variant — hints, meta lines, captions, labels.
 */
@Directive({
  selector: '[amText]',
  standalone: true,
  host: { '[attr.data-am-text]': 'amText()' },
})
export class TextDirective {
  readonly amText = input<TextRole, TextRole | ''>('secondary', {
    transform: (v) => v || 'secondary',
  });
}
