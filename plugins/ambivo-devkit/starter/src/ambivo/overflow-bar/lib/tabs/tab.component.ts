// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  viewChild,
  TemplateRef,
} from '@angular/core';
import { OverflowBarItem } from '../base/overflow-bar-base.component';
import { OverflowBarItemComponent } from '../base/overflow-bar-item.component';

/**
 * Tab-specific item interface
 */
export interface TabItem extends OverflowBarItem {
  closable?: boolean;
  closeAction?: () => void;
  color?: string;
  error?: boolean;
}

/**
 * Tab component for use within am-tabs
 * Usage (nav-style):
 * <am-tabs [active]="currentTab">
 *   <am-tab id="home" label="Home" icon="home" />
 *   <am-tab id="settings" label="Settings" icon="settings" [closable]="true" (closed)="onClose()" />
 * </am-tabs>
 *
 * Usage (with content):
 * <am-tabs [(activeIndex)]="activeTabIndex">
 *   <am-tab label="Comments" icon="message">
 *     <am-comments [record]="record()" />
 *   </am-tab>
 *   <am-tab label="Overview" icon="info">
 *     <am-overview [record]="record()" />
 *   </am-tab>
 * </am-tabs>
 */
@Component({
  selector: 'am-tab',
  template: '<ng-template #content><ng-content /></ng-template>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabComponent extends OverflowBarItemComponent {
  // Tab-specific inputs
  closable = input<boolean>(false);
  color = input<string>();
  error = input<boolean>(false);

  // Tab-specific outputs
  closed = output<void>();

  // Content template captured from ng-content
  contentTemplate = viewChild<TemplateRef<unknown>>('content');

  /**
   * Computed TabItem including tab-specific properties
   */
  override item = computed<TabItem>(() => ({
    ...this.baseItem(),
    closable: this.closable(),
    closeAction: () => this.closed.emit(),
    color: this.color(),
    error: this.error(),
  }));
}
