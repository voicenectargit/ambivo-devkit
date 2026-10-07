// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { MatMenu } from '@angular/material/menu';

export interface OverflowItem {
  id: string;
  label: string;
  icon?: string;
  badge?: number | 'dot';
  disabled?: boolean;
  pinned?: boolean;
  priority?: number;
  menuOnly?: boolean;
  truncate?: boolean;
  highlight?: boolean;
  disabledTooltip?: string;
  action?: () => void;
  routerLink?: string | string[];
  menu?: MatMenu;
  closable?: boolean;
  closeAction?: () => void;
}

export type OverflowBarAppearance = 'buttons' | 'icon-buttons' | 'tabs';
export type MenuAlignment = 'start' | 'end';
