// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Directive, input } from '@angular/core';
import type { SpaceToken } from './inset.directive';

export type ClusterAlign = 'center' | 'start' | 'end' | 'baseline' | 'stretch';
export type ClusterJustify = 'start' | 'end' | 'between' | 'center';
export type ClusterCollapse = 'sm' | 'md';

/**
 * amCluster — horizontal group that wraps.
 *
 * `amClusterAlign` defaults to CENTER: a UI row (label + control + button,
 * icon + text) wants vertical centring essentially always; defaults are the
 * real API.
 *
 * `amClusterCollapse` opts into a clean row→column switch below a
 * library-defined container width (sm = 360px, md = 560px of the nearest
 * container) for cases where uneven wrapping looks ragged — paired form
 * fields, label-left layouts. The caller chooses WHETHER; the threshold is
 * library policy (`@container` cannot take var(), so per-call-site pixel
 * thresholds are unlintable — hence tokens only).
 */
@Directive({
  selector: '[amCluster]',
  standalone: true,
  host: {
    'data-am-cluster': '',
    '[attr.data-am-gap]': 'amClusterGap()',
    '[attr.data-am-align]': 'amClusterAlign()',
    '[attr.data-am-justify]': 'amClusterJustify()',
    '[attr.data-am-collapse]': 'amClusterCollapse() || null',
  },
})
export class ClusterDirective {
  readonly amClusterGap = input<SpaceToken>('sm');
  readonly amClusterAlign = input<ClusterAlign>('center');
  readonly amClusterJustify = input<ClusterJustify>('start');
  readonly amClusterCollapse = input<ClusterCollapse | ''>('');
}
