// SPDX-License-Identifier: AGPL-3.0-only
//
// Integration tests for first-owner server setup. Requires PostgreSQL and
// Redis; skipped in local type-only runs without service containers.

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { client as opaqueClient, ready as opaqueReady } from '@serenity-kit/opaque';
import { eq } from 'drizzle-orm';
import { closeDb, createDb } from '../../src/db/client.js';
import { authMethods, serverProfile, users } from '../../src/db/schema.js';
import { createServer } from '../../src/server.js';

const skip = !process.env.DATABASE_URL || !process.env.REDIS_URL;

describe.skipIf(skip)('Setup endpoints', () => {
  let app: ReturnType<typeof createServer>;
  const createdUserIds: string[] = [];
  const displayName = `Setup ${Date.now()}`;
  const username = `own${Date.now()}`.slice(0, 32);
  const password = 'first-owner-test-passphrase';

  beforeAll(async () => {
    await opaqueReady;
    app = createServer();
  });

  afterAll(async () => {
    const { db } = createDb();
    for (const id of createdUserIds) {
      await db.delete(authMethods).where(eq(authMethods.userId, id));
      await db.delete(users).where(eq(users.id, id));
    }
    await db.delete(serverProfile).where(eq(serverProfile.id, 'default'));
    await closeDb();
  });

  it('reports setup availability before and after first-owner creation', async () => {
    const statusBefore = await app.request('/api/v1/setup/status', {
      headers: { Origin: 'http://localhost:3000' },
    });
    expect(statusBefore.status).toBe(200);
    const beforeBody = (await statusBefore.json()) as {
      owner_exists: boolean;
      setup_available: boolean;
      server_display_name: string | null;
    };
    expect(beforeBody.owner_exists).toBe(false);
    expect(beforeBody.setup_available).toBe(true);

    const { clientRegistrationState, registrationRequest } = opaqueClient.startRegistration({
      password,
    });
    const startRes = await app.request('/api/v1/setup/owner/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        server_display_name: displayName,
        registration_request: registrationRequest,
      }),
    });
    expect(startRes.status).toBe(200);
    const startBody = (await startRes.json()) as {
      session_id: string;
      registration_response: string;
    };

    const { registrationRecord } = opaqueClient.finishRegistration({
      password,
      clientRegistrationState,
      registrationResponse: startBody.registration_response,
      identifiers: {
        client: username,
        server: `${process.env.API_BASE_URL ?? 'http://localhost:3100/auth'}/v1`,
      },
    });

    const zero32 = Buffer.alloc(32).toString('base64url');
    const finishRes = await app.request('/api/v1/setup/owner/finish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        session_id: startBody.session_id,
        username,
        registration_record: registrationRecord,
        wrapped_mk_opaque: zero32,
        wrap_nonce_opaque: zero32,
        wrap_aad_opaque: zero32,
        wrapped_mk_recovery: zero32,
        wrap_nonce_recovery: zero32,
        wrap_aad_recovery: zero32,
        recovery_verifier_key: zero32,
      }),
    });
    expect(finishRes.status).toBe(200);
    const finishBody = (await finishRes.json()) as {
      user_id: string;
      username: string;
      role: string;
      access_token: string;
      is_new_account: boolean;
    };
    createdUserIds.push(finishBody.user_id);
    expect(finishBody.username).toBe(username);
    expect(finishBody.role).toBe('primary_admin');
    expect(finishBody.access_token).toBeTruthy();
    expect(finishBody.is_new_account).toBe(true);

    const { db } = createDb();
    const ownerRows = await db.select().from(users).where(eq(users.id, finishBody.user_id));
    expect(ownerRows[0]?.role).toBe('primary_admin');
    const methodRows = await db
      .select()
      .from(authMethods)
      .where(eq(authMethods.userId, finishBody.user_id));
    expect(methodRows.length).toBe(1);
    expect(methodRows[0]?.methodType).toBe('opaque');

    const profileRows = await db
      .select()
      .from(serverProfile)
      .where(eq(serverProfile.id, 'default'));
    expect(profileRows[0]?.displayName).toBe(displayName);

    const statusAfter = await app.request('/api/v1/setup/status', {
      headers: { Origin: 'http://localhost:3000' },
    });
    const afterBody = (await statusAfter.json()) as {
      owner_exists: boolean;
      setup_available: boolean;
      server_display_name: string | null;
    };
    expect(afterBody.owner_exists).toBe(true);
    expect(afterBody.setup_available).toBe(false);
    expect(afterBody.server_display_name).toBe(displayName);
  });

  it('refuses first-owner start once setup is unavailable', async () => {
    const { registrationRequest } = opaqueClient.startRegistration({ password });
    const res = await app.request('/api/v1/setup/owner/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:3000' },
      body: JSON.stringify({
        server_display_name: displayName,
        registration_request: registrationRequest,
      }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('setup_unavailable');
  });

  it('rate-limits repeated first-owner start attempts', async () => {
    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const { registrationRequest } = opaqueClient.startRegistration({ password });
      const res = await app.request('/api/v1/setup/owner/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'http://localhost:3000',
          'X-Forwarded-For': '203.0.113.77',
        },
        body: JSON.stringify({
          server_display_name: displayName,
          registration_request: registrationRequest,
        }),
      });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
