// AMBIVO LOCKED FILE. Do not edit, move or delete.
// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License, not the starter's MIT
// License: an app may include this file only unchanged (Kit License sections 1(b) and 2(f)).
// Every app made with Ambivo Dev Studio or the Ambivo Dev Kit shows this page unchanged. The dev kit,
// Dev Studio and Ambivo compare this file's SHA-256 with Ambivo's copy: a changed file fails
// ambivo:check, stops Share, Deploy, Push and Download in Dev Studio, and Ambivo refuses to certify the
// app or to install its custom objects in a client's company. The words are fixed by Ambivo's
// Developer Terms and are not translated.
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Location } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { APP_CONFIG } from '../app/core/config/app-config';
import certificateFile from '../install/ambivo-certificate.json';
import { AMBIVO_DEVELOPER_TERMS_URL, AMBIVO_PRIVACY_URL, readCertificate } from './about';

@Component({
  selector: 'ambivo-about-page',
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wrapper">
      <div class="card">
        <button mat-button type="button" class="back" (click)="back()">
          <mat-icon>arrow_back</mat-icon>
          Back
        </button>
        <h1 class="mat-headline-small">About this app</h1>
        <p class="mat-title-medium name">
          {{ cert?.app_name || config.appName }}
          @if (cert?.app_version) {
            <span class="muted">version {{ cert?.app_version }}</span>
          }
        </p>

        <p>This app was made with Ambivo Dev Studio.</p>
        <dl>
          <dt>Made by:</dt>
          <dd>{{ cert?.made_by || 'Not certified' }}</dd>
          <dt>Support:</dt>
          <dd>
            @if (cert?.support_email) {
              <a [href]="'mailto:' + cert?.support_email">{{ cert?.support_email }}</a>
            } @else {
              Not certified
            }
          </dd>
        </dl>

        <p>The partner who made this app supports it.</p>
        <p>Ambivo does not support this app and is not responsible for it.</p>
        <p>The Ambivo Developer Terms (beta) govern this app's license and terms.</p>

        <ul class="links">
          <li><a [href]="privacyUrl" target="_blank" rel="noopener">Ambivo Privacy Policy</a></li>
          <li><a [href]="termsUrl" target="_blank" rel="noopener">Ambivo Developer Terms</a></li>
        </ul>

        <div class="certificate">
          @if (cert) {
            @if (cert.app_id) {
              <p>App ID {{ cert.app_id }}</p>
            }
            <p class="mat-title-small">Certificate {{ cert.cert_id }}</p>
            <p class="sha">SHA-256 {{ cert.sha256 }}</p>
            <p><a [href]="cert.verify_url" target="_blank" rel="noopener">Check this certificate with Ambivo</a></p>
          } @else {
            <p class="mat-title-small">Certificate: none</p>
            <p>Ambivo has not checked this copy of the app.</p>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; height: 100%; }
    .wrapper { height: 100%; overflow: auto; padding: 32px 16px; box-sizing: border-box; }
    .card {
      max-width: 560px;
      margin: 0 auto;
      padding: 24px;
      border-radius: 18px;
      box-shadow: var(--mat-sys-level2);
      background-color: var(--mat-sys-surface);
    }
    .back { margin: -8px 0 8px -8px; }
    .name { margin-top: 0; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0 0 16px; }
    dt { color: var(--mat-sys-on-surface-variant); }
    dd { margin: 0; overflow-wrap: anywhere; }
    .links { padding-left: 20px; }
    .certificate { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--mat-sys-outline-variant); }
    .sha { font-family: monospace; overflow-wrap: anywhere; color: var(--mat-sys-on-surface-variant); }
  `,
})
export class AboutPage {
  protected config = inject(APP_CONFIG);
  private location = inject(Location);
  protected cert = readCertificate(certificateFile);
  protected privacyUrl = AMBIVO_PRIVACY_URL;
  protected termsUrl = AMBIVO_DEVELOPER_TERMS_URL;

  protected back(): void {
    this.location.back();
  }
}
