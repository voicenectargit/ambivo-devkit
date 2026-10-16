// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import { booleanAttribute, ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MeasureDirective } from '../directives/measure.directive';

/**
 * am-header — page/section header: heading + optional hint + trailing
 * actions cluster.
 *
 * - `heading`, not `title`: `title` is a global HTML attribute — a static
 *   value lands in the DOM and renders a native tooltip over the header.
 * - Always an `<h1>`: am-header is the top of whatever it heads (page,
 *   drawer, dialog). `level` sets only how big it looks.
 * - The hint gets a reading measure automatically (amMeasure).
 * - Actions wrap below the heading when the header's own container is
 *   narrow (library threshold, compiled here — no input); `compact` forces
 *   the wrapped arrangement regardless of width (dense dashboards).
 * - NO outer padding (like every molecule that isn't a pinned bar): spacing
 *   is composed, so it is visible in the template. Simple pages put ONE
 *   `amInset` on the content wrapper and the header needs nothing; full-bleed
 *   pages (sticky rows) pad the header row itself:
 *   `<am-header amInsetBlock="md" amInsetInline="lg" …>`.
 *
 * i18n: mark `i18n-heading` and `i18n-hint` at every call site.
 */
@Component({
  selector: 'am-header',
  standalone: true,
  imports: [MeasureDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-compact]': 'compact() || null' },
  template: `
    <div class="bar">
      <h1 [class]="level()">{{ heading() }}</h1>
      <div class="actions"><ng-content select="[actions]" /></div>
    </div>
    @if (hint()) {
      <!-- Default measure (65ch): narrow reads cramped under a display-size
           heading, full width is unreadable — this is the classic middle. -->
      <p class="hint body-medium" amMeasure>{{ hint() }}</p>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .bar {
      display: flex;
      flex-wrap: wrap; /* narrow: actions drop to their own line below the heading */
      align-items: center;
      gap: var(--am-space-sm);
    }
    h1 {
      flex: 1 1 auto;
      min-inline-size: 0;
      margin: 0;
    }
    /*
     * A flexible block, NOT a flex/justify container: a projected am-button-group
     * fills it and right-aligns via align="right", and its overflow bar measures
     * the real width. Wrapping it in a flex-end context shrinks the group to
     * content width and collapses the overflow bar.
     */
    .actions {
      flex: 1 1 auto;
      min-inline-size: 0;
    }
    :host([data-compact]) .actions {
      flex-basis: 100%;
    }
    .hint {
      margin: var(--am-space-2xs) 0 0;
      color: var(--mat-sys-on-surface-variant);
    }
  `,
})
export class HeaderComponent {
  readonly heading = input.required<string>();
  /** Typography-hierarchy class (visual scale only). */
  readonly level = input<string>('display-medium');
  readonly hint = input<string>('');
  /** Manual override: always use the wrapped (narrow) arrangement. */
  readonly compact = input(false, { transform: booleanAttribute });
}
