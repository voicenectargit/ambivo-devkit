// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * am-toolbar — the filter/search row above list bodies. Slots into the
 * scaffold's toolbar row.
 *
 * NOT sticky and NOT measured: it is a static grid row, so variable height,
 * conditional rendering and the focus swap below are just reflow. (This row
 * is the reason the sticky-stack coordinator was cut.)
 *
 * Focus behavior: when the search region has focus, the row background
 * swaps and non-search siblings collapse, giving the query full width.
 * Mark the search wrapper with `[am-toolbar-search]`; everything else is
 * default-slotted.
 */
@Component({
  selector: 'am-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="search" am-toolbar-search-slot>
      <ng-content select="[am-toolbar-search]" />
    </div>
    <div class="rest"><ng-content /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--am-space-2xs);
      min-block-size: 48px;
      padding-inline: var(--am-space-lg);
      box-sizing: border-box;
      container-type: inline-size;
      background: var(--am-surface-bg, var(--mat-sys-surface));
      transition: background-color 120ms linear;
    }
    .search {
      display: flex;
      flex: 0 1 auto;
      min-inline-size: 0;
    }
    .search:empty {
      display: none;
    }
    /*
     * A flexible block, NOT a flex container: a projected am-button-group fills
     * it and right-aligns itself; a flex-end context would shrink the group and
     * collapse its overflow bar.
     */
    .rest {
      flex: 1 1 auto;
      min-inline-size: 0;
      transition: opacity 120ms linear;
    }
    /* Focus swap: search takes the row; siblings collapse. nowrap while
     * focused: the collapsed .rest is zero-basis but wrappable, and once it
     * wraps it keeps its content height (opacity hides, it does not unlayout) —
     * the row silently grows by an invisible line of buttons. */
    :host(:has(.search :focus-within)) {
      background: var(--mat-sys-surface-container-high);
      flex-wrap: nowrap;
    }
    :host(:has(.search :focus-within)) .search {
      flex: 1 1 100%;
    }
    :host(:has(.search :focus-within)) .rest {
      opacity: 0;
      flex-basis: 0;
      overflow: clip;
      pointer-events: none;
    }
    /* Library threshold: in narrow regions the search spans the full row. */
    @container (max-width: 480px) {
      .search {
        flex: 1 1 100%;
      }
    }
  `,
})
export class ToolbarComponent {}
