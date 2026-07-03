// SPDX-License-Identifier: AGPL-3.0-only

import { server as opaqueServer } from '@serenity-kit/opaque';
import { count, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { object, parse, pipe, regex, string } from 'valibot';
import { writeAudit } from '../audit/log.js';
import { createDb } from '../db/client.js';
import { authMethods, serverProfile, users } from '../db/schema.js';
import { issueTokens, refreshCookieFor } from '../jwt/issue.js';
import { ApiError } from '../middleware/error-envelope.js';
import { ipKey, rateLimit } from '../middleware/rate-limit.js';
import {
  ensureOpaqueReady,
  fetchOpaqueState,
  generateSessionId,
  getServerSetup,
  storeOpaqueState,
} from '../opaque/server.js';

const USERNAME_RE = /^[a-z][a-z0-9_-]{2,31}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'me', 'you']);

const statusProfileId = 'default';
const setupRateLimit = rateLimit({
  bucket: 'setup_owner',
  windowSec: 60,
  max: 10,
  key: (c) => ipKey(c),
});

const ownerStartReq = object({
  server_display_name: pipe(string(), regex(/^.{1,80}$/, 'Invalid server display name')),
  registration_request: string(),
});

const ownerFinishReq = object({
  session_id: string(),
  username: pipe(string(), regex(USERNAME_RE, 'Invalid username')),
  registration_record: string(),
  wrapped_mk_opaque: string(),
  wrap_nonce_opaque: string(),
  wrap_aad_opaque: string(),
  wrapped_mk_recovery: string(),
  wrap_nonce_recovery: string(),
  wrap_aad_recovery: string(),
  recovery_verifier_key: string(),
});

export function registerSetupRoutes(app: Hono): void {
  app.get('/api/v1/setup/status', async (c) => {
    const state = await readSetupState();
    return c.json({
      owner_exists: state.ownerExists,
      setup_available: state.setupAvailable,
      server_display_name: state.displayName,
    });
  });

  app.post('/api/v1/setup/owner/start', setupRateLimit, async (c) => {
    await ensureOpaqueReady();
    const state = await readSetupState();
    if (!state.setupAvailable) {
      throw new ApiError(409, 'setup_unavailable', 'Server owner already exists');
    }

    const body = parse(ownerStartReq, await c.req.json());
    const sessionId = generateSessionId();
    const opaqueUserIdentifier = `setup-owner:${sessionId}`;
    const { registrationResponse } = opaqueServer.createRegistrationResponse({
      serverSetup: getServerSetup(),
      userIdentifier: opaqueUserIdentifier,
      registrationRequest: body.registration_request,
    });

    await storeOpaqueState({
      scope: 'setup-owner',
      sessionId,
      payload: {
        server_display_name: body.server_display_name.trim(),
        opaque_user_identifier: opaqueUserIdentifier,
      },
    });

    return c.json({
      session_id: sessionId,
      registration_response: registrationResponse,
    });
  });

  app.post('/api/v1/setup/owner/finish', setupRateLimit, async (c) => {
    await ensureOpaqueReady();
    const body = parse(ownerFinishReq, await c.req.json());
    if (RESERVED.has(body.username)) {
      throw new ApiError(400, 'invalid_input', 'Username is reserved');
    }

    const state = await fetchOpaqueState('setup-owner', body.session_id);
    if (!state) throw new ApiError(410, 'session_expired', 'Session expired or not found');
    const displayName = state.server_display_name;
    const opaqueUserIdentifier = state.opaque_user_identifier;
    if (!displayName || !opaqueUserIdentifier) {
      throw new ApiError(410, 'session_expired', 'Session state is incomplete');
    }

    const current = await readSetupState();
    if (!current.setupAvailable) {
      throw new ApiError(409, 'setup_unavailable', 'Server owner already exists');
    }

    const { db } = createDb();
    try {
      const result = await db.transaction(async (tx) => {
        await tx
          .insert(serverProfile)
          .values({
            id: statusProfileId,
            displayName,
          })
          .onConflictDoUpdate({
            target: serverProfile.id,
            set: { displayName, updatedAt: new Date() },
          });

        const insertedUsers = await tx
          .insert(users)
          .values({
            username: body.username,
            role: 'primary_admin',
            recoveryVerifierKey: Buffer.from(body.recovery_verifier_key, 'base64url'),
            wrappedMkRecovery: Buffer.from(body.wrapped_mk_recovery, 'base64url'),
            wrapNonceRecovery: Buffer.from(body.wrap_nonce_recovery, 'base64url'),
            wrapAadRecovery: Buffer.from(body.wrap_aad_recovery, 'base64url'),
          })
          .returning({ id: users.id, role: users.role });
        const user = insertedUsers[0];
        if (!user) throw new Error('User insert returned no row');

        await tx.insert(authMethods).values({
          userId: user.id,
          methodType: 'opaque',
          opaqueCredential: Buffer.from(body.registration_record, 'base64url'),
          opaqueUserIdentifier,
          opaqueClientIdentifier: body.username,
          wrappedMasterKey: Buffer.from(body.wrapped_mk_opaque, 'base64url'),
          wrapNonce: Buffer.from(body.wrap_nonce_opaque, 'base64url'),
          wrapAad: Buffer.from(body.wrap_aad_opaque, 'base64url'),
        });

        return user;
      });

      const tokens = await issueTokens({
        userId: result.id,
        role: result.role,
        userAgent: c.req.header('User-Agent') ?? undefined,
      });

      await writeAudit({
        db,
        eventType: 'user.linked',
        userId: result.id,
        metadata: { role: result.role, setup: true },
      });

      c.header('Set-Cookie', refreshCookieFor(tokens.refreshToken));
      return c.json({
        user_id: result.id,
        username: body.username,
        role: result.role,
        access_token: tokens.accessToken,
        expires_in: tokens.expiresIn,
        is_new_account: true as const,
      });
    } catch (err) {
      if (err instanceof Error && /unique/i.test(err.message)) {
        throw new ApiError(409, 'username_taken', 'Username already exists');
      }
      throw err;
    }
  });
}

async function readSetupState(): Promise<{
  ownerExists: boolean;
  setupAvailable: boolean;
  displayName: string | null;
}> {
  const { db } = createDb();
  const [ownerCount, userCount, methodCount, profileRows] = await Promise.all([
    db.select({ value: count() }).from(users).where(eq(users.role, 'primary_admin')),
    db.select({ value: count() }).from(users),
    db.select({ value: count() }).from(authMethods),
    db.select().from(serverProfile).where(eq(serverProfile.id, statusProfileId)).limit(1),
  ]);
  const usersTotal = userCount[0]?.value ?? 0;
  const methodsTotal = methodCount[0]?.value ?? 0;
  return {
    ownerExists: (ownerCount[0]?.value ?? 0) > 0,
    setupAvailable: usersTotal === 0 && methodsTotal === 0,
    displayName: profileRows[0]?.displayName ?? null,
  };
}
