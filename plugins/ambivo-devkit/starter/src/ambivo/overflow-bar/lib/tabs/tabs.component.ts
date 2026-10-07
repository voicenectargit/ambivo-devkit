// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, computed, contentChildren, effect, input, model, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatRippleModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NgTemplateOutlet } from '@angular/common';
import { OverflowBarBaseComponent } from '../base/overflow-bar-base.component';
import { TabComponent, TabItem } from './tab.component';
import { MeasureWidthDirective } from '../directives/measure-width.directive';

/**
 * Tabs component with overflow handling
 * Usage with input:
 * <am-tabs [items]="myTabs" [active]="currentTab" density="normal" />
 *
 * Usage with activeIndex (two-way binding):
 * <am-tabs [nodes]="myTabs" [(activeIndex)]="currentTabIndex" density="normal" />
 *
 * Usage with content projection:
 * <am-tabs [active]="currentTab" density="normal">
 *   <am-tab id="home" label="Home" icon="home" routerLink="/home" />
 *   <am-tab id="settings" label="Settings" icon="settings" [closable]="true" (closed)="onClose()" />
 * </am-tabs>
 */
@Component({
  selector: 'am-tabs',
  imports: [
    MatIconButton,
    MatIconModule,
    MatMenuModule,
    MatRippleModule,
    MatTooltipModule,
    MeasureWidthDirective,
    NgTemplateOutlet,
  ],
  templateUrl: './tabs.component.html',
  styleUrls: ['./tabs.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsComponent extends OverflowBarBaseComponent<TabItem, TabComponent> {
  // Tab-specific inputs
  active = input<string>();
  activeIndex = model<number>(0);
  showIndicator = input<boolean>(true);

  // Tab-specific outputs
  activeChange = output<string>();

  // Content children for template-defined tabs
  protected templateItems = contentChildren(TabComponent);

  // Active tab's content template
  activeTabContent = computed(() => {
    const tabs = this.templateItems();
    const index = this.activeIndex();
    return tabs[index]?.contentTemplate() ?? null;
  });

  // Computed active ID based on activeIndex
  private activeId = computed(() => {
    const index = this.activeIndex();
    const allItems = this.items();
    return allItems[index]?.id;
  });

  constructor() {
    super();

    // Sync activeIndex when active ID changes
    effect(() => {
      const activeIdValue = this.active();
      if (activeIdValue !== undefined) {
        const allItems = this.items();
        const index = allItems.findIndex(item => item.id === activeIdValue);
        if (index !== -1 && index !== this.activeIndex()) {
          this.activeIndex.set(index);
        }
      }
    });

    // Sync active ID when activeIndex changes
    effect(() => {
      const computedId = this.activeId();
      const currentActive = this.active();
      if (computedId && computedId !== currentActive) {
        this.activeChange.emit(computedId);
      }
    });
  }

  // Override to provide active ID for overflow calculation
  protected override getActiveId(): string | undefined {
    return this.active() ?? this.activeId();
  }

  // Check if a tab is active
  isActive(itemId: string): boolean {
    const activeValue = this.active();
    if (activeValue !== undefined) {
      return activeValue === itemId;
    }
    return this.activeId() === itemId;
  }

  // Handle tab activation
  override onItemClick(item: TabItem, event?: MouseEvent): void {
    if (!item.disabled) {
      if (!item.routerLink) {
        event?.preventDefault();
      }

      // Find and update activeIndex
      const allItems = this.items();
      const index = allItems.findIndex(i => i.id === item.id);
      if (index !== -1) {
        this.activeIndex.set(index);
      }

      // Emit active change for tabs
      this.activeChange.emit(item.id);

      // Call action if provided
      if (item.action) {
        item.action();
      }

      // Emit general activated event
      this.itemActivated.emit(item.id);
    }
  }

  // Handle close button click
  onCloseClick(item: TabItem, event: MouseEvent): void {
    event.stopPropagation(); // Prevent tab activation
    if (item.closeAction) {
      item.closeAction();
    }
  }

  // Check if any overflow tab has error
  hasOverflowError = computed(() => this.overflowItems().some(item => item.error));
}
