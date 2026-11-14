# fourfivex

**Say what you want. See exactly what happens. Approve with a touch.**

fourfivex is a wallet and perpetuals trading app where every action is a sentence. No order tickets, no tabs of settings, no jargon. You fill in the blanks:

> Open a **long** on **BTC** using **$500** in margin at **5×** leverage.
>
> Pay **Sam** **$40** from **my dollars**.
>
> Change **$200** of **USDC** into **bitcoin**.

Before anything happens you see the result in plain words: what you get, what it costs, what it could lose. Then your passkey approves it. That's the whole interface.

On top of that, you trade with other people. Share a live chart in a room, follow a verified trader's fills as they land, and pay for a seat in their session, with the fee held on chain until the session is delivered.

**[fourfivex.xyz](https://fourfivex.xyz)**

---

## One account for everything

Your account is a passkey. Creating one takes a single touch, and there is no seed phrase to write down or lose. Add a backup passkey on another device, and sign in anywhere with one touch.

- **Add money.** Each account has lasting deposit addresses on Ethereum, Base, Arbitrum, Optimism, BNB Chain, Polygon, Avalanche, Solana, Bitcoin and Tron. Send any amount, any time, and it lands in your balance.
- **Pay someone.** Send dollars, ether, SOL or bitcoin to anyone, on the network they use. One approval can draw on balances across several networks at once.
- **Change currency.** Swap what you hold at a live price you see before you approve.
- **One view.** *Now* is what you have, *Standing* is everything in motion, *Said* is everything you've done. Link other wallets to track them alongside.

## Perpetuals in a sentence

Markets brings Hyperliquid's perpetuals into the same account: crypto, plus stocks, commodities, indices and FX, all backed by one USDC balance.

Choose a direction, a market, your margin and your leverage, all inside one sentence. The review shows the exact size, worst price and fee. Your passkey approves the order. Every account gets its own Hyperliquid address, and nobody holds its key.

## Rooms: trade together

Open a room on any market and invite people with single-use links.

- **One live chart.** The presenter drives it and everyone follows. Anyone can step away to explore and rejoin with a tap.
- **Shared analysis.** Price levels, trendlines, channels, Fibonacci retracements and long or short setups, drawn on the chart and kept in sync.
- **Trade ideas.** Entry, invalidation and target, with every revision kept.
- **Talk.** Comments pin to a price and time on the chart, live cursors show where people are looking, and voice is built in.

Rooms are private: owner, editors and viewers, and the owner can remove anyone at any time.

## Paid sessions: copy a trader, pay only for a session that's delivered

Good traders sell seats in a live session. Buyers see the trader's real fills as they happen.

**For hosts**
1. Prove the account you trade from with your passkey.
2. fourfivex reads your last 30 days on Hyperliquid: net P&L after fees and funding, number of trades, active days, and how much of the window the record covers. Profitable, active records qualify.
3. Set a seat price in USDC, a start time, a length and a number of seats, then share one link.

**For buyers**
1. Open the link to see the host's verified record, the price and the seats left.
2. One passkey touch pays from your USDC balance and opens the room. Your seat belongs to your account, so the same link opens it on any device you sign in on. A forwarded link opens nothing for anyone else.
3. Watch the host's fills arrive live. **Use this trade** turns one into your own sentence, with the same market and direction and your own size. It shows the host's fill next to the current price, and refuses fills more than 5 minutes old or prices that have moved more than 1%.

**Settlement, without trusting the host**

Seat fees go into an escrow contract, separate from anyone's trading money. The room records, minute by minute, whether the host was there and whether the room and feed were up.

- **Delivered:** after a 30-minute window for reporting problems, the host is paid automatically.
- **Host no-show, cancellation or a real outage:** every buyer is refunded automatically.
- **Removed from the room:** that buyer is refunded at once.
- **Last seat, late payments and duplicates:** a payment that can't buy a seat is refunded in the same transaction.

The host never touches the escrow. They can't certify their own delivery, keep a fee after removing someone, or pay themselves. If a fee is ever left unsettled, anyone can return it to the buyer after a deadline.

Payments and payouts are public, like any transfer on chain. The room itself stays private: its feed, comments, drawings and who joined from which device.

## How it's built

Each sentence becomes a signed instruction. Moving money settles on [NEAR Intents](https://near-intents.org), where solvers compete to fill it and the result is checked on chain. Trades go to Hyperliquid through an address that NEAR Chain Signatures derives for each account. Your passkey signs everything, and nothing on a server can sign for you.

| Part | What it does |
| --- | --- |
| `app/`, `components/`, `lib/` | The Next.js app: accounts, wallet, Markets, rooms and sessions |
| `services/markets` | Cloudflare Worker with Durable Objects: rooms, live sync, voice, sessions, settlement and the market catalog |
| `services/trading-signer` | Rust contract that signs Hyperliquid actions only when a passkey-approved request asks |
| `services/room-escrow` | Rust contract that holds seat fees and settles them by fixed rules |
| `packages/markets-protocol` | Shared types and rules for the app and the Worker |

## Run it locally

```sh
pnpm install
pnpm dev            # the app, on http://localhost:3000
pnpm dev:markets    # the Markets Worker, on http://127.0.0.1:8787
```

| Command | Runs |
| --- | --- |
| `pnpm test` | The app's tests |
| `pnpm test:markets` | The Worker's tests |
| `pnpm test:escrow` | The escrow against NEAR Intents' mainnet code on a local NEAR node (build the contract first) |
| `pnpm lint` | ESLint |
| `pnpm build` | A production build |

Each contract's README covers its build, hashes and accounts:
- [services/trading-signer](services/trading-signer/README.md)
- [services/room-escrow](services/room-escrow/README.md)
