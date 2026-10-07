// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

export type BlockStatusIntent = 'empty' | 'error' | 'no-access';
export type BlockStatusSize = 'l' | 'm';

/**
 * am-block-status — contentless states (empty / error / no-access) in one
 * component instead of three near-identical ones.
 *
 * Sizing follows the Taiga model, not a container query: the right variant
 * tracks the IMPORTANCE of the region (page body vs. widget tile), which
 * correlates with width but is not identical to it — a wide, short inline
 * slot still wants the small variant. So `size` is a caller decision.
 *
 * Text is projected (i18n-clean by construction). The block sizes to its
 * content — it is a message, not a region, and never stretches to fill the
 * body (an oversized empty state advertises emptiness).
 *
 * ```html
 * <am-block-status icon="qr_code_scanner" intent="empty">
 *   <span am-status-title i18n>No scans yet</span>
 *   <span am-status-hint i18n>Scanned tags will appear here, most recent first.</span>
 * </am-block-status>
 * ```
 */
@Component({
  selector: 'am-block-status',
  standalone: true,
  imports: [MatIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-size]': 'size()',
    '[attr.data-intent]': 'intent()',
  },
  template: `
    @if (icon()) {
      <mat-icon class="icon" aria-hidden="true">{{ icon() }}</mat-icon>
    }
    <div class="title title-large"><ng-content select="[am-status-title]" /></div>
    <div class="hint body-medium"><ng-content select="[am-status-hint]" /></div>
    <div class="actions"><ng-content select="[am-status-action]" /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--am-space-2xs);
      padding: var(--am-space-xl);
      box-sizing: border-box;
      border: 1px dashed var(--mat-sys-outline-variant);
      border-radius: var(--am-radius-md);
    }
    .icon {
      font-size: 48px;
      inline-size: 48px;
      block-size: 48px;
      color: var(--mat-sys-on-surface-variant);
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
    }
    .hint:empty,
    .actions:empty {
      display: none;
    }
    .actions {
      margin-block-start: var(--am-space-sm);
    }
    :host([data-intent='error']) .icon {
      color: var(--mat-sys-error);
    }
    :host([data-size='m']) {
      padding: var(--am-space-md);
    }
    :host([data-size='m']) .icon {
      font-size: 32px;
      inline-size: 32px;
      block-size: 32px;
    }
    :host([data-size='m']) .title {
      font: inherit;
      font-weight: 500;
    }
  `,
})
export class BlockStatusComponent {
  readonly icon = input<string>('');
  readonly intent = input<BlockStatusIntent>('empty');
  /** Caller-decided (Taiga model): 'l' for page bodies, 'm' for tiles/panes. */
  readonly size = input<BlockStatusSize>('l');
}
