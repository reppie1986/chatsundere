// SPDX-License-Identifier: AGPL-3.0-only

// Test-mode env defaults. Real tests that need a DB override these.
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'silent';
process.env.PORT ??= '0';
process.env.API_BASE_URL ??= 'http://localhost:3100/auth';
process.env.DATABASE_URL ??= 'postgres://chatsundere:dev@localhost:5432/auth_test_db';
process.env.REDIS_URL ??= 'redis://localhost:6379/15';
process.env.AUTH_JWT_PRIVATE_KEY ??= Buffer.from(new Uint8Array(32).fill(7)).toString('base64url');
process.env.OPAQUE_SERVER_SETUP ??=
  'U0bpDqtnQPKfhNWwjsKLqRR-GTKMVUnpJbdWnjb6DzZR8VY1dEv3SnAqMYkSY9SyURygr_eYvEeHetctIpo16axI247CKfMlGf0NrPW5T1aI0FaqYsT_iB4NfjTk28UO-oZpF5FPNg-nbQYi7joS-0eekqS9bsLpnaPzjMmElw8';
process.env.INVITATION_HMAC_KEY ??= Buffer.from(new Uint8Array(32).fill(11)).toString('base64url');
process.env.REFRESH_TOKEN_HMAC_KEY ??= Buffer.from(new Uint8Array(32).fill(13)).toString(
  'base64url',
);
process.env.HMAC_KEY_PENDING_CODES ??= Buffer.from(new Uint8Array(32).fill(17)).toString(
  'base64url',
);
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
