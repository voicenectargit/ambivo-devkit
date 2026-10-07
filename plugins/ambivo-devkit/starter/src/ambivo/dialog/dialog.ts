// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  HostListener,
  inject,
  Input,
} from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';
import { MatDialogRef } from '@angular/material/dialog';
import { CdkScrollable } from '@angular/cdk/overlay';
import { MatIcon } from '@angular/material/icon';
import { MatIconButton } from '@angular/material/button';

@Directive({
  selector: '[am-dialog-header],am-dialog-header,[amDialogHeader]',
  host: {
    class: 'am-dialog-header',
    '[class.am-dialog-header-fill]': 'appearance === "fill"',
    '[class.am-dialog-header-align-center]': 'align==="center"',
    '[class.am-dialog-header-align-start]': 'align==="start"',
    '[class.am-dialog-header-align-end]': 'align==="end"',
  },
})
export class DialogHeaderDirective {
  @Input() appearance: 'default' | 'fill' = 'default';
  @Input() align: 'start' | 'center' | 'end' = 'start';
}

@Directive({
  selector: '[am-dialog-title],am-dialog-title,[amDialogHeader]',
  host: {
    class: 'am-dialog-title',
    '[class.am-dialog-title--lg]': 'size === "lg"',
    '[class.am-dialog-title--md]': 'size === "md"',
    '[class.am-dialog-title--sm]': 'size === "sm"',
  },
})
export class DialogTitleDirective {
  @Input() size?: 'lg' | 'md' | 'sm';
}

@Directive({
  selector: '[am-dialog-content],am-dialog-content,[amDialogContent]',
  host: { class: 'am-dialog-content' },
  hostDirectives: [CdkScrollable],
})
export class DialogContentDirective {}

@Directive({
  selector: '[am-dialog-actions],am-dialog-actions,[amDialogClose]',
  host: {
    class: 'am-dialog-actions',
    '[class.am-dialog-actions--align-center]': 'align === "center"',
    '[class.am-dialog-actions--align-end]': 'align === "end"',
  },
})
export class DialogActionsDirective {
  @Input() align?: 'start' | 'center' | 'end' = 'start';
}

@Directive({
  selector: '[amDialogClose],[am-dialog-close],am-dialog-close,',
  host: { class: 'am-dialog-close' },
})
export class DialogCloseDirective {
  private dialogRef = inject(DialogRef, { optional: true });
  private matDialogRef = inject(MatDialogRef, { optional: true });
  @Input('am-dialog-close') dialogResult: any;
  @Input('amDialogClose') _dialogResult: any;

  @HostListener('click')
  onClick(): void {
    (this.matDialogRef || this.dialogRef)?.close(this.dialogResult || this._dialogResult);
  }
}

@Directive({
  selector: '[am-dialog-hint],am-dialog-hint,[amDialogHeader]',
  host: { class: 'am-dialog-hint' },
})
export class DialogHintDirective {}

@Component({
  selector: 'am-dialog-close-btn',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: ` <button mat-icon-button am-dialog-close type="button" tabindex="-1">
    <mat-icon>close</mat-icon>
  </button>`,
  imports: [MatIcon, MatIconButton, DialogCloseDirective],
})
export class DialogCloseButtonComponent {}
