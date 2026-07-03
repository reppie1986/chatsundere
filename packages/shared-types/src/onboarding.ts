// SPDX-License-Identifier: MIT

import type { SetupStatusResponse } from './setup.js';

export type OnboardingUrlIntent =
  | { kind: 'none' }
  | { kind: 'invitation'; base_url: string | null; code: string };

export type OnboardingResolvedState =
  | { kind: 'invitation_pending'; base_url: string | null; code: string }
  | { kind: 'signed_in' }
  | { kind: 'account_linked'; base_url: string; role: 'primary_admin' | 'admin' | 'user' }
  | { kind: 'server_has_no_owner'; server_display_name: string | null }
  | { kind: 'signed_out'; server_display_name: string | null }
  | { kind: 'recovery_required'; reason: 'local_account_missing' | 'link_missing' };

export interface ResolveOnboardingStateInput {
  urlIntent: OnboardingUrlIntent;
  setupStatus: SetupStatusResponse | null;
  hasLocalAccount: boolean;
  linkedAccount: {
    base_url: string;
    role: 'primary_admin' | 'admin' | 'user';
  } | null;
  hasSession: boolean;
}

/** Parse an invitation URL or route into the shared onboarding intent shape. */
export function parseInvitationUrlIntent(
  href: string,
  defaultBaseUrl: string | null = null,
): OnboardingUrlIntent {
  const hashIndex = href.indexOf('#');
  const queryIndex = href.indexOf('?');
  const hashCode = hashIndex >= 0 ? href.slice(hashIndex + 1).trim() : '';
  const query =
    queryIndex >= 0 ? href.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined) : '';
  const queryParams = parseQuery(query);
  const queryCode = queryParams.code ?? '';
  const code = hashCode || queryCode;
  if (!code) return { kind: 'none' };

  const baseFromQuery = queryParams.server ?? null;
  const baseUrl = baseFromQuery || defaultBaseUrl;
  return { kind: 'invitation', base_url: baseUrl, code };
}

function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of query.split('&')) {
    if (!part) continue;
    const [rawKey, rawValue = ''] = part.split('=');
    if (!rawKey) continue;
    out[safeDecode(rawKey)] = safeDecode(rawValue).trim();
  }
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/** Resolve the cross-client onboarding state without touching storage or network. */
export function resolveOnboardingState(
  input: ResolveOnboardingStateInput,
): OnboardingResolvedState {
  if (input.urlIntent.kind === 'invitation') {
    return {
      kind: 'invitation_pending',
      base_url: input.urlIntent.base_url,
      code: input.urlIntent.code,
    };
  }
  if (input.hasSession) return { kind: 'signed_in' };
  if (input.hasLocalAccount && input.linkedAccount) {
    return {
      kind: 'account_linked',
      base_url: input.linkedAccount.base_url,
      role: input.linkedAccount.role,
    };
  }
  if (!input.hasLocalAccount && input.linkedAccount) {
    return { kind: 'recovery_required', reason: 'local_account_missing' };
  }
  if (input.hasLocalAccount && !input.linkedAccount && input.setupStatus?.owner_exists) {
    return { kind: 'recovery_required', reason: 'link_missing' };
  }
  if (input.setupStatus?.setup_available) {
    return {
      kind: 'server_has_no_owner',
      server_display_name: input.setupStatus.server_display_name,
    };
  }
  return {
    kind: 'signed_out',
    server_display_name: input.setupStatus?.server_display_name ?? null,
  };
}
