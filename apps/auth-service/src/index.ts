// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from './env.js';
import { createLogger } from './logger.js';
import { createServer } from './server.js';

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');
const app = createServer();

const server = Bun.serve({
  hostname: env.BIND_HOST,
  port: env.PORT,
  fetch: app.fetch,
});

logger.info({ hostname: env.BIND_HOST, port: server.port }, 'auth-service listening');
