// SPDX-License-Identifier: AGPL-3.0-only
import { loadEnv } from './env.js';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Browser-facing origin/base path for invitation and pairing links.
 * API_BASE_URL may be configured as either https://host or https://host/auth.
 */
export function publicAppBaseUrl(): string {
  return trimTrailingSlash(loadEnv().API_BASE_URL).replace(/\/auth$/, '');
}

/**
 * Stable OPAQUE/JWT audience binding. Clients use `${baseUrl}/auth/v1`;
 * tolerate API_BASE_URL values with or without the legacy /auth suffix.
 */
export function serverIdentityUrl(): string {
  const base = trimTrailingSlash(loadEnv().API_BASE_URL);
  return base.endsWith('/auth') ? `${base}/v1` : `${base}/auth/v1`;
}
