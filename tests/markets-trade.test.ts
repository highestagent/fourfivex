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
