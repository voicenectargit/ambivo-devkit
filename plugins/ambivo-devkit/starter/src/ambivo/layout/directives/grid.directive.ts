// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive, computed, input } from '@angular/core';
import { atomValue, mergeVars, type Responsive } from '../types/responsive';
import { spaceCss, type SpaceOrNone } from '../types/space';

/** Smallest tile width: `--am-tile-sm|md|lg` (200 / 280 / 360px). */
export type TileToken = 'sm' | 'md' | 'lg';

/** Named page splits. */
export type GridPreset = 'config-preview' | 'rail-canvas-rail';

const PRESETS: ReadonlySet<string> = new Set<GridPreset>(['config-preview', 'rail-canvas-rail']);

/**
 * amGrid — children laid out in a grid. Two forms, one atom:
 *
 * **Tiles** (bare `amGrid`): equal tiles that fill each row and wrap — KPI
 * tiles, dashboard cards, a pair of summary cards. As many per row as fit at
 * `amGridMin`, all the same width; one per row once the grid is narrower.
 *
 * **Splits** (`amGrid="config-preview"`): a page divided into independently
 * scrolling panes, by preset, so sibling screens are identical by
 * construction. Columns only; the host contains panes and nothing else.
 * - `config-preview`   → minmax(320px, 2fr) 3fr; stacks below 720px of the
 *                        nearest region (disable with amGridStack="never")
 * - `rail-canvas-rail` → 280px 1fr 320px; never stacks (a workflow editor's
 *                        rails become drawers, not rows)
 * A raw track list is the escape hatch (`amGrid="240px 1fr"`); bare fr tracks
 * are shrink-wrapped so panes can scroll. Each pane is a query container
 * (`am-region`), so what is inside follows the PANE width.
 *
 * `amGridGap` defaults to `sm` for tiles and to none for a split.
 */
@Directive({
  selector: '[amGrid]',
  standalone: true,
  host: {
    '[attr.data-am-grid]': 'mode()',
    '[attr.data-am-grid-stack]': "mode() === '' ? null : amGridStack()",
    '[attr.data-am-tile]': "mode() === '' ? tile().attr : null",
    '[attr.data-am-gap]': 'gap()?.attr ?? null',
    '[style]': 'vars()',
    '[style.grid-template-columns]': 'rawTracks()',
  },
})
export class GridDirective {
  /** Empty for tiles; a preset or a raw track list for a split. */
  readonly amGrid = input<GridPreset | string>('');
  readonly amGridMin = input<Responsive<TileToken>>('md');
  readonly amGridGap = input<Responsive<SpaceOrNone> | ''>('');
  /** Splits only: `never` keeps a `config-preview` split side by side. */
  readonly amGridStack = input<'auto' | 'never'>('auto');

  /** `''` tiles, a preset name, or `custom` for a raw track list. */
  protected readonly mode = computed(() => {
    const v = this.amGrid().trim();
    return v === '' || PRESETS.has(v) ? v : 'custom';
  });

  protected readonly tile = computed(() =>
    atomValue('grid-min', this.amGridMin(), (v) => `var(--am-tile-${v})`),
  );
  protected readonly gap = computed(() => {
    const gap = this.amGridGap();
    if (gap !== '') return atomValue('gap', gap, spaceCss);
    return this.mode() === '' ? atomValue('gap', 'sm', spaceCss) : null;
  });
  protected readonly vars = computed(() =>
    mergeVars(this.mode() === '' ? this.tile().vars : null, this.gap()?.vars ?? null),
  );

  /** Raw track list (escape hatch): shrink-wrap bare fr units. */
  protected readonly rawTracks = computed(() =>
    this.mode() === 'custom'
      ? this.amGrid().replace(/(^|\s)(\d+(?:\.\d+)?fr)(?=\s|$)/g, '$1minmax(0, $2)')
      : null,
  );
}
