// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { indicate } from '@am/shared/utils/rxjs';
import { AuthService } from '../core/auth/auth.service';
import { MfaFactor } from '../core/auth/auth.types';
import { errorText, goToStep, safeNext } from './sign-in-step';

/** The account has more than one email address for codes. Pick where to send this one. */
@Component({
  selector: 'app-choose-method-page',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (step(); as s) {
      <h1 class="mat-headline-small" i18n>Where should we send your code?</h1>
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }
      <div class="actions">
        @for (factor of s.factors; track factor.factorId) {
          <button mat-stroked-button type="button" [disabled]="busy()" (click)="choose(s.preMfaToken, factor)">
            <mat-icon>mail</mat-icon>
            {{ factor.destinationMasked }}
          </button>
        }
        <a mat-button routerLink="/sign-in" i18n>Back to sign in</a>
      </div>
    } @else {
      <p class="hint" i18n>Your sign-in has timed out. Sign in again.</p>
      <a mat-flat-button routerLink="/sign-in" i18n>Sign in</a>
    }
    @if (busy()) {
      <mat-progress-bar class="progress-bar" mode="indeterminate" />
    }
  `,
})
export class ChooseMethodPage {
  private destroyRef = inject(DestroyRef);
  private auth = inject(AuthService);
  private router = inject(Router);
  private next = safeNext(inject(ActivatedRoute).snapshot.queryParamMap.get('next'));

  protected step = computed(() => {
    const s = this.auth.pending();
    return s?.kind === 'choose-method' ? s : null;
  });
  protected busy = signal(false);
  protected error = signal('');

  protected choose(preMfaToken: string, factor: MfaFactor): void {
    this.error.set('');
    this.auth
      .chooseMethod(preMfaToken, factor)
      .pipe(indicate(this.busy), takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (step) => goToStep(this.router, step, this.next),
        error: (err) => this.error.set(errorText(err)),
      });
  }
}
