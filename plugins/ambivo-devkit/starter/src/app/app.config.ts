// Copyright (c) 2026 Ambivo, Inc. Licensed under the MIT License. See LICENSE-AMBIVO-STARTER.txt.
import {
  ApplicationConfig,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { MatIconRegistry } from '@angular/material/icon';
import { DEFAULT_DIALOG_CONFIG, DialogConfig } from '@angular/cdk/dialog';
import { routes } from './app.routes';
import { APP_CONFIG, AppConfig } from './core/config/app-config';
import { authInterceptor } from './core/auth/auth.interceptor';
import { provideAmbivoAbout } from '../ambivo-about/about';

export function appConfig(config: AppConfig): ApplicationConfig {
  return {
    providers: [
      { provide: APP_CONFIG, useValue: config },
      provideBrowserGlobalErrorListeners(),
      provideZoneChangeDetection({ eventCoalescing: true }),
      provideAnimationsAsync(),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideRouter(routes, withComponentInputBinding()),
      // The fixed About page every Ambivo-made app shows (/about). Required; see src/ambivo-about.
      provideAmbivoAbout(),
      // Same icon font as Ambivo's apps.
      provideEnvironmentInitializer(() =>
        inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined'),
      ),
      // Ambivo dialogs: CDK Dialog with the `am-dialog` panel. MatDialog is not used.
      { provide: DEFAULT_DIALOG_CONFIG, useValue: { ...new DialogConfig(), panelClass: 'am-dialog', autoFocus: false } },
    ],
  };
}
