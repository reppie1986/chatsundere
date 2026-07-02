// SPDX-License-Identifier: AGPL-3.0-only
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

function devAllowedHosts(value: string | undefined): string[] | undefined {
  const hosts = value
    ?.split(',')
    .map((host) => host.trim())
    .filter(Boolean);
  return hosts && hosts.length > 0 ? hosts : undefined;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: '/admin/',
    plugins: [react(), tailwindcss()],
    server: {
      host: env.DEV_BIND_HOST ?? '127.0.0.1',
      allowedHosts: devAllowedHosts(env.DEV_ALLOWED_HOSTS),
      port: 5174,
      strictPort: true,
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      globals: true,
      include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    },
  };
});
