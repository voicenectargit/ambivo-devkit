// Copyright (c) 2026 Ambivo, Inc. Licensed under the Ambivo Developer Kit License. See LICENSE.
import { InjectionToken } from '@angular/core';

/**
 * What one deployment of this app needs to know. Loaded at boot from
 * `runtime-config/<host>.json`, so the SAME build serves every client: each
 * client gets its own host name and its own config file. Nothing here is secret.
 */
export interface AppConfig {
  /** Ambivo API base, ending in `/`. `/api/` in local dev (see proxy.conf.json). */
  apiUrl: string;
  /**
   * Optional. Leave it out and anyone with an Ambivo account can sign in, and each
   * person sees only their own company's data (the API limits every call to the
   * signed-in person's tenant). Set it to limit sign-in to one company: the API then
   * refuses users from any other tenant.
   */
  tenantId?: string;
  /** Shown in the browser tab and on the sign-in page. */
  appName: string;
  /** Optional logo for the sign-in page. */
  logoUrl?: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('APP_CONFIG');

/**
 * Fetch the config for the host this page was served from. A missing or broken
 * file stops the app: guessing an API or a tenant would sign people in to the
 * wrong place.
 */
export async function loadAppConfig(host = window.location.hostname): Promise<AppConfig> {
  const url = `runtime-config/${encodeURIComponent(host)}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`No runtime config for host "${host}" (${url}: HTTP ${res.status})`);
  const config = (await res.json()) as Partial<AppConfig>;
  for (const key of ['apiUrl', 'appName'] as const) {
    if (!config[key]) throw new Error(`${url} is missing "${key}"`);
  }
  const apiUrl = config.apiUrl!.endsWith('/') ? config.apiUrl! : `${config.apiUrl}/`;
  return { ...(config as AppConfig), apiUrl };
}
