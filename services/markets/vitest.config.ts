import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        APP_ORIGIN: 'https://fourfivex.test',
        NEAR_RPC_URL: 'https://near-rpc.test',
        SESSION_SECRET: 'unit-test-cookie-signing-key-not-for-deployment',
        CF_ACCOUNT_ID: 'test-account',
        REALTIME_APP_ID: 'test-app',
        REALTIME_API_TOKEN: 'test-token',
      },
    },
  })],
  test: { include: ['tests/**/*.test.ts'] },
});
