// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive, computed, input } from '@angular/core';
import { atomValue, mergeVars, type Responsive } from '../types/responsive';
import { spaceCss, type SpaceOrNone } from '../types/space';

export type ClusterAlign = 'center' | 'start' | 'end' | 'baseline' | 'stretch';
export type ClusterJustify = 'start' | 'end' | 'between' | 'center';
export type ClusterCollapse = 'sm' | 'md';
export type ClusterWrap = 'wrap' | 'nowrap';

const ALIGN_CSS: Record<ClusterAlign, string> = {
  center: 'center',
  start: 'flex-start',
  end: 'flex-end',
  baseline: 'baseline',
  stretch: 'stretch',
};

const JUSTIFY_CSS: Record<ClusterJustify, string> = {
  start: 'flex-start',
  end: 'flex-end',
  between: 'space-between',
  center: 'center',
};

/**
 * amCluster — horizontal group that wraps.
 *
 * `amClusterAlign` defaults to CENTER: a UI row (label + control + button,
 * icon + text) wants vertical centring essentially always; defaults are the
 * real API.
 *
 * Every token input can follow the container width, mobile first:
 * `[amClusterGap]="{ xs: 2, md: 4 }"`. Breakpoints are library policy
 * (`CONTAINER_BREAKPOINTS`): `@container` cannot take var(), so per-call-site
 * pixel thresholds would be unlintable — hence keys only.
 *
 * `amClusterWrap="nowrap"` keeps a fixed-height bar on one line (an app
 * toolbar, a drawer header) — there the row must shrink its flexible child,
 * not grow a second line.
 *
 * `amClusterCollapse` (deprecated) switches the row to a column below a fixed
 * container width (sm = 360px, md = 600px).
 */
@Directive({
  selector: '[amCluster]',
  standalone: true,
  host: {
    'data-am-cluster': '',
    '[attr.data-am-gap]': 'gap().attr',
    '[attr.data-am-align]': 'align().attr',
    '[attr.data-am-justify]': 'justify().attr',
    '[attr.data-am-wrap]': "wrap().attr === 'wrap' ? null : wrap().attr",
    '[attr.data-am-collapse]': 'amClusterCollapse() || null',
    '[style]': 'vars()',
  },
})
export class ClusterDirective {
  readonly amClusterGap = input<Responsive<SpaceOrNone>>('sm');
  readonly amClusterAlign = input<Responsive<ClusterAlign>>('center');
  readonly amClusterJustify = input<Responsive<ClusterJustify>>('start');
  readonly amClusterWrap = input<Responsive<ClusterWrap>>('wrap');
  /**
   * @deprecated A fixed row→column switch: `sm` stacks under 360px of the
   * container, `md` under 600px. Prefer `amStack` and `amCluster` with
   * `amShowFrom` / `amHideFrom`, or responsive values.
   */
  readonly amClusterCollapse = input<ClusterCollapse | ''>('');

  protected readonly gap = computed(() => atomValue('gap', this.amClusterGap(), spaceCss));
  protected readonly align = computed(() =>
    atomValue('align', this.amClusterAlign(), (v) => ALIGN_CSS[v]),
  );
  protected readonly justify = computed(() =>
    atomValue('justify', this.amClusterJustify(), (v) => JUSTIFY_CSS[v]),
  );
  protected readonly wrap = computed(() => atomValue('wrap', this.amClusterWrap(), (v) => v));
  protected readonly vars = computed(() =>
    mergeVars(this.gap().vars, this.align().vars, this.justify().vars, this.wrap().vars),
  );
}
