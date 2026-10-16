// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { Directive } from '@angular/core';

/**
 * amStickyLeft — stays put when the scroller moves sideways, and is as wide as
 * the visible area rather than the content.
 *
 * For a page that scrolls both ways in ONE scroller (`amScroll="both"`): the
 * page's title, presets, tabs and empty state stay in view while a wide table
 * next to them scrolls sideways; vertically they scroll away with the page.
 *
 * ```html
 * <div amScroll="both">
 *   <header amStickyLeft amInsetInline="lg">…title…</header>
 *   <div amStickyLeft amStickyTop amCluster amInsetInline="lg">…filter bar…</div>
 *   <am-records-table />              <!-- unmarked: scrolls both ways -->
 * </div>
 * ```
 *
 * With `amStickyTop` on the same element it is a BAR: it also sticks at the
 * top, is one line of `--am-sticky-bar` (48px), sits above the table's sticky
 * cells, and everything after it sticks below it (`--am-sticky-offset`, and
 * `--sticky-header-offset` for records-table and records-kanban). CSS only.
 *
 * "Left" is the inline start (`inset-inline-start`), so it holds right to left.
 */
@Directive({
  selector: '[amStickyLeft]',
  standalone: true,
  host: { 'data-am-sticky-left': '' },
})
export class StickyLeftDirective {}
