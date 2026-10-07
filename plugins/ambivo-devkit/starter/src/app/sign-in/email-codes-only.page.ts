// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';

/** The account gets its sign-in codes by text message, and this app sends codes by email only. */
@Component({
  selector: 'app-email-codes-only-page',
  imports: [RouterLink, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mat-headline-small" i18n>Set up email codes first</h1>
    <p class="hint" i18n>This app sends sign-in codes by email. Your account gets codes by text message.</p>
    <p class="hint" i18n>Sign in to Ambivo, add email codes in your account settings, then come back here.</p>
    <div class="actions">
      <a mat-flat-button routerLink="/sign-in" i18n>Back to sign in</a>
    </div>
  `,
})
export class EmailCodesOnlyPage {}
