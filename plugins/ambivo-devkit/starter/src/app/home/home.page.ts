// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { InsetDirective, StackDirective, SurfaceDirective } from '@am/crm/ui/layout';
import { APP_CONFIG } from '../core/config/app-config';
import { AuthService } from '../core/auth/auth.service';

/** The first page after sign-in. Replace it with the app's own screens. */
@Component({
  selector: 'app-home-page',
  imports: [MatButtonModule, MatToolbarModule, InsetDirective, StackDirective, SurfaceDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-toolbar>
      <span class="title">{{ config.appName }}</span>
      <button mat-button type="button" (click)="auth.signOut()" i18n>Sign out</button>
    </mat-toolbar>
    <main amInset="lg">
      <section amSurface amInset="lg" amStack>
        @if (auth.user(); as user) {
          <h1 class="mat-headline-small" i18n>Signed in as {{ user.name }}</h1>
          <p i18n>Email: {{ user.email }}</p>
        }
      </section>
    </main>
  `,
  styles: `
    .title { flex: 1; }
  `,
})
export class HomePage {
  protected config = inject(APP_CONFIG);
  protected auth = inject(AuthService);
}
