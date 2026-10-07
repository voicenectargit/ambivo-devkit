// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { Routes } from '@angular/router';
import { signedInGuard } from './core/auth/auth.guard';
import { SignInLayoutComponent } from './sign-in/sign-in-layout.component';

export const routes: Routes = [
  // Pages behind sign-in come FIRST. The sign-in layout below has an empty path,
  // and Angular would otherwise match it for "/" with no page inside.
  {
    path: '',
    pathMatch: 'full',
    canActivate: [signedInGuard],
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  // The app's own pages go here, each with canActivate: [signedInGuard].
  {
    path: '',
    component: SignInLayoutComponent,
    children: [
      { path: 'sign-in', title: $localize`Sign in`, loadComponent: () => import('./sign-in/sign-in.page').then((m) => m.SignInPage) },
      { path: 'sign-in/code', title: $localize`Enter your code`, loadComponent: () => import('./sign-in/enter-code.page').then((m) => m.EnterCodePage) },
      { path: 'sign-in/method', title: $localize`Choose where to send your code`, loadComponent: () => import('./sign-in/choose-method.page').then((m) => m.ChooseMethodPage) },
      { path: 'sign-in/set-up', title: $localize`Set up sign-in codes`, loadComponent: () => import('./sign-in/set-up-email.page').then((m) => m.SetUpEmailPage) },
      { path: 'sign-in/email-codes-only', title: $localize`Set up email codes first`, loadComponent: () => import('./sign-in/email-codes-only.page').then((m) => m.EmailCodesOnlyPage) },
      { path: 'reset-password', title: $localize`Reset your password`, loadComponent: () => import('./sign-in/reset-password.page').then((m) => m.ResetPasswordPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
