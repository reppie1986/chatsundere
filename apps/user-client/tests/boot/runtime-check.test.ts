// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';

import { checkRuntime } from '../../src/boot/runtime-check.js';

function withGlobalDescriptor(
  name: keyof typeof globalThis,
  descriptor: PropertyDescriptor | undefined,
  fn: () => void,
): void {
  const original = Object.getOwnPropertyDescriptor(globalThis, name);
  try {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
    fn();
  } finally {
    if (original) {
      Object.defineProperty(globalThis, name, original);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
}

describe('checkRuntime', () => {
  it('returns ok for the supported test runtime', () => {
    expect(checkRuntime()).toEqual({ ok: true });
  });

  it('reports stable missing API names instead of unknown', () => {
    withGlobalDescriptor(
      'crypto',
      {
        value: { getRandomValues: globalThis.crypto.getRandomValues },
        writable: true,
        configurable: true,
      },
      () => {
        expect(checkRuntime()).toEqual({ ok: false, missing: ['crypto.subtle'] });
      },
    );
  });

  it('reports multiple missing APIs without an unknown placeholder', () => {
    withGlobalDescriptor(
      'crypto',
      {
        value: {},
        writable: true,
        configurable: true,
      },
      () => {
        withGlobalDescriptor('indexedDB', undefined, () => {
          const result = checkRuntime();
          expect(result).toEqual({
            ok: false,
            missing: ['indexedDB', 'crypto.subtle', 'crypto.getRandomValues'],
          });
          if (!result.ok) {
            expect(result.missing).not.toContain('unknown');
          }
        });
      },
    );
  });
});
