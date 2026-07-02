// SPDX-License-Identifier: AGPL-3.0-only
import { CryptoError, assertRuntimeSupport } from '@chatsundere/crypto';

const REQUIRED_APIS_PATTERN = /Missing required runtime APIs:\s*(.+)$/i;
const REQUIRED_GLOBAL_PATTERN = /Missing required global:\s*(.+)$/i;

function missingFromRuntimeError(e: unknown): string[] | null {
  const missingRequiredApis = (e as { missingRequiredApis?: unknown }).missingRequiredApis;
  if (
    Array.isArray(missingRequiredApis) &&
    missingRequiredApis.every((item) => typeof item === 'string')
  ) {
    return [...missingRequiredApis];
  }

  if (!(e instanceof CryptoError) || e.code !== 'runtime_unsupported') {
    return null;
  }

  const message = e.message;
  const requiredApis = message.match(REQUIRED_APIS_PATTERN);
  if (requiredApis?.[1]) {
    return requiredApis[1].split(',').map((s) => s.trim());
  }

  const requiredGlobal = message.match(REQUIRED_GLOBAL_PATTERN);
  if (requiredGlobal?.[1]) {
    return [requiredGlobal[1].trim()];
  }

  if (message.includes('crypto.subtle')) return ['crypto.subtle'];
  if (message.includes('crypto.getRandomValues')) return ['crypto.getRandomValues'];

  return [message];
}

export function checkRuntime(): { ok: true } | { ok: false; missing: string[] } {
  try {
    assertRuntimeSupport();
    return { ok: true };
  } catch (e) {
    return { ok: false, missing: missingFromRuntimeError(e) ?? ['Unknown runtime failure'] };
  }
}
