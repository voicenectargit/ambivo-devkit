// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ButtonAppearance } from '../base/overflow-bar-base.component';
import { OverflowBarItemComponent } from '../base/overflow-bar-item.component';
import { ButtonGroupItem } from './button-group.component';

/**
 * Button group item component for use within am-button-group
 * Usage:
 * <am-button-group>
 *   <am-button-group-item id="save" label="Save" icon="save" (activated)="onSave()" />
 *   <am-button-group-item id="delete" label="Delete" icon="delete" appearance="filled" (activated)="onDelete()" />
 * </am-button-group>
 */
@Component({
  selector: 'am-button-group-item',
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ButtonGroupItemComponent extends OverflowBarItemComponent {
  // Button-specific inputs
  appearance = input<ButtonAppearance>();
  permanent = input(false, { transform: booleanAttribute });
  iconButton = input(false, { transform: booleanAttribute });
  disabledMessage = input<string>();

  /**
   * Computed ButtonGroupItem including button-specific properties
   */
  override item = computed<ButtonGroupItem>(() => ({
    ...this.baseItem(),
    appearance: this.appearance(),
    permanent: this.permanent(),
    iconButton: this.iconButton(),
  }));
}
