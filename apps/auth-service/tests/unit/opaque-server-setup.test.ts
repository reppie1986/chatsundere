// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, test } from 'bun:test';
import '../setup.js';
import { getServerSetup } from '../../src/opaque/server.js';

describe('OPAQUE server setup', () => {
  test('uses persistent env material across auth-service restarts', () => {
    const previous = process.env.OPAQUE_SERVER_SETUP;
    const setup = 'opaque-server-setup-regression-value-000000000000000000000000000000';

    process.env.OPAQUE_SERVER_SETUP = setup;

    try {
      expect(getServerSetup()).toBe(setup);
      expect(getServerSetup()).toBe(setup);
    } finally {
      if (previous === undefined) {
        Reflect.deleteProperty(process.env, 'OPAQUE_SERVER_SETUP');
      } else {
        process.env.OPAQUE_SERVER_SETUP = previous;
      }
    }
  });
});
