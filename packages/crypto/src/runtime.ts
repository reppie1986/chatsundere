// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from './errors.js';

const REQUIRED_GLOBALS = [
  'crypto',
  'TextEncoder',
  'TextDecoder',
  'Uint8Array',
  'indexedDB',
] as const;

export type RequiredRuntimeApi =
  | (typeof REQUIRED_GLOBALS)[number]
  | 'crypto.subtle'
  | 'crypto.getRandomValues';

export class RuntimeUnsupportedError extends CryptoError {
  constructor(public readonly missingRequiredApis: RequiredRuntimeApi[]) {
    super(
      'runtime_unsupported',
      `Missing required runtime APIs: ${missingRequiredApis.join(', ')}`,
    );
    this.name = 'RuntimeUnsupportedError';
  }
}

/**
 * Refuses to continue if the runtime is missing any of the primitives this
 * library depends on. Called once at application boot. Failure is loud;
 * silent fallback is not safe in a crypto context.
 */
export function assertRuntimeSupport(): void {
  const missing: RequiredRuntimeApi[] = [];
  for (const name of REQUIRED_GLOBALS) {
    if (!(name in globalThis)) {
      missing.push(name);
    }
  }
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    missing.push('crypto.subtle');
  }
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    missing.push('crypto.getRandomValues');
  }
  if (missing.length > 0) {
    throw new RuntimeUnsupportedError(missing);
  }
}
