// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
/// <reference types="@angular/localize" />
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { loadAppConfig } from './app/core/config/app-config';

loadAppConfig()
  .then((config) => {
    document.title = config.appName;
    return bootstrapApplication(App, appConfig(config));
  })
  .catch((err) => {
    console.error(err);
    document.body.textContent = 'This app is not set up for this address. Ask your administrator.';
  });
