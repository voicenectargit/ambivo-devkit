// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { OverflowBarItem } from './overflow-bar-base.component';
import { MatMenu } from '@angular/material/menu';

/**
 * Base component for overflow bar items.
 * Child components extend this to inherit all common inputs.
 * The component itself doesn't render anything - parent handles rendering.
 */
@Component({
  selector: 'am-overflow-bar-item',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OverflowBarItemComponent {
  // Core properties
  id = input<string>();
  label = input<string>('');
  icon = input<string>();
  badge = input<number | 'dot'>();
  disabled = input<boolean | undefined>(false);
  menu = input<MatMenu>();

  // Layout properties
  pinned = input<boolean>(false);
  priority = input<number>(0);
  truncate = input<boolean>(true);

  // Router properties
  routerLink = input<string | string[]>();

  // Tooltip
  disabledTooltip = input<string>();

  // Events
  activated = output<void>();

  /**
   * Computed ID - uses explicit id if defined, otherwise returns undefined
   * for child classes to handle auto-generation
   */
  itemId = computed(() => {
    const explicitId = this.id();
    if (explicitId !== undefined) return explicitId;
    return this.label().toLowerCase().replace(/\s+/g, '-');
  });

  /**
   * Base item properties computed from inputs.
   * Child components can use this in their own item computed.
   */
  protected baseItem = computed<OverflowBarItem>(() => ({
    id: this.itemId() ?? '',
    label: this.label(),
    icon: this.icon(),
    badge: this.badge(),
    disabled: this.disabled(),
    pinned: this.pinned(),
    priority: this.priority(),
    menu: this.menu(),
    truncate: this.truncate(),
    routerLink: this.routerLink(),
    disabledTooltip: this.disabledTooltip(),
    action: () => this.activated.emit(),
  }));

  /**
   * Computed OverflowBarItem from component inputs
   */
  item = computed<OverflowBarItem>(() => this.baseItem());
}
