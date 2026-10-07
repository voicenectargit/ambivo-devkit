// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { NgModule } from '@angular/core';
import {
  DialogActionsDirective,
  DialogCloseButtonComponent,
  DialogCloseDirective,
  DialogContentDirective,
  DialogHeaderDirective,
  DialogHintDirective,
  DialogTitleDirective,
} from './dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

@NgModule({
  imports: [
    DialogHeaderDirective,
    DialogTitleDirective,
    DialogContentDirective,
    DialogActionsDirective,
    DialogCloseDirective,
    DialogHintDirective,
    DialogCloseButtonComponent,
    MatIconModule,
    MatButtonModule,
  ],
  exports: [
    DialogHeaderDirective,
    DialogTitleDirective,
    DialogContentDirective,
    DialogActionsDirective,
    DialogCloseDirective,
    DialogHintDirective,
    DialogCloseButtonComponent,
  ],
})
export class DialogLayout {}
