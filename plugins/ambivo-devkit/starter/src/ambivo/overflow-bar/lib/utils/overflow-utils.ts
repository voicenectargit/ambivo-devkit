// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
// Buffer to account for gaps, padding, and prevent partial visibility
const LAYOUT_BUFFER = 10;

export interface BaseOverflowItem {
  id: string;
  pinned?: boolean;
  priority?: number;
  menuOnly?: boolean;
  permanent?: boolean;
}

export interface ComputeHiddenInput<T extends BaseOverflowItem = BaseOverflowItem> {
  containerWidth: number;
  moreButtonWidth: number;
  itemWidths: Map<string, number>; // id -> px
  items: T[]; // already sorted
  activeId?: string;
  /** Gap between items - 0 for tabs, 8 for buttons */
  itemGap?: number;
}

export function sortItems<T extends BaseOverflowItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aPinned = a.pinned ? 1 : 0;
    const bPinned = b.pinned ? 1 : 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    const aPr = a.priority ?? 0;
    const bPr = b.priority ?? 0;
    if (aPr !== bPr) return bPr - aPr;

    // keep stable by original index if provided
    const aIdx = (a as unknown as { __index__?: number }).__index__ ?? 0;
    const bIdx = (b as unknown as { __index__?: number }).__index__ ?? 0;
    return aIdx - bIdx;
  });
}

/** Returns a Set of hidden item ids. No DOM, no timing. */
export function computeHiddenIds(input: ComputeHiddenInput): Set<string> {
  const { containerWidth, moreButtonWidth, itemWidths, items, activeId, itemGap = 0 } = input;

  // Pre-hide menuOnly
  const hidden = new Set(items.filter((i) => i.menuOnly).map((i) => i.id));

  const visibleCandidates = items.filter((i) => !i.menuOnly);
  const widthOf = (id: string) => itemWidths.get(id) ?? 0;

  // First pass: do they all fit without "More"?
  let used = 0;
  for (const it of visibleCandidates) {
    used += widthOf(it.id) + itemGap;
  }
  if (used + LAYOUT_BUFFER <= containerWidth) {
    return hidden; // everything fits
  }

  // Second pass: assume "More" must be present
  const availableWidth = containerWidth - moreButtonWidth - LAYOUT_BUFFER;
  used = 0;

  // Always reserve space for permanent items first
  for (const it of visibleCandidates) {
    if (it.permanent) {
      used += widthOf(it.id) + itemGap;
    }
  }

  // Always try to keep active item visible
  if (activeId) {
    const activeItem = visibleCandidates.find((i) => i.id === activeId);
    if (activeItem && !activeItem.permanent) {
      const activeWidth = widthOf(activeId) + itemGap;
      if (used + activeWidth <= availableWidth) {
        used += activeWidth;
      }
    }
  }

  // Add other items in priority order
  for (const it of visibleCandidates) {
    if (it.permanent || it.id === activeId) continue;
    const w = widthOf(it.id) + itemGap;
    if (used + w <= availableWidth) {
      used += w;
    } else {
      hidden.add(it.id);
    }
  }

  // Ensure permanent and active items aren't hidden
  for (const it of visibleCandidates) {
    if (it.permanent) hidden.delete(it.id);
  }
  if (activeId) hidden.delete(activeId);

  return hidden;
}
