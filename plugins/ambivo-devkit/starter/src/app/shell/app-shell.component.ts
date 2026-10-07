// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { map } from 'rxjs';
import { APP_CONFIG } from '../core/config/app-config';
import { AuthService } from '../core/auth/auth.service';
import { NAV_ITEMS } from './nav';

/**
 * The frame of a multi-screen app: a top bar with the app name and Sign out, and a left menu
 * (NAV_ITEMS in ./nav.ts). On a wide screen the menu stays open beside the page; on a phone it is
 * hidden behind the menu button and closes after a tap.
 *
 * Not used by default: a one-screen app does not need it. To use it, make it the parent of the
 * signed-in routes in app.routes.ts (see the ambivo-angular-app skill, "Left navigation").
 */
@Component({
  selector: 'app-shell',
  imports: [MatButtonModule, MatIconModule, MatListModule, MatSidenavModule, MatToolbarModule, RouterLink, RouterLinkActive, RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-toolbar class="bar">
      @if (narrow()) {
        <button mat-icon-button type="button" (click)="menu.toggle()" i18n-aria-label aria-label="Menu">
          <mat-icon>menu</mat-icon>
        </button>
      }
      <span class="title">{{ config.appName }}</span>
      <button mat-button type="button" (click)="auth.signOut()" i18n>Sign out</button>
    </mat-toolbar>
    <mat-sidenav-container class="body">
      <mat-sidenav #menu [mode]="narrow() ? 'over' : 'side'" [opened]="!narrow()" class="menu">
        <mat-nav-list>
          @for (item of items; track item.path) {
            <a
              mat-list-item
              [routerLink]="item.path"
              routerLinkActive
              #active="routerLinkActive"
              [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
              [activated]="active.isActive"
              (click)="closeOnPhone()"
            >
              <mat-icon matListItemIcon>{{ item.icon }}</mat-icon>
              <span matListItemTitle>{{ item.label }}</span>
            </a>
          }
        </mat-nav-list>
      </mat-sidenav>
      <mat-sidenav-content>
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    .title { flex: 1; }
    .body { flex: 1; min-height: 0; }
    .menu { width: 248px; }
  `,
})
export class AppShellComponent {
  protected config = inject(APP_CONFIG);
  protected auth = inject(AuthService);
  protected items = NAV_ITEMS;
  protected sidenav = viewChild.required<MatSidenav>('menu');
  /** A phone held in one hand, or a narrow window. */
  protected narrow = toSignal(
    inject(BreakpointObserver).observe('(max-width: 840px)').pipe(map((s) => s.matches)),
    { initialValue: false },
  );

  protected closeOnPhone(): void {
    if (this.narrow()) void this.sidenav().close();
  }
}
