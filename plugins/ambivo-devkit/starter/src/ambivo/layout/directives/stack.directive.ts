// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive, computed, input } from '@angular/core';
import { atomValue, mergeVars, type Responsive } from '../types/responsive';
import { spaceCss, type SpaceOrNone } from '../types/space';

export type StackAlign = 'stretch' | 'start' | 'center' | 'end';

const ALIGN_CSS: Record<StackAlign, string> = {
  stretch: 'stretch',
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
};

/**
 * amStack — vertical flow with one gap. One of exactly two flow utilities
 * (with amCluster); the set does not grow toward a utility framework.
 *
 * The gap is a multiple of the 4px unit (`amStackGap="3"`) and can follow the
 * container, mobile first: `[amStackGap]="{ xs: 2, md: 4 }"`.
 *
 * `amStackGap="none"` is for a column whose children carry their own edges (a
 * drawer: header rule + scroller). `amStackAlign` defaults to STRETCH — a
 * column of blocks wants full width; `center` is for a rail of icon buttons.
 */
@Directive({
  selector: '[amStack]',
  standalone: true,
  host: {
    'data-am-stack': '',
    '[attr.data-am-gap]': 'gap().attr',
    '[attr.data-am-align]': 'align().attr',
    '[style]': 'vars()',
  },
})
export class StackDirective {
  readonly amStackGap = input<Responsive<SpaceOrNone>>('md');
  readonly amStackAlign = input<Responsive<StackAlign>>('stretch');

  protected readonly gap = computed(() => atomValue('gap', this.amStackGap(), spaceCss));
  // 'stretch' is the CSS default: no attribute unless it is set otherwise.
  protected readonly align = computed(() => {
    const value = atomValue('align', this.amStackAlign(), (v) => ALIGN_CSS[v]);
    return value.attr === 'stretch' ? { attr: null, vars: null } : value;
  });
  protected readonly vars = computed(() => mergeVars(this.gap().vars, this.align().vars));
}
