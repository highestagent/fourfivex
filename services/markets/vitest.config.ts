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
        // Paid sessions, against the fake NEAR and Hyperliquid in tests/fake-world.ts. The key is a throwaway made for these tests.
        TRADING_SIGNER_CONTRACT: 'trading-signer.fourfivex.near',
        HYPERLIQUID_API: 'https://hyperliquid.test',
        ROOM_ESCROW_CONTRACT: 'room-escrow.fourfivex.near',
        ROOM_ESCROW_TOKEN: 'nep141:usdc.test',
        ROOM_SETTLER_ACCOUNT: 'room-settler.fourfivex.near',
        ROOM_SETTLER_KEY: 'ed25519:2QdESJhe5Py71nKGgTz4nDtDSpr3ZxTUh9eCGAL3t7m7owTb3ocY1gt3zAa8Tta5VVXmtQybTrBqns1iQFy8RX7j',
      },
    },
  })],
  test: { include: ['tests/**/*.test.ts'] },
});
