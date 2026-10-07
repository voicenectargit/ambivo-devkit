// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * am-selection-bar — bulk-selection row. A SIBLING of am-toolbar, not a
 * variant: same scaffold slot and height, but different tone, lifecycle
 * (appears with selection state, replaces the filter row) and content model.
 *
 * The count is PROJECTED, never a string input — "N selected" is an ICU
 * plural and must live in the feature template:
 *
 * ```html
 * @if (selection.count() > 0) {
 *   <am-selection-bar>
 *     <span am-selection-count i18n>
 *       {selection.count(), plural, one {1 selected} other {{{selection.count()}} selected}}
 *     </span>
 *     <am-button-group actions> …bulk actions… </am-button-group>
 *   </am-selection-bar>
 * } @else {
 *   <am-toolbar> … </am-toolbar>
 * }
 * ```
 */
@Component({
  selector: 'am-selection-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="count" aria-live="polite">
      <ng-content select="[am-selection-count]" />
    </div>
    <div class="actions"><ng-content select="[actions]" /></div>
    <ng-content />
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
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
      border-radius: var(--am-radius-sm);
    }
    .count {
      font-variant-numeric: tabular-nums;
    }
    /* Flexible block (not a flex-end container) so a projected button-group /
       overflow-bar fills it and self-aligns without collapsing. */
    .actions {
      flex: 1 1 auto;
      min-inline-size: 0;
    }
  `,
})
export class SelectionBarComponent {}
