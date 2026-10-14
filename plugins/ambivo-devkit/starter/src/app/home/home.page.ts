// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { InsetDirective, StackDirective, SurfaceDirective } from '@am/crm/ui/layout';
import { APP_CONFIG } from '../core/config/app-config';
import { AuthService } from '../core/auth/auth.service';
import { errorText } from '../sign-in/sign-in-step';

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
    <main amInset="lg" amStack>
      <section amSurface amInset="lg" amStack>
        @if (auth.user(); as user) {
          <h1 class="mat-headline-small" i18n>Signed in as {{ user.name }}</h1>
          <p i18n>Email: {{ user.email }}</p>
        }
      </section>

      <!-- Keep this card when you replace the page: it is how a company admin turns on
           Google and Microsoft sign-in for this app's address. -->
      @if (showProviderCard) {
        <section amSurface amInset="lg" amStack>
          <h2 class="mat-title-medium" i18n>Google and Microsoft sign-in</h2>
          @switch (providerState()) {
            @case ('on') {
              <p i18n>On for {{ origin }}.</p>
            }
            @case ('off') {
              <p i18n>Off for {{ origin }}. Turn it on so people in your company can sign in here with Google or Microsoft.</p>
              <div>
                <button mat-flat-button type="button" [disabled]="busy()" (click)="turnOn()" i18n>Turn on</button>
              </div>
            }
          }
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
        </section>
      }
    </main>
  `,
  styles: `
    .title { flex: 1; }
    .error { color: var(--mat-sys-error); }
  `,
})
export class HomePage implements OnInit {
  private destroyRef = inject(DestroyRef);
  protected config = inject(APP_CONFIG);
  protected auth = inject(AuthService);

  protected origin = window.location.origin;
  protected showProviderCard =
    !!(this.config.signInOptions?.google || this.config.signInOptions?.microsoft) && !!this.auth.user()?.isAdmin;
  protected providerState = signal<'loading' | 'on' | 'off'>('loading');
  protected busy = signal(false);
  protected error = signal('');

  ngOnInit(): void {
    if (!this.showProviderCard) return;
    this.auth
      .providerSignInAllowedHere()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (on) => this.providerState.set(on ? 'on' : 'off'),
        error: (err) => this.error.set(errorText(err)),
      });
  }

  protected turnOn(): void {
    this.busy.set(true);
    this.error.set('');
    this.auth
      .allowProviderSignInHere()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busy.set(false);
          this.providerState.set('on');
        },
        error: (err) => {
          this.busy.set(false);
          this.error.set(errorText(err));
        },
      });
  }
}
