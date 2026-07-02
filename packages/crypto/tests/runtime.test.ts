// SPDX-License-Identifier: LGPL-3.0-only
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'bun:test';

import { CryptoError } from '../src/errors.js';
import { RuntimeUnsupportedError, assertRuntimeSupport } from '../src/runtime.js';

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

function expectMissing(fn: () => void): string[] {
  try {
    fn();
    throw new Error('Expected runtime check to fail');
  } catch (e) {
    expect(e).toBeInstanceOf(CryptoError);
    expect(e).toBeInstanceOf(RuntimeUnsupportedError);
    return (e as RuntimeUnsupportedError).missingRequiredApis;
  }
}

describe('assertRuntimeSupport', () => {
  it('returns silently when all primitives are present', () => {
    expect(() => assertRuntimeSupport()).not.toThrow();
  });

  it('reports missing global crypto', () => {
    withGlobalDescriptor('crypto', undefined, () => {
      const missing = expectMissing(assertRuntimeSupport);
      expect(missing).toContain('crypto');
    });
  });

  it('reports missing crypto.subtle', () => {
    withGlobalDescriptor(
      'crypto',
      {
        value: { getRandomValues: globalThis.crypto.getRandomValues },
        writable: true,
        configurable: true,
      },
      () => {
        expect(expectMissing(assertRuntimeSupport)).toEqual(['crypto.subtle']);
      },
    );
  });

  it('reports missing crypto.getRandomValues', () => {
    withGlobalDescriptor(
      'crypto',
      {
        value: { subtle: globalThis.crypto.subtle },
        writable: true,
        configurable: true,
      },
      () => {
        expect(expectMissing(assertRuntimeSupport)).toEqual(['crypto.getRandomValues']);
      },
    );
  });

  it('reports missing indexedDB', () => {
    withGlobalDescriptor('indexedDB', undefined, () => {
      expect(expectMissing(assertRuntimeSupport)).toEqual(['indexedDB']);
    });
  });

  it('reports multiple missing APIs together', () => {
    withGlobalDescriptor(
      'crypto',
      {
        value: {},
        writable: true,
        configurable: true,
      },
      () => {
        withGlobalDescriptor('indexedDB', undefined, () => {
          expect(expectMissing(assertRuntimeSupport)).toEqual([
            'indexedDB',
            'crypto.subtle',
            'crypto.getRandomValues',
          ]);
        });
      },
    );
  });
});
