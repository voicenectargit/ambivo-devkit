// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { A11yModule } from '@angular/cdk/a11y';
import { APP_CONFIG } from '../core/config/app-config';

/** The card every sign-in screen sits in. Same look as Ambivo's own sign-in page. */
@Component({
  selector: 'app-sign-in-layout',
  imports: [RouterOutlet, A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrapper">
      <div class="container">
        @if (config.logoUrl) {
          <img class="logo" [src]="config.logoUrl" [alt]="config.appName" />
        } @else {
          <div class="mat-headline-small app-name">{{ config.appName }}</div>
        }
        <div class="card" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
          <router-outlet />
        </div>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .wrapper { height: 100%; overflow: auto; position: relative; }
    .container { padding: 80px 32px; display: flex; flex-direction: column; align-items: center; }
    .logo { width: 280px; margin-bottom: 60px; }
    .app-name { margin-bottom: 40px; }
    .card {
      width: 420px;
      padding: 32px;
      border-radius: 18px;
      box-shadow: var(--mat-sys-level3);
      position: relative;
      overflow: hidden;
      background-color: var(--mat-sys-surface);
    }
    :host ::ng-deep form { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
    :host ::ng-deep .actions { display: flex; flex-direction: column; align-items: stretch; margin-top: 12px; gap: 12px; }
    :host ::ng-deep .progress-bar { position: absolute; bottom: 0; left: 0; right: 0; }
    :host ::ng-deep .hint { color: var(--mat-sys-on-surface-variant); margin: 0 0 24px; }
    :host ::ng-deep .error { color: var(--mat-sys-error); margin: 0 0 16px; }
    @media (max-width: 780px) {
      .container { display: block; padding: 60px 24px; }
      .card { background: transparent; box-shadow: none; width: 100%; padding: 0; position: static; }
      .logo { display: none; }
    }
  `,
})
export class SignInLayoutComponent {
  protected config = inject(APP_CONFIG);
}
