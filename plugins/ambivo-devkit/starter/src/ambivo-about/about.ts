// AMBIVO LOCKED FILE. Do not edit, move or delete. See about.page.ts.
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License, not the starter's MIT
// License: an app may include this file only unchanged (Kit License sections 1(b) and 2(f)).
//
// provideAmbivoAbout() in app.config.ts adds the /about page before every other route, open with or
// without sign-in. <ambivo-about-link /> goes on the sign-in page, and ABOUT_NAV_ITEM in the left menu.
import { ChangeDetectionStrategy, Component, inject, provideAppInitializer } from '@angular/core';
import { Route, Router, RouterLink } from '@angular/router';

export const AMBIVO_PRIVACY_URL = 'https://www.ambivo.com/privacy-policy';
export const AMBIVO_DEVELOPER_TERMS_URL = 'https://www.ambivo.com/legal/developer-terms';
export const AMBIVO_VERIFY_URL = 'https://devstudio.ambivo.com/verify/';

export const ABOUT_ROUTE: Route = {
  path: 'about',
  title: 'About this app',
  loadComponent: () => import('./about.page').then((m) => m.AboutPage),
};

/** The left menu entry. Put it last in NAV_ITEMS (src/app/shell/nav.ts). */
export const ABOUT_NAV_ITEM = { path: '/about', label: 'About', icon: 'info', exact: true };

/** Adds /about ahead of the app's own routes, so no route or redirect can hide it. */
export function provideAmbivoAbout() {
  return provideAppInitializer(() => {
    const router = inject(Router);
    router.resetConfig([ABOUT_ROUTE, ...router.config.filter((r) => r.path !== ABOUT_ROUTE.path)]);
  });
}

/** What Ambivo signed for this app, from src/install/ambivo-certificate.json. */
export interface AmbivoCertificate {
  cert_id: string;
  app_id: string;
  sha256: string;
  verify_url: string;
  app_key: string;
  app_name: string;
  app_version: string;
  made_by: string;
  support_email: string;
  issued_at: string;
}

const CERT_ID = /^AMB-[0-9A-Z]{4}-[0-9A-Z]{4}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/** The certificate, or null when the file holds none or a value is not in Ambivo's format. */
export function readCertificate(file: unknown): AmbivoCertificate | null {
  const c = (file as { certificate?: Partial<AmbivoCertificate> | null } | null)?.certificate;
  if (!c || !CERT_ID.test(String(c.cert_id)) || !SHA256.test(String(c.sha256))) return null;
  return {
    cert_id: String(c.cert_id),
    app_id: /^[a-z][a-z0-9.]{4,154}$/.test(String(c.app_id ?? '')) ? String(c.app_id) : '',
    sha256: String(c.sha256),
    verify_url: `${AMBIVO_VERIFY_URL}${c.cert_id}?sha256=${c.sha256}`,
    app_key: String(c.app_key ?? ''),
    app_name: String(c.app_name ?? ''),
    app_version: String(c.app_version ?? ''),
    made_by: String(c.made_by ?? ''),
    support_email: String(c.support_email ?? ''),
    issued_at: String(c.issued_at ?? ''),
  };
}

/** A small "About this app" link. On the sign-in page, under the card. */
@Component({
  selector: 'ambivo-about-link',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<a routerLink="/about">About this app</a>`,
  styles: `
    :host { display: block; text-align: center; margin-top: 24px; }
    a { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class AmbivoAboutLink {}
