// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
/** One entry of the left menu. `exact`: active only on this path, not on the paths under it. */
export interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
}

/**
 * The left menu of a multi-screen app (AppShellComponent). One entry per top-level screen, in the
 * order people use them. Labels are $localize-tagged; icons are Material Symbols names.
 */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: $localize`Home`, icon: 'home', exact: true },
];
