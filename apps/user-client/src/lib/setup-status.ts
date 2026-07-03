// SPDX-License-Identifier: AGPL-3.0-only

import type { SetupStatusResponse } from '@chatsundere/shared-types';
import { apiFetch } from './fetch.js';

export async function fetchSetupStatus(baseUrl: string): Promise<SetupStatusResponse> {
  return apiFetch<SetupStatusResponse>({
    baseUrl,
    path: '/api/v1/setup/status',
    authMode: 'none',
  });
}
