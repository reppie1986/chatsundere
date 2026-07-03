// SPDX-License-Identifier: LGPL-3.0-only

import type { OwnerSetupFinishResponse } from '@chatsundere/shared-types';
import { deriveLocalAmk, deriveOpaqueAmk, deriveRecoveryAmk } from '../amk.js';
import { putLocalAndLinkedAccount } from '../db/account-pair.js';
import type { LinkedAccountRow, LocalAccountRow } from '../db/schema.js';
import { toBase64Url } from '../encoding/base64url.js';
import { encodeRecoveryKey } from '../encoding/recovery-key.js';
import { CryptoError } from '../errors.js';
import { opaqueRegistrationFinish, opaqueRegistrationStart } from '../opaque/client.js';
import { makeLocalAccountAad } from '../primitives/aad.js';
import { aeadEncrypt } from '../primitives/aead.js';
import { addIntegrityHmac, deriveIntegrityKey } from '../primitives/integrity.js';
import { getRandomBytes } from '../primitives/random.js';
import { deriveVerifierKey } from '../recovery.js';
import type { ServerClient } from '../server-client.js';
import { type MasterKeySession, createMasterKeySession } from '../session.js';
import { ARGON2ID_PARAMS, type MasterKey, asMasterKey, asRecoveryKey } from '../types.js';
import { validateUsername } from './create-local-account.js';
import { serverIdentityForBaseUrl } from './server-identity.js';

export interface StartFirstOwnerSetupArgs {
  serverClient: ServerClient;
  baseUrl: string;
  serverDisplayName: string;
  passphrase: string;
}

export interface FirstOwnerSetupState {
  sessionId: string;
  serverDisplayName: string;
  registrationResponse: string;
  clientRegistrationState: unknown;
}

export interface FinishFirstOwnerSetupArgs {
  db: IDBDatabase;
  serverClient: ServerClient;
  baseUrl: string;
  setupState: FirstOwnerSetupState;
  username: string;
  passphrase: string;
}

export interface FinishFirstOwnerSetupResult {
  session: MasterKeySession;
  mk: MasterKey;
  recoveryKeyString: string;
}

/** Begin first-owner setup with an OPAQUE registration request. */
export async function startFirstOwnerSetup(
  args: StartFirstOwnerSetupArgs,
): Promise<FirstOwnerSetupState> {
  const { clientRegistrationState, registrationRequest } = await opaqueRegistrationStart(
    args.passphrase,
  );
  if (!args.serverClient.ownerSetupStart) {
    throw new CryptoError('invalid_input', 'server client does not support owner setup');
  }

  const response = await args.serverClient.ownerSetupStart(
    {
      server_display_name: args.serverDisplayName,
      registration_request: registrationRequest,
    },
    args.baseUrl,
  );

  return {
    sessionId: response.session_id,
    serverDisplayName: args.serverDisplayName,
    registrationResponse: response.registration_response,
    clientRegistrationState,
  };
}

/** Complete first-owner setup, persist local+linked account rows, and open a session. */
export async function finishFirstOwnerSetup(
  args: FinishFirstOwnerSetupArgs,
): Promise<FinishFirstOwnerSetupResult> {
  const serverId = serverIdentityForBaseUrl(args.baseUrl);
  const username = args.username.trim().toLowerCase();
  validateUsername(username);

  const mk = asMasterKey(getRandomBytes(32));
  const recoveryKey = asRecoveryKey(getRandomBytes(32));
  const localSalt = getRandomBytes(ARGON2ID_PARAMS.saltLength);

  const localAmk = await deriveLocalAmk(args.passphrase, localSalt);
  const recoveryAmk = await deriveRecoveryAmk(recoveryKey);

  const localAad = makeLocalAccountAad(username, 'local');
  const recoveryAad = makeLocalAccountAad(username, 'recovery');

  const wrappedLocal = await aeadEncrypt(localAmk, mk, localAad);
  const wrappedRecovery = await aeadEncrypt(recoveryAmk, mk, recoveryAad);

  const localTagged = await addIntegrityHmac(wrappedLocal, await deriveIntegrityKey(localAmk));
  const recoveryTagged = await addIntegrityHmac(
    wrappedRecovery,
    await deriveIntegrityKey(recoveryAmk),
  );
  const verifierKey = await deriveVerifierKey(recoveryKey);

  const { registrationRecord, exportKey } = await opaqueRegistrationFinish({
    clientRegistrationState: args.setupState.clientRegistrationState as string,
    registrationResponse: args.setupState.registrationResponse,
    passphrase: args.passphrase,
    username,
    serverIdentity: serverId,
  });

  const opaqueAmk = await deriveOpaqueAmk(exportKey);
  const opaqueAad = makeLocalAccountAad(username, 'opaque');
  const wrappedOpaque = await aeadEncrypt(opaqueAmk, mk, opaqueAad);
  const opaqueTagged = await addIntegrityHmac(wrappedOpaque, await deriveIntegrityKey(opaqueAmk));

  if (!args.serverClient.ownerSetupFinish) {
    throw new CryptoError('invalid_input', 'server client does not support owner setup');
  }

  let finish: OwnerSetupFinishResponse;
  try {
    finish = await args.serverClient.ownerSetupFinish(
      {
        session_id: args.setupState.sessionId,
        username,
        registration_record: toBase64Url(registrationRecord),
        wrapped_mk_opaque: toBase64Url(opaqueTagged.ciphertext),
        wrap_nonce_opaque: toBase64Url(opaqueTagged.nonce),
        wrap_aad_opaque: toBase64Url(opaqueTagged.aad),
        wrapped_mk_recovery: toBase64Url(recoveryTagged.ciphertext),
        wrap_nonce_recovery: toBase64Url(recoveryTagged.nonce),
        wrap_aad_recovery: toBase64Url(recoveryTagged.aad),
        recovery_verifier_key: toBase64Url(verifierKey),
      },
      args.baseUrl,
    );
  } catch (err) {
    if (isConflictError(err)) {
      throw new CryptoError('conflict', 'username already registered on this server');
    }
    throw err;
  }

  if (finish.role !== 'primary_admin' || finish.username !== username) {
    throw new CryptoError('opaque_protocol_error', 'server returned inconsistent owner setup');
  }

  const localRow: LocalAccountRow = {
    schema_version: 1,
    username,
    local_salt: localSalt,
    wrapped_mk_local_ciphertext: localTagged.ciphertext,
    wrapped_mk_local_nonce: localTagged.nonce,
    wrapped_mk_local_aad: localTagged.aad,
    wrapped_mk_local_integrity: localTagged.integrity_hmac,
    wrapped_mk_recovery_ciphertext: recoveryTagged.ciphertext,
    wrapped_mk_recovery_nonce: recoveryTagged.nonce,
    wrapped_mk_recovery_aad: recoveryTagged.aad,
    wrapped_mk_recovery_integrity: recoveryTagged.integrity_hmac,
    recovery_verifier_key: verifierKey,
    created_at: new Date(),
  };

  const linkedRow: LinkedAccountRow = {
    server_user_id: finish.user_id,
    base_url: args.baseUrl,
    issuer_label: args.setupState.serverDisplayName,
    role: finish.role,
    wrapped_mk_opaque_ciphertext: opaqueTagged.ciphertext,
    wrapped_mk_opaque_nonce: opaqueTagged.nonce,
    wrapped_mk_opaque_aad: opaqueTagged.aad,
    wrapped_mk_opaque_integrity: opaqueTagged.integrity_hmac,
    linked_at: new Date(),
  };

  await putLocalAndLinkedAccount(args.db, localRow, linkedRow);

  const session = createMasterKeySession({
    mk,
    userId: finish.user_id,
    username: finish.username,
    mode: 'linked',
    online: true,
    role: finish.role,
    accessToken: finish.access_token,
    recoveryKey,
  });

  return { session, mk, recoveryKeyString: encodeRecoveryKey(recoveryKey) };
}

function isConflictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const e = err as Error & { status?: number; code?: string };
  return e.status === 409 && e.code === 'username_taken';
}
