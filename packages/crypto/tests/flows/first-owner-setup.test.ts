// SPDX-License-Identifier: LGPL-3.0-only
import '../setup.js';
import { beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { ready as opaqueReady, server as opaqueServer } from '@serenity-kit/opaque';
import { getLinkedAccount } from '../../src/db/linked-account.js';
import { getLocalAccount } from '../../src/db/local-account.js';
import { openLocalDb } from '../../src/db/open.js';
import { decodeRecoveryKey } from '../../src/encoding/recovery-key.js';
import { finishFirstOwnerSetup, startFirstOwnerSetup } from '../../src/flows/first-owner-setup.js';
import type { ServerClient } from '../../src/server-client.js';

const DB = 'chatsundere-test-first-owner-setup';
const BASE_URL = 'https://example.com';
const PASSPHRASE = 'correct horse battery staple';
const USERNAME = 'owner';
const SERVER_DISPLAY_NAME = 'My Chatsundere';

function makeServerClient(opts: { serverSetup: string; rejectFinishWith?: Error }): ServerClient {
  return {
    async ownerSetupStart(req) {
      const { registrationResponse } = opaqueServer.createRegistrationResponse({
        serverSetup: opts.serverSetup,
        userIdentifier: 'setup-owner:test-session',
        registrationRequest: req.registration_request,
      });
      return {
        session_id: 'owner-session-123',
        registration_response: registrationResponse,
      };
    },
    async ownerSetupFinish(req) {
      if (opts.rejectFinishWith) throw opts.rejectFinishWith;
      return {
        user_id: 'srv-owner-uuid',
        username: req.username,
        role: 'primary_admin',
        access_token: 'access-jwt',
        expires_in: 900,
        is_new_account: true,
      };
    },
    async joinStart() {
      throw new Error('not used');
    },
    async joinFinish() {
      throw new Error('not used');
    },
    async loginOpaqueStart() {
      throw new Error('not used');
    },
    async loginOpaqueFinish() {
      throw new Error('not used');
    },
    async recoveryStart() {
      throw new Error('not used');
    },
    async recoveryFinish() {
      throw new Error('not used');
    },
    async deleteMe() {
      throw new Error('not used');
    },
    async updateRecovery() {
      throw new Error('not used');
    },
    async patchMe() {
      throw new Error('not used');
    },
    async passphraseChangeStart() {
      throw new Error('not used');
    },
    async passphraseChangeFinish() {
      throw new Error('not used');
    },
    async stepUpStart() {
      throw new Error('not used');
    },
    async stepUpFinish() {
      throw new Error('not used');
    },
    async linkPasskeyStart() {
      throw new Error('not used');
    },
    async linkPasskeyFinish() {
      throw new Error('not used');
    },
  };
}

beforeAll(async () => {
  await opaqueReady;
});

beforeEach(async () => {
  await new Promise<void>((r) => {
    const req = globalThis.indexedDB.deleteDatabase(DB);
    req.onsuccess = () => r();
    req.onerror = () => r();
    req.onblocked = () => r();
  });
});

describe('first-owner setup', () => {
  it('persists local_account and linked_account rows for the primary admin', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const client = makeServerClient({ serverSetup });

    const setupState = await startFirstOwnerSetup({
      serverClient: client,
      baseUrl: BASE_URL,
      serverDisplayName: SERVER_DISPLAY_NAME,
      passphrase: PASSPHRASE,
    });

    expect(setupState.sessionId).toBe('owner-session-123');
    expect(setupState.serverDisplayName).toBe(SERVER_DISPLAY_NAME);

    const result = await finishFirstOwnerSetup({
      db,
      serverClient: client,
      baseUrl: BASE_URL,
      setupState,
      username: USERNAME,
      passphrase: PASSPHRASE,
    });

    expect(result.session.mode).toBe('linked');
    expect(result.session.online).toBe(true);
    expect(result.session.userId).toBe('srv-owner-uuid');
    expect(result.session.username).toBe(USERNAME);
    expect(result.session.role).toBe('primary_admin');
    expect(result.session.accessToken).toBe('access-jwt');
    expect(decodeRecoveryKey(result.recoveryKeyString).length).toBe(32);

    const localRow = await getLocalAccount(db);
    expect(localRow?.username).toBe(USERNAME);
    expect(localRow?.wrapped_mk_local_ciphertext).toBeInstanceOf(Uint8Array);
    expect(localRow?.wrapped_mk_recovery_ciphertext).toBeInstanceOf(Uint8Array);

    const linkedRow = await getLinkedAccount(db);
    expect(linkedRow?.server_user_id).toBe('srv-owner-uuid');
    expect(linkedRow?.base_url).toBe(BASE_URL);
    expect(linkedRow?.role).toBe('primary_admin');
    expect(linkedRow?.issuer_label).toBe(SERVER_DISPLAY_NAME);
    expect(linkedRow?.wrapped_mk_opaque_ciphertext).toBeInstanceOf(Uint8Array);

    result.session.close();
    db.close();
  });

  it('maps server username conflicts to CryptoError("conflict")', async () => {
    const db = await openLocalDb(DB);
    const serverSetup = opaqueServer.createSetup();
    const conflictError = Object.assign(new Error('username taken'), {
      status: 409,
      code: 'username_taken',
    });
    const client = makeServerClient({ serverSetup, rejectFinishWith: conflictError });

    const setupState = await startFirstOwnerSetup({
      serverClient: client,
      baseUrl: BASE_URL,
      serverDisplayName: SERVER_DISPLAY_NAME,
      passphrase: PASSPHRASE,
    });

    await expect(
      finishFirstOwnerSetup({
        db,
        serverClient: client,
        baseUrl: BASE_URL,
        setupState,
        username: USERNAME,
        passphrase: PASSPHRASE,
      }),
    ).rejects.toMatchObject({ code: 'conflict' });

    db.close();
  });
});
