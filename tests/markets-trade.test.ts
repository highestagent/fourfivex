import { describe, expect, it } from 'vitest';
import { fillLimit } from '../lib/markets/trade';

describe('Hyperliquid order price protection', () => {
  it.each([
    [69_161, 5],
    [28_186.5, 4],
    [123_456, 3],
    [3.14159, 2],
    [0.000321, 0],
  ])('keeps both sides within the slippage limit at %s', (price, decimals) => {
    const buy = Number(fillLimit(price, true, decimals));
    const sell = Number(fillLimit(price, false, decimals));
    expect(buy).toBeGreaterThanOrEqual(price);
    expect(buy).toBeLessThanOrEqual(price * 1.005);
    expect(sell).toBeLessThanOrEqual(price);
    expect(sell).toBeGreaterThanOrEqual(price * 0.995);
  });
});

import { signL1Action, signUserSignedAction, type AbstractViemLocalAccount } from '@nktkas/hyperliquid/signing';
import { Withdraw3Types } from '@nktkas/hyperliquid/api/exchange';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hex } from '@scure/base';
import { tradeActions, tradeDigest, withdrawalRequest, type TradeAuthorization, type TradeAction } from '../lib/markets/authorization';
import { verifiedSignature } from '../lib/markets/signer';
import type { OrderQuote } from '../lib/markets/trade';

describe('NEAR signatures for Hyperliquid', () => {
  const key = new Uint8Array(32).fill(1);
  const address = `0x${hex.encode(keccak_256(secp256k1.getPublicKey(key, false).slice(1)).slice(-20))}` as const;
  const quote: OrderQuote = {
    market: { market: 'hyperliquid:perp:BTC', coin: 'BTC', dex: '', asset: 0, collateral: 'USDC', mark: 70_000, decimals: 5, maxLeverage: 40 },
    closing: false, buy: true, leverage: 2, margin: 50, size: '0.00142', limit: '70350', value: 99.4, expires: 2_000,
  };
  const approval: TradeAuthorization = {
    contract: 'fourfivex.near', nonce: 'nonce', deadline: 2_000, exchangeNonce: 1_000, expiresAfter: 3_000,
    id: '0x0123456789abcdef0123456789abcdef', changeLeverage: true,
  };

  it('uses the exchange SDK typed data for isolated leverage and an IOC order', async () => {
    for (const request of tradeActions(quote, approval)) {
      const digest = tradeDigest(request);
      const signed = secp256k1.sign(digest, key, { prehash: false, format: 'recovered' });
      const sdk = await signL1Action({ ...request, wallet: {
        address,
        async signTypedData(data: Parameters<AbstractViemLocalAccount['signTypedData']>[0]): Promise<`0x${string}`> {
          expect(data.domain.chainId).toBe(1337);
          expect(data.message.source).toBe('a');
          return `0x${hex.encode(signed.slice(1))}${signed[0] === 0 ? '1b' : '1c'}`;
        },
      } });
      const value = { big_r: { affine_point: `0${2 + signed[0]}${hex.encode(signed.slice(1, 33))}` },
        s: { scalar: hex.encode(signed.slice(33)) }, recovery_id: signed[0] };
      expect(verifiedSignature(value, digest, address)).toEqual(sdk);
      expect(verifiedSignature(value, tradeDigest({ ...request, nonce: 2000 }), address)).toBeUndefined();
    }
    const close = tradeActions({ ...quote, closing: true }, { ...approval, changeLeverage: false });
    expect(close[0].action).toMatchObject({ orders: [{ r: true }] });
  });

  it('commits the withdrawal to the exact amount, recipient, and time', async () => {
    const request = withdrawalRequest({ destination: address, amount: '4.5', time: 2_000 });
    const action = request.action as Extract<TradeAction, { type: 'withdraw3' }>;
    const signature = secp256k1.sign(tradeDigest(request), key, { prehash: false, format: 'recovered' });
    const sdk = await signUserSignedAction({ action, types: Withdraw3Types, wallet: {
      address,
      async signTypedData(data: Parameters<AbstractViemLocalAccount['signTypedData']>[0]): Promise<`0x${string}`> {
        expect(data.primaryType).toBe('HyperliquidTransaction:Withdraw');
        expect(data.domain.chainId).toBe(42161);
        expect(data.message).toMatchObject({ destination: address, amount: '4.5', time: 2_000 });
        return `0x${hex.encode(signature.slice(1))}${signature[0] === 0 ? '1b' : '1c'}`;
      },
    } });
    expect(sdk.r).toBe(`0x${hex.encode(signature.slice(1, 33))}`);
    expect(tradeDigest(withdrawalRequest({ destination: address, amount: '4.6', time: 2_000 }))).not.toEqual(tradeDigest(request));
  });
});

import { UserSetAbstractionTypes } from '@nktkas/hyperliquid/api/exchange';
import { abstractionRequest, tradeIntents, tradePayload } from '../lib/markets/authorization';
import { fundsFrom } from '../lib/markets/trade';
import { busiestListings, settlesInUsdc, type Instrument } from '@fourfivex/markets-protocol/markets';

describe('One balance for every USDC market', () => {
  const key = new Uint8Array(32).fill(1);
  const address = `0x${hex.encode(keccak_256(secp256k1.getPublicKey(key, false).slice(1)).slice(-20))}` as const;
  const quote: OrderQuote = {
    market: { market: 'hyperliquid:perp:xyz:NVDA', coin: 'xyz:NVDA', dex: 'xyz', asset: 110_005, collateral: 'USDC', mark: 180, decimals: 3, maxLeverage: 10 },
    closing: false, buy: true, leverage: 3, margin: 20, size: '0.333', limit: '180.9', value: 60, expires: 2_000,
  };
  const approval: TradeAuthorization = {
    contract: 'fourfivex.near', nonce: 'nonce', deadline: 2_000, exchangeNonce: 1_000, expiresAfter: 3_000,
    id: '0x0123456789abcdef0123456789abcdef', changeLeverage: true, unify: address,
  };

  it('signs the switch exactly as EIP-712 defines it', async () => {
    // Expected digest computed independently with viem's hashTypedData.
    const request = abstractionRequest('0x8ba1f109551bd432803012645ac136ddd64dba72', 1_763_000_000_123);
    expect(`0x${hex.encode(tradeDigest(request))}`).toBe('0x4192ec0f69960c1cee026a041a9d87b091a58eda4cb5b143618e325c786fdd6f');

    const own = abstractionRequest(address, 1_000);
    const action = own.action as Extract<TradeAction, { type: 'userSetAbstraction' }>;
    expect(action).toMatchObject({ user: address, abstraction: 'unifiedAccount', hyperliquidChain: 'Mainnet', nonce: 1_000 });
    const signature = secp256k1.sign(tradeDigest(own), key, { prehash: false, format: 'recovered' });
    const sdk = await signUserSignedAction({ action, types: UserSetAbstractionTypes, wallet: {
      address,
      async signTypedData(data: Parameters<AbstractViemLocalAccount['signTypedData']>[0]): Promise<`0x${string}`> {
        expect(data.primaryType).toBe('HyperliquidTransaction:UserSetAbstraction');
        expect(data.domain.chainId).toBe(42161);
        return `0x${hex.encode(signature.slice(1))}${signature[0] === 0 ? '1b' : '1c'}`;
      },
    } });
    expect(sdk.r).toBe(`0x${hex.encode(signature.slice(1, 33))}`);
  });

  it('switches first, then sets leverage, then orders, each with its own nonce', () => {
    const requests = tradeActions(quote, approval);
    expect(requests.map(request => request.action.type)).toEqual(['userSetAbstraction', 'updateLeverage', 'order']);
    expect(requests.map(request => request.nonce)).toEqual([998, 999, 1_000]);
    expect(tradeActions(quote, { ...approval, changeLeverage: false }).map(request => request.action.type)).toEqual(['userSetAbstraction', 'order']);
    expect(tradeActions(quote, { ...approval, unify: undefined }).map(request => request.action.type)).toEqual(['updateLeverage', 'order']);
  });

  it('asks the signer for at most two digests per call, all in one approval', () => {
    const three = tradeIntents(tradeActions(quote, approval), approval.contract);
    expect(three.map(call => JSON.parse(call.msg).digests.length)).toEqual([1, 2]);
    expect(three.every(call => call.msg.length <= 512)).toBe(true);
    expect(tradeIntents(tradeActions(quote, { ...approval, changeLeverage: false }), approval.contract)).toHaveLength(1);
    const payload = JSON.parse(tradePayload('0x8ba1f109551bd432803012645ac136ddd64dba72', quote, approval));
    expect(payload.intents).toHaveLength(2);
  });

  it('reads one balance from spot USDC, as Hyperliquid reports unified accounts', () => {
    const perp = { marginSummary: { accountValue: '181.453578', totalNtlPos: '0', totalRawUsd: '0', totalMarginUsed: '181.453578' }, withdrawable: '0.0' };
    const usdc = (total: string, hold: string) => [{ coin: 'USDC', token: 0, total, hold, entryNtl: '0.0' }];
    // Figures from a live unified account holding an isolated BTC position.
    expect(fundsFrom('unifiedAccount', { balances: usdc('952.089541', '181.453578') }, perp)).toEqual({ shared: true, equity: 952.089541, withdrawable: 952.089541 - 181.453578 });
    expect(fundsFrom('portfolioMargin', { balances: usdc('6.5', '6.5') }, perp)).toEqual({ shared: true, equity: 6.5, withdrawable: 0 });
    expect(fundsFrom('unifiedAccount', { balances: [] }, perp)).toEqual({ shared: true, equity: 0, withdrawable: 0 });
    for (const mode of ['default', 'disabled']) {
      expect(fundsFrom(mode, { balances: usdc('500', '0') }, { ...perp, withdrawable: '12.5' })).toEqual({ shared: false, equity: 181.453578, withdrawable: 12.5 });
    }
  });

  it('offers perpetuals that settle in USDC, on any exchange', () => {
    const item = (id: string, collateral?: string) => ({ id, collateral }) as Instrument;
    expect(settlesInUsdc(item('hyperliquid:perp:BTC'))).toBe(true);
    expect(settlesInUsdc(item('hyperliquid:perp:xyz:NVDA', 'USDC'))).toBe(true);
    expect(settlesInUsdc(item('hyperliquid:perp:xyz:NVDA'))).toBe(false);
    expect(settlesInUsdc(item('hyperliquid:perp:flx:GOLD', 'USDH'))).toBe(false);
    expect(settlesInUsdc(item('hyperliquid:spot:@107', 'USDC'))).toBe(false);
  });
});

describe('busiestListings', () => {
  const perp = (id: string, symbol: string, category: Instrument['category'], volume?: number) =>
    ({ id, type: 'perp', symbol, quote: 'USD', category, volume }) as Instrument;
  const xyz = perp('hyperliquid:perp:xyz:AAPL', 'AAPL', 'equity', 9_000_000);
  const io = perp('hyperliquid:perp:io:AAPL', 'AAPL', 'equity', 40_000);
  const stacks = perp('hyperliquid:perp:STX', 'STX', 'crypto', 1_000);
  const seagate = perp('hyperliquid:perp:para:STX', 'STX', 'equity', 500);

  it('lists an asset once, on its busiest exchange, in catalog order', () => {
    expect(busiestListings([io, stacks, xyz, seagate])).toEqual([stacks, xyz, seagate]);
  });

  it('keeps the market already chosen, and the first listing when volume is unknown', () => {
    expect(busiestListings([io, xyz], io.id)).toEqual([io]);
    const first = perp('hyperliquid:perp:io:NVDA', 'NVDA', 'equity');
    expect(busiestListings([first, perp('hyperliquid:perp:xyz:NVDA', 'NVDA', 'equity')])).toEqual([first]);
  });
});
