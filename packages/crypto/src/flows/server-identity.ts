// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Stable OPAQUE/JWT audience binding used by browser clients.
 *
 * `baseUrl` is the public server URL users enter during onboarding. Normal
 * deployments use `https://host`; older auth-only configs may use
 * `https://host/auth`. Both must produce the same logical OPAQUE server id.
 */
export function serverIdentityForBaseUrl(baseUrl: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return base.endsWith('/auth') ? `${base}/v1` : `${base}/auth/v1`;
}
