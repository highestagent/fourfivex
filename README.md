# Intuite

One surface over NEAR. Every capability is a sentence: say what you want, see exactly what
will happen, sign.

```bash
pnpm dev
```

Then open http://localhost:3000.

## Markets

Open **Markets** from Now to browse live Hyperliquid spot and perpetual charts. The
default chart is BTC perpetual.
Private rooms use a browser session and support editor and viewer invites, shared chart
views, drawings, pinned comments, and trade ideas.

For local development, create the Worker secret once:

```bash
pnpm install
printf 'SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > services/markets/.dev.vars
```

Run `pnpm dev:markets` and `pnpm dev` in separate terminals. Use
`http://localhost:3000` for both browser sessions when testing invitations. Next.js
forwards `/api/markets/*` to the local Worker on port 8787. To test collaboration, create a
room in one browser profile and open its invite link in another.

The Worker in `services/markets` owns room sessions, SQLite Durable Objects, WebSockets,
and candle requests. `packages/markets-protocol` contains the market types and room
message schemas shared with Next.js. The Intuite Worker starts with new room storage.
Room access is tied to a 30-day browser session. The wallet passkey does not restore
room access if that session expires or the browser's cookies are cleared.
Rooms with a saved Kraken chart open on Hyperliquid BTC perpetual. Their old
chart annotations stay in storage and are hidden from the workspace.

For deployment, set `SESSION_SECRET` as a Worker secret and `APP_ORIGIN` to the exact
HTTPS origin of the Intuite site, without a trailing slash. Keep the session secret
stable across deploys so existing room members can reconnect. Deploy the Worker using
its Wrangler configuration.
Route `/api/markets/*` from the app's origin to the Worker, including WebSocket upgrades.
Set `MARKETS_WORKER_ORIGIN` before building Next.js when using its rewrite for this
route. The hosting proxy must forward WebSocket upgrades and preserve the browser's
`Origin` header.

## Accounts

An account is a passkey. There is no password, no seed phrase and no private key to copy
down, and the app never holds a key of any kind.

- **Creating a passkey creates the account.** NEAR Intents derives an account id from the
  passkey's public key, so nothing is sent anywhere and nothing is stored on a server.
- **Opening an account** on a device that has seen the passkey takes one touch. A new device
  works the public key out from the passkey's own signatures, then asks the contract whether
  that key belongs to the account. The founding passkey needs a second touch for this.
- **A backup passkey** is a second passkey attached to the same account by a signed
  `add_public_key` intent. Any attached passkey can remove another. The last one cannot be removed.
- **This device remembers** which passkeys it has seen and which account is open, in local
  storage. All of it is public information.

A passkey belongs to the site it was made on. One made at `localhost` only works at
`localhost`, yet the account it opens is a real mainnet account. That is fine for trying things
with small amounts. Make the account you intend to keep on the deployed site.

## Sending

With an account open, three sentences move real money on NEAR Intents mainnet:

- **Add** `Add $20 to my account, paid with dollars on Base.` Gives you one address, an exact
  amount and a deadline. Nothing is signed, because nothing leaves the account.
- **Change** `Change $10 of my bitcoin into dollars.` Stays inside the account.
- **Pay** `Pay Maya $40 from my dollars.` She receives exactly that, as USDC on her network.

A send is four calls to the 1Click API: a real quote, the payload to sign for it, the passkey's
signature submitted, and the status followed until it lands. These rules are built in:

1. **The passkey signs only what was shown.** `lib/send/guard.ts` refuses any payload that is not
   exactly one transfer of one kind of money, from this account, to this quote's address, for no
   more than the screen showed. It runs in the browser before the prompt and again on the server.
2. **If the price moves, you are asked again.** The real quote is fetched when you hold to sign.
   If it is more than 0.5% worse than what was on screen, signing stops and the new numbers are shown.
3. **Balance is checked first**, and the server runs every signed payload through the contract's
   own simulator before forwarding it.
4. **The server holds no key.** It forwards only what a passkey signed, and only for a quote it made.

There is no spending limit, only a sanity ceiling of $1,000,000 a sentence. A send draws from one holding at a time: if your
dollars sit on two networks, one sentence can use the larger of the two.

## Your first real sends

Nothing in this repo has moved real money. Everything up to the final submit was checked with
unit tests, the contract's read-only simulator and a software passkey. The first real send is
yours, so keep it small.

1. **Add about $5.** Open the account, then "Add money". Pick what you will pay with, type the
   amount and the address you are sending from, and tap "Get my address".
   - You should see one address, an exact amount, a line saying which asset and network and
     nothing else, and a deadline.
   - Send that amount from your other app. Within a minute or so Standing should stop waiting,
     Said should read "You added $5.00." and the balance should update.
   - Too little or too late and it is sent back to the address you gave.
2. **Change $1.** For example `Change $1 of my dollars into ether.`
   - Hold to sign. Your device asks for your fingerprint and names `localhost`.
   - The button walks through the final price, sending and delivering, then reads "Changed into ether".
   - Said lists it with a link to the transaction.
3. **Pay $1 to yourself.** Add yourself as "someone new" with an address you control on Base.
   - Before signing, check the row "Sent to" against your address.
   - Afterwards the address should hold exactly 1 USDC.

If something goes wrong:

- **"Did not go through"** means the money never left or has come back. Said shows which.
- **"The price moved"** is the second rule above doing its job. Read the new numbers and hold again, or don't.
- **A message about an API key** means the submit endpoint wants a partner key. Get a free one at
  partners.near-intents.org, put `NEAR_INTENTS_API_KEY=...` in `.env.local` and restart. A key
  also removes the extra 0.25% fee on quotes made without one.
- **"The network refused it"** with anything about a signature is a bug worth reporting.

## What is real and what is not

| Part | State |
| --- | --- |
| Accounts: create, open, sign out | Real. Passkeys only |
| Account balances | Real, read from the NEAR Intents contract |
| Add, change, pay | Real for an open account. Verified up to the final submit, which has not been run with real money |
| Backup passkeys: add and remove | Built. Signed payloads pass the live contract's simulator. The final hand-off to the relay has not been run against mainnet |
| Prices and preview quotes | Live. Preview quotes are dry runs |
| Private payments | Demo only. Confidential quotes need a sign-in step that is not built |
| Change when a price is met, change every Friday | Demo only. Recurring orders need a scheduler that does not exist yet |
| Grow, borrow | Examples, for demo and real accounts alike |
| Ask privately | Demo. No model is connected |
| The demo account (shown when no account is open) | Example balances, simulated signing |

Three places talk to the network:

- `lib/oneclick.ts` asks NEAR Intents for prices and quotes, and for a real send makes the quote,
  fetches the payload to sign and submits it once signed.
- `app/api/send/route.ts` is the only door to those real calls. It accepts three kinds of
  request, validates every field, and forwards a signed payload only after `lib/send/server.ts`
  has matched it to its quote and simulated it.
- `app/api/chain/route.ts` reads the verifier contract, and forwards one other kind of signed
  payload to the relay: adding or removing a passkey.

## Tests

```bash
pnpm test        # unit tests, including vectors from the verifier contract's own source
pnpm test:live   # read-only checks against the live contract on mainnet
pnpm test:markets
pnpm --filter @intuite/markets-worker typecheck
pnpm --filter @intuite/markets-worker build
```

The tests use a software stand-in for a passkey (`tests/virtual-authenticator.ts`) so the
signing path can run without a fingerprint. It exists only in tests.

## Where things live

- `lib/account/`: the account. `keys.ts` (public keys and account ids), `assertion.ts`
  (checking a passkey's signature), `session.ts` (which account a passkey opens),
  `intents.ts` (what a passkey signs), `flows.ts` (create, open, add, remove).
- `lib/send/`: real sends. `guard.ts` (what a passkey may sign), `server.ts` (prepare, submit,
  status), `flow.ts` (the ordered checks in the browser), `useSend.ts` (the composer's engine),
  `history.ts` and `people.ts` (what this device remembers), `payin.ts` (what money can be added with).
- `lib/verbs.ts`: the grammar. Each verb defines its blanks and the outcome lines, and a `real`
  variant when it is connected to real accounts.
- `components/Surface.tsx`: the three places, Now, Standing and Said.
- `components/AccountSheet.tsx`: opening and managing an account.
- `components/Composer.tsx`: say, see, sign.
- `components/stages.tsx`: the picture for each sentence, used by both the cards and the composer.
- `docs/near-one-sentence.html`: the research and design direction this was built from.
- `docs/sending-plan.md`: the plan the sending work followed.
