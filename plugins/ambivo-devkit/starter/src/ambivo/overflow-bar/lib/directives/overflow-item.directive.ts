// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Directive, input, output } from '@angular/core';
import { MatMenu } from '@angular/material/menu';
import { OverflowItem } from '../types/overflow-item.interface';

let idCounter = 0;

@Directive({
  selector: 'ng-template[amOverflowItem]',
})
export class OverflowItemDirective {
  id = input<string>(`overflow-item-${++idCounter}`);
  label = input<string>('');
  icon = input<string>();
  badge = input<number | 'dot'>();
  disabled = input<boolean>();
  disabledMessage = input<string>();
  pinned = input<boolean>();
  priority = input<number>();
  menuOnly = input<boolean>();
  truncate = input<boolean>();
  highlight = input<boolean>();
  routerLink = input<string | string[]>();
  action = input<() => void>();
  menu = input<MatMenu>();
  activated = output<void>();

  // Convert directive inputs to OverflowItem
  toOverflowItem(): OverflowItem {
    return {
      id: this.id(),
      label: this.label(),
      icon: this.icon(),
      badge: this.badge(),
      disabled: this.disabled(),
      pinned: this.pinned(),
      priority: this.priority(),
      menuOnly: this.menuOnly(),
      truncate: this.truncate(),
      highlight: this.highlight(),
      routerLink: this.routerLink(),
      disabledTooltip: this.disabledMessage(),
      menu: this.menu(),
      action: () => this.activated.emit(),
    };
  }
}
