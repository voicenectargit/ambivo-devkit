// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { computed, Directive, input } from '@angular/core';
import {
  CONTAINER_BPS,
  isResponsiveMap,
  keysSet,
  valueAt,
  type AtomVars,
  type ContainerBp,
  type Responsive,
} from '../types/responsive';
import { spaceCss, type SpaceOrNone } from '../types/space';

export type { SpaceToken } from '../types/space';

/** One side of an axis: a spacing value, or `none` for zero. */
export type InsetSide = SpaceOrNone;

/**
 * An axis inset: one value for both sides, or `"<start> <end>"` — the same
 * order as the CSS `padding-block` / `padding-inline` shorthands.
 */
export type AxisInset = InsetSide | `${Exclude<InsetSide, number>} ${Exclude<InsetSide, number>}`;

type Sides = Record<'bs' | 'be' | 'is' | 'ie', InsetSide | null>;
const SIDES = ['bs', 'be', 'is', 'ie'] as const;

/**
 * amInset — padding as a first-class atom (token-sized, logical properties).
 *
 * Padding lives here, never on `amSurface`: a padded surface with a scroller
 * inside insets the scrollbar away from the rounded edge. Compose:
 * - simple cards:   `<div amSurface amInset="6">`
 * - scroll regions: inset goes INSIDE the scroller (the scaffold does this)
 * - wide-table scrollers take NO inline inset — the table reaches the surface
 *   edge and carries its gutter in first/last cell padding.
 *
 * An axis takes two values when its sides differ — `amInsetInline="5 1"`
 * (a search pill: room for the text, tight around the trailing button). That
 * keeps asymmetric padding on the atom instead of in a stylesheet.
 *
 * Each input can follow the container, mobile first:
 * `[amInset]="{ xs: 4, md: 6 }"`. An axis input wins over `amInset` at every
 * width.
 */
@Directive({
  selector: '[amInset], [amInsetBlock], [amInsetInline]',
  standalone: true,
  host: {
    '[attr.data-am-pad]': 'pad()',
    '[attr.data-am-inset]': 'plain() ? (amInset() || null) : null',
    '[attr.data-am-inset-block]': 'plain() ? block().both : null',
    '[attr.data-am-inset-block-start]': 'plain() ? block().start : null',
    '[attr.data-am-inset-block-end]': 'plain() ? block().end : null',
    '[attr.data-am-inset-inline]': 'plain() ? inline().both : null',
    '[attr.data-am-inset-inline-start]': 'plain() ? inline().start : null',
    '[attr.data-am-inset-inline-end]': 'plain() ? inline().end : null',
    '[style]': 'vars()',
  },
})
export class InsetDirective {
  /** Uniform padding. Bare attribute (`<div amInset>`) yields 'lg'. */
  readonly amInset = input<Responsive<SpaceOrNone> | '', Responsive<SpaceOrNone> | ''>('', {
    transform: (v) => (v === '' ? 'lg' : v),
  });
  readonly amInsetBlock = input<Responsive<AxisInset> | ''>('');
  readonly amInsetInline = input<Responsive<AxisInset> | ''>('');

  /** Every input plain (or unset): attributes only, no inline style. */
  protected readonly plain = computed(
    () =>
      !isResponsiveMap(this.amInset()) &&
      !isResponsiveMap(this.amInsetBlock()) &&
      !isResponsiveMap(this.amInsetInline()),
  );

  /** Which axes get padding at all; an unset axis leaves the element's own. */
  protected readonly pad = computed(() => {
    const all = this.amInset() !== '';
    const block = all || this.amInsetBlock() !== '';
    const inline = all || this.amInsetInline() !== '';
    return block && inline ? 'both' : block ? 'block' : inline ? 'inline' : null;
  });

  protected readonly block = computed(() => plainSides(this.amInsetBlock()));
  protected readonly inline = computed(() => plainSides(this.amInsetInline()));

  /** Responsive: each side resolved per key, an axis over `amInset`. */
  protected readonly vars = computed((): AtomVars | null => {
    if (this.plain()) return null;
    const all = this.amInset();
    const block = this.amInsetBlock();
    const inline = this.amInsetInline();
    const keys = new Set<ContainerBp>();
    for (const v of [all, block, inline]) if (v !== '') keysSet(v).forEach((k) => keys.add(k));

    const vars: AtomVars = {};
    for (const bp of CONTAINER_BPS.filter((k) => keys.has(k))) {
      const a = all === '' ? null : valueAt(all, bp);
      const [bs, be] = axisAt(block, bp, a);
      const [is, ie] = axisAt(inline, bp, a);
      const sides: Sides = { bs, be, is, ie };
      for (const side of SIDES) {
        const v = sides[side];
        if (v != null) vars[bp === 'xs' ? `--am-pad-${side}` : `--am-pad-${side}-${bp}`] = spaceCss(v);
      }
    }
    return vars;
  });
}

/** An axis's two sides at a key, or `amInset`'s value for both. */
function axisAt(
  axis: Responsive<AxisInset> | '',
  bp: ContainerBp,
  all: SpaceOrNone | null,
): [InsetSide | null, InsetSide | null] {
  if (axis === '') return [all, all];
  const [start, end] = split(valueAt(axis, bp));
  return [start, end ?? start];
}

function split(value: AxisInset): [InsetSide, InsetSide | undefined] {
  if (typeof value === 'number') return [value, undefined];
  const [start, end] = value.split(' ') as InsetSide[];
  return [start, end];
}

function plainSides(value: Responsive<AxisInset> | ''): {
  both: string | null;
  start: string | null;
  end: string | null;
} {
  if (value === '' || isResponsiveMap(value)) return { both: null, start: null, end: null };
  const [start, end] = split(value);
  if (end === undefined || end === start) return { both: String(start), start: null, end: null };
  return { both: null, start: String(start), end: String(end) };
}
