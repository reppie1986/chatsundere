// SPDX-License-Identifier: AGPL-3.0-only

import {
  opaqueLoginFinish,
  opaqueLoginStart,
  serverIdentityForBaseUrl,
  toBase64Url,
} from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { apiFetch } from './fetch.js';

interface StepUpStartResponse {
  session_id: string;
  mechanism: 'opaque';
  login_response: string;
  opaque_client_identifier?: string;
}

/** Confirm a Tier-4 admin step-up with the current account password. */
export async function confirmOpaqueAdminStepUp(baseUrl: string, passphrase: string): Promise<void> {
  const session = useSessionStore.getState().session;
  if (!session) throw new Error('No admin session is active');

  const { clientLoginState, startLoginRequest } = await opaqueLoginStart(passphrase);
  const start = await apiFetch<StepUpStartResponse>({
    baseUrl,
    path: '/api/v1/auth/step-up/start',
    authMode: 'bearer',
    json: {
      mechanism: 'opaque',
      tier_requested: 't4',
      login_request: startLoginRequest,
    },
  });

  const finishResult = await opaqueLoginFinish({
    clientLoginState,
    loginResponse: start.login_response,
    passphrase,
    username: start.opaque_client_identifier ?? session.username,
    serverIdentity: serverIdentityForBaseUrl(baseUrl),
  });

  await apiFetch<void>({
    baseUrl,
    path: '/api/v1/auth/step-up/finish',
    authMode: 'none',
    json: {
      mechanism: 'opaque',
      session_id: start.session_id,
      login_evidence: toBase64Url(finishResult.finishLoginRequest),
    },
  });
}
