// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Directive, computed, input } from '@angular/core';
import type { SpaceToken } from './inset.directive';

export type PanesPreset = 'config-preview' | 'rail-canvas-rail';

/**
 * amPanes — horizontal division into independently scrolling panes.
 * Owns COLUMNS only; rows belong to the scaffold. The host contains panes
 * and nothing else — no toolbar rows inside.
 *
 * Presets keep sibling screens identical by construction:
 * - `config-preview`   → minmax(320px, 2fr) 3fr; stacks below 720px of the
 *                        nearest region (disable with amPanesStack="never")
 * - `rail-canvas-rail` → 280px 1fr 320px; never stacks (a workflow editor's
 *                        rails become drawers, not rows)
 *
 * A raw track list is accepted as the escape hatch; fr tracks are
 * shrink-wrapped so panes can actually scroll. Each direct child is a
 * container (`am-region`) — clusters and molecules inside respond to PANE
 * width, not the viewport.
 */
@Directive({
  selector: '[amPanes]',
  standalone: true,
  host: {
    '[attr.data-am-panes]': 'presetAttr()',
    '[attr.data-am-panes-stack]': 'amPanesStack()',
    '[attr.data-am-gap]': 'amPanesGap() || null',
    '[style.grid-template-columns]': 'rawTracks()',
  },
})
export class PanesDirective {
  readonly amPanes = input.required<PanesPreset | string>();
  readonly amPanesStack = input<'auto' | 'never'>('auto');
  readonly amPanesGap = input<SpaceToken | ''>('');

  private static readonly PRESETS: ReadonlySet<string> = new Set([
    'config-preview',
    'rail-canvas-rail',
  ]);

  protected readonly presetAttr = computed(() =>
    PanesDirective.PRESETS.has(this.amPanes()) ? this.amPanes() : 'custom',
  );

  /** Raw track list (escape hatch): shrink-wrap bare fr units. */
  protected readonly rawTracks = computed(() => {
    const v = this.amPanes();
    if (PanesDirective.PRESETS.has(v)) return null;
    return v.replace(/(^|\s)(\d+(?:\.\d+)?fr)(?=\s|$)/g, '$1minmax(0, $2)');
  });
}
