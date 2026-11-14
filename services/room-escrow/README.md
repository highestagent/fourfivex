# fourfivex room escrow

Holds paid room fees inside NEAR Intents (`intents.near`) until a session is settled. Room fees never mix with trading collateral, which lives on each account's Hyperliquid address.

## How money moves

1. **Pay.** The buyer's passkey signs one `transfer` intent to this contract, with `msg` set to `{"session":"<room id>"}`. The verifier moves the fee here, then calls `mt_on_transfer`.
2. **Seat or refund.** If the payment buys a seat, the contract keeps the fee and records the seat for the payer's account. If it doesn't, the contract hands the whole amount back and the verifier refunds the payer in the same transaction. That covers a sold-out session, including the last seat, a late payment, a duplicate, a canceled session, the wrong amount or token, and the host paying their own session.
3. **Settle.** After that, a fee can only go to one of two places:
   - **To the host:** `release`, called by the settler once `release_after` has passed (the session's end plus its exception window).
   - **Back to the payer:** `refund`, called by the settler at any time.

   A payout or refund that fails leaves the seat `paid`, so it can be retried.
4. **Backstop.** If the service never settles a seat, anyone can call `claim_refund` once `refund_after` passes. The fee still goes only to its payer.

The host never calls the contract, so a host can't release their own payout. The settler is the markets service's key, and the service settles by rules it applies itself, not by anything the host reports.

Everything on chain is the payment itself: the session id, its host account, price, seats and schedule, and who paid. Room content, the live trade feed, comments and who joined from which device stay in the markets service.

## Build

Build in the same pinned image as the trading signer:

```sh
docker run --rm --platform linux/amd64 \
  -v "$PWD/services/room-escrow":/host -w /host \
  sourcescan/cargo-near@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234 \
  cargo near build non-reproducible-wasm --locked
```

The output is `services/room-escrow/target/near/fourfivex_room_escrow.wasm`, 191,136 bytes.

| Form | Value |
| --- | --- |
| Code hash (base58, what NEAR's RPC reports) | `GRmoSn3vnjwnngHqAtdbaJptr789Hn5EsbXGw1uunN5L` |
| SHA-256 hex | `e537e652c86dd04bc3121bf4f8ee3f74e4825a9b504c934e532b24d68be9f3b7` |

## Test

- `cargo test` (in this folder) runs the contract's unit tests.
- `pnpm test:escrow` (from the repo root) needs the Wasm built first. It starts a local NEAR node and deploys three contracts:
  - the exact verifier code deployed at `intents.near` on mainnet, fetched by its code hash and cached in `target/sandbox`;
  - `wrap.near`'s code as the token;
  - this contract.

  Buyers are passkey accounts that sign payments the way the app does, and the settler signs with the markets service's own NEAR client. NEAR Intents has no testnet deployment, so this is the closest test to mainnet that moves no real money.

## Deploy

Not deployed yet. On mainnet it would be:

| Account | Role |
| --- | --- |
| `room-escrow.fourfivex.near` | Runs this contract. Delete its keys after checking the code hash, like the trading signer |
| `room-settler.fourfivex.near` | The markets service signs `open_session`, `cancel_session`, `release` and `refund` as this account, with a function-call key limited to those methods on the escrow |

Initialize it with:

```json
{
  "verifier": "intents.near",
  "token": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "settler": "room-settler.fourfivex.near",
  "refund_margin_ms": 86400000
}
```

`refund_margin_ms` is the least time between a host becoming payable and anyone being able to refund instead. On mainnet it is a day. The sandbox test uses a few seconds.

The escrow account needs a little NEAR for storage, about 0.002 NEAR per seat.
