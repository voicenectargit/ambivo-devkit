// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  Directive,
  effect,
  ElementRef,
  inject,
  input,
  output,
  Signal,
  signal,
  viewChild,
} from '@angular/core';
import { computeHiddenIds, sortItems } from '../utils/overflow-utils';
import { MatMenu } from '@angular/material/menu';
import { Router } from '@angular/router';

export type ButtonAppearance = 'text' | 'filled' | 'elevated' | 'outlined' | 'tonal';

export interface OverflowBarItem {
  id: string;
  label: string;
  icon?: string;
  badge?: number | 'dot';
  disabled?: boolean;
  pinned?: boolean;
  priority?: number;
  menuOnly?: boolean;
  permanent?: boolean;
  truncate?: boolean;
  routerLink?: string | string[];
  menu?: MatMenu;
  disabledTooltip?: string;
  template?: unknown;
  action?: () => void;
}

export type Density = 'compact' | 'normal' | 'comfortable';
export type Alignment = 'left' | 'right';

/**
 * Base directive for item definitions (tabs, buttons, etc.)
 * Child classes should extend this with their specific inputs
 */
@Directive()
export abstract class OverflowBarItemBase<T extends OverflowBarItem = OverflowBarItem> {
  abstract item: Signal<T>;
}

/**
 * Base component providing core overflow functionality
 * Extended by specific implementations like tabs and button-group
 * @template T - The item type, must extend OverflowBarItem
 * @template D - The directive type for content children
 */
@Component({
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export abstract class OverflowBarBaseComponent<
  T extends OverflowBarItem = OverflowBarItem,
  D extends OverflowBarItemBase<T> = OverflowBarItemBase<T>,
> {
  private router = inject(Router);

  // Public inputs
  density = input<Density>('normal');
  align = input<Alignment>('left');

  /** Gap between items for overflow calculation - 0 for tabs, 8 for buttons */
  protected itemGap = 0;

  // Items input - for programmatic usage
  nodes = input<T[]>([]);

  // Content children for template-defined items (child class provides the directive type)
  protected abstract templateItems: ReturnType<typeof contentChildren<D>>;

  // Element references
  container = viewChild<ElementRef<HTMLElement>>('container');

  // Output events
  itemActivated = output<string>();

  // Measurement state
  protected containerWidth = signal(0);
  protected widths = signal(new Map<string, number>()); // id -> px

  // Hidden state
  hiddenItemIds = signal(new Set<string>());

  // Computed items - derived from either input or template children
  items = computed<T[]>(() => {
    const templates = this.templateItems();
    if (templates.length > 0) {
      return templates.map((d) => d.item());
    }
    return this.nodes();
  });

  // Sorted items with stable index
  sortedItems = computed(() => {
    const baseItems = this.items().map((item, i) => ({
      ...item,
      __index__: i,
    }));
    return sortItems(baseItems);
  });

  // Derive visible/overflow from the hidden set
  visibleItems = computed(() =>
    this.sortedItems().filter((i) => !i.menuOnly && !this.hiddenItemIds().has(i.id)),
  );

  overflowItems = computed(() =>
    this.sortedItems().filter((i) => i.menuOnly || this.hiddenItemIds().has(i.id)),
  );

  hasOverflow = computed(() => this.overflowItems().length > 0);

  // Total width of all items if they were all shown
  totalWidth = computed(() => {
    const itemWidths = this.widths();
    const items = this.sortedItems();
    return items.reduce((sum, item) => {
      const width = itemWidths.get(item.id) || 0;
      return sum + width;
    }, 0);
  });

  constructor() {
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
      const activeId = this.getActiveId?.() || undefined;

      // Get more button width from measurements, fallback to estimated size
      const moreButtonWidth = itemWidths.get('__more__') || 40;

      // Only calculate if we have container width
      if (containerWidth === 0) return;

      const hidden = computeHiddenIds({
        containerWidth,
        moreButtonWidth,
        itemWidths,
        items,
        activeId,
        itemGap: this.itemGap,
      });
      this.hiddenItemIds.set(hidden);
    });
  }

  // Optional method that child classes can override to provide active ID
  protected getActiveId?(): string | undefined;

  // Called by measure directive on each item
  onItemWidth({ id, width }: { id: string; width: number }) {
    const m = new Map(this.widths());
    if (m.get(id) !== width) {
      m.set(id, width);
      this.widths.set(m);
    }
  }

  // Track by function
  trackByItemId = (_: number, item: OverflowBarItem): string => item.id;

  // Get router link
  getItemLink = (item: OverflowBarItem): string | string[] => item.routerLink || '';

  // Handle item click
  onItemClick(item: OverflowBarItem, event?: MouseEvent): void {
    if (!item.disabled) {
      event?.preventDefault();
      if (item.action) item.action();
      if (item.routerLink) this.router.navigate(item.routerLink as any);
      this.itemActivated.emit(item.id);
    }
  }
}
