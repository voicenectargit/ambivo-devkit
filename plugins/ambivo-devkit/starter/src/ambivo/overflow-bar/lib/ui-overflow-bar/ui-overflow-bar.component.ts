// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  ElementRef,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonAppearance, MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatRippleModule } from '@angular/material/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  MenuAlignment,
  OverflowBarAppearance,
  OverflowItem,
} from '../types/overflow-item.interface';
import { OverflowItemDirective } from '../directives/overflow-item.directive';
import { MeasureWidthDirective } from '../directives/measure-width.directive';
import { computeHiddenIds, sortItems } from '../utils/overflow-utils';

@Component({
  selector: 'am-overflow-bar',
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatBadgeModule,
    MatRippleModule,
    MatTooltipModule,
    MeasureWidthDirective,
    RouterLinkActive,
  ],
  templateUrl: './ui-overflow-bar.component.html',
  styleUrls: ['./ui-overflow-bar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiOverflowBarComponent {
  // Public inputs
  items = model<OverflowItem[]>([]);
  appearance = input<OverflowBarAppearance>('buttons');
  buttonAppearance = input<MatButtonAppearance>('tonal');
  activeId = input<string | undefined>();
  activeTabIndex = model<number | undefined>();
  moreLabel = input('More');
  menuAlignment = input<MenuAlignment>('end');
  align = input<'left' | 'right'>('left');

  // Content children for template-defined items
  templateItems = contentChildren(OverflowItemDirective);

  // Element references
  container = viewChild<ElementRef<HTMLElement>>('container');

  // Output events
  itemClick = output<string>();
  activeChange = output<string>();

  // Measurement state
  private containerWidth = signal(0);
  private widths = signal(new Map<string, number>()); // id -> px

  // Hidden state
  hiddenItemIds = signal(new Set<string>());

  // Sorted items with index for stable sorting
  sortedItems = computed(() => {
    const baseItems = this.items().map((item, i) => ({
      ...item,
      __index__: i,
    }));
    return sortItems(baseItems);
  });

  // Computed active ID
  computedActiveId = computed(() => {
    const idx = this.activeTabIndex();
    const list = this.items();
    return idx != null && list[idx] ? list[idx].id : this.activeId();
  });

  // Derive visible/overflow from the hidden set
  visibleItems = computed(() =>
    this.sortedItems().filter((i) => !i.menuOnly && !this.hiddenItemIds().has(i.id)),
  );

  overflowItems = computed(() =>
    this.sortedItems().filter((i) => i.menuOnly || this.hiddenItemIds().has(i.id)),
  );

  hasOverflow = computed(() => this.overflowItems().length > 0);

  constructor() {
    // Populate items from template children if they exist
    effect(() => {
      const templates = this.templateItems();
      if (templates.length > 0) {
        this.items.set(templates.map((d) => d.toOverflowItem()));
      }
    });

    // Measure container width
    effect((onCleanup) => {
      const el = this.container()?.nativeElement;
      if (!el) return;

      const ro = new ResizeObserver(([e]) => this.containerWidth.set(e.contentRect.width));
      ro.observe(el);

      onCleanup(() => ro.disconnect());
    });

    // Recompute hidden when anything relevant changes
    effect(() => {
      const containerWidth = this.containerWidth();
      const itemWidths = this.widths();
      const items = this.sortedItems();
      const activeId = this.computedActiveId();

      // Get more button width from measurements, fallback to estimated size
      const moreButtonWidth = itemWidths.get('__more__') || 40; // Fallback for icon button

      // Only calculate if we have container width
      if (containerWidth === 0) return;

      const hidden = computeHiddenIds({
        containerWidth,
        moreButtonWidth,
        itemWidths,
        items,
        activeId,
      });
      this.hiddenItemIds.set(hidden);
    });
  }

  // Called by measure directive on each item
  onItemWidth({ id, width }: { id: string; width: number }) {
    const m = new Map(this.widths());
    if (m.get(id) !== width) {
      m.set(id, width);
      this.widths.set(m);
    }
  }

  // Track by function
  trackByItemId = (_: number, item: OverflowItem): string => item.id;

  // Get router link
  getItemLink = (item: OverflowItem): string | string[] => item.routerLink || '';

  // Handle item click
  onItemClick(item: OverflowItem, event?: MouseEvent): void {
    if (!item.routerLink && !item.disabled) {
      event?.preventDefault();

      if (this.appearance() === 'tabs') {
        const itemIndex = this.items().findIndex((i) => i.id === item.id);
        if (itemIndex !== -1) {
          this.activeTabIndex.set(itemIndex);
          this.activeChange.emit(item.id);
        }
      }

      if (item.action) item.action();
      this.itemClick.emit(item.id);
    }
  }
}
