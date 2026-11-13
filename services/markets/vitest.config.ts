import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        APP_ORIGIN: 'https://intuite.test',
        SESSION_SECRET: 'unit-test-cookie-signing-key-not-for-deployment',
      },
    },
  })],
  test: { include: ['tests/**/*.test.ts'] },
});
