// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, computed, contentChildren, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ButtonAppearance, OverflowBarBaseComponent, OverflowBarItem } from '../base/overflow-bar-base.component';
import { ButtonGroupItemComponent } from './button-group-item.component';
import { MeasureWidthDirective } from '../directives/measure-width.directive';

export interface ButtonGroupItem extends OverflowBarItem {
  appearance?: ButtonAppearance;
  iconButton?: boolean;
}

/**
 * Button group component with overflow handling
 * Usage with input:
 * <am-button-group [items]="myButtons" appearance="tonal" density="normal" />
 *
 * Usage with content projection:
 * <am-button-group appearance="tonal" density="normal">
 *   <am-button-group-item id="save" label="Save" icon="save" (activated)="save()" />
 *   <am-button-group-item id="delete" label="Delete" icon="delete" (activated)="delete()" />
 * </am-button-group>
 */
@Component({
  selector: 'am-button-group',
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatBadgeModule,
    MatTooltipModule,
    MeasureWidthDirective,
  ],
  templateUrl: './button-group.component.html',
  styleUrls: ['./button-group.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ButtonGroupComponent extends OverflowBarBaseComponent<
  ButtonGroupItem,
  ButtonGroupItemComponent
> {
  // Button-specific inputs
  appearance = input<ButtonAppearance>('tonal');
  iconOnly = input<boolean>(false);

  // Buttons have gaps between them
  protected override itemGap = 8;

  // Content children for template-defined buttons
  protected templateItems = contentChildren(ButtonGroupItemComponent);

  // Check if should show label (not icon-only mode)
  showLabel = computed(() => !this.iconOnly());
}
