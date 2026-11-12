# Wire the sentences so money can be sent

## Context

Accounts are real and passkey-only, but with an account open every sentence is read-only:
`components/Composer.tsx` takes a `real` prop and keeps signing off. This plan connects three
sentences to the open account so they move real money on NEAR Intents mainnet:

- **Add** money to the account (today's "get paid")
- **Change** one kind of money into another inside the account
- **Pay** an address on another network

Grow, borrow and ask stay as examples. They have no rail I could verify.

You chose: these three sentences, and **no send limit**. You asked for a cheaper model to do the
wiring, so the implementation is delegated and I review each step.

## What I confirmed today (read-only, no key)

A send from a passkey account is four calls to the 1Click API, and none needed an API key:

1. `POST /v0/quote` with `dry: false` and `depositType: "INTENTS"` returns a `depositAddress`
   (an account inside NEAR Intents), amounts, a deadline and a time estimate.
2. `POST /v0/generate-intent` `{type: "swap_transfer", standard: "webauthn", signerId, depositAddress}`
   returns the exact unsigned payload: one `transfer` intent moving the origin token to that
   deposit address.
3. The passkey signs it. Challenge = `sha256(payload)`, which the app already does
   (`challengeFor`, `signedIntent` in `lib/account/intents.ts`).
4. `POST /v0/submit-intent` `{type: "swap_transfer", signedData}` returns an `intentHash`.
   Then `GET /v0/status?depositAddress=` moves through
   `PENDING_DEPOSIT → PROCESSING → SUCCESS | REFUNDED | FAILED`.

Adding money needs no signature: a quote with `depositType: "ORIGIN_CHAIN"` and
`recipientType: "INTENTS"` gives a one-time address on the payer's network.

Not yet confirmed: that `submit-intent` accepts a request without a partner key (the spec lists a
key; quote, generate-intent and status all worked without one). Fallback is in "Risks".

## How each sentence works once wired

All three speak in dollars, as now. The amount blank becomes a typed number in both demo and real mode.

**Change** `Change [$50] of [my bitcoin] into [dollars].`
- `from`: only the kinds the account actually holds. `to`: dollars, bitcoin, ether, sol.
- `when` shows only "now" for real accounts. "Every Friday" and "when the price is…" stay demo-only.
- Quote: `EXACT_INPUT`, origin and destination both `INTENTS`, recipient and refund = the account.

**Pay** `Pay [Maya] [$40] from [my dollars].`
- `who`: saved people (kept on this device) plus "someone new", which asks for a name, a network
  and an address. They receive USDC on that network. Networks in this round: Base, Ethereum,
  Arbitrum, Solana, NEAR.
- "Privately" is hidden for real accounts: confidential quotes need a sign-in step we don't have yet.
- Quote: `EXACT_OUTPUT` so they get exactly the amount, origin `INTENTS`, recipient `DESTINATION_CHAIN`,
  refund to the account.

**Add** `Add [$120] to my account, paid with [ether on Ethereum].`
- Asks for the address the money is coming from, because a failed deposit is refunded there.
- Shows one address to send to, the exact amount, and the deadline. No passkey prompt.
- Sits under Standing as "Waiting for 0.0585 ether" until it arrives or expires.

## Safety rules (built in, not optional)

1. **The passkey signs only what was shown.** Before the passkey prompt, a pure function checks the
   payload from `generate-intent`: verifying contract is `intents.near`, signer is this account,
   exactly one intent, it is a `transfer`, the receiver is this quote's deposit address, exactly one
   token, it is the expected one, and the amount is no more than what the screen showed. Anything
   else is refused before signing.
2. **If the price moves, you are asked again.** The real quote is fetched when you hold to sign. If
   it is worse than the price on screen by more than 0.5%, signing stops, the new numbers are shown,
   and a second hold is required.
3. **Balance is checked first.** A send that the account cannot cover is blocked with a plain
   reason, and the server simulates every signed intent on the contract before submitting it.
4. **The server never holds a key** and only forwards what a passkey signed. `/api/send` accepts
   only a single `transfer` to the deposit address of a quote it just created.
5. **Nobody but you makes the first real send.** The implementing model and I verify with unit
   tests, the contract's read-only simulator and a software passkey with the submit call stubbed.
   No test calls `submit-intent` or sends funds.

## What gets built

Reused as is: `lib/account/intents.ts` (`challengeFor`, `signedIntent`), `lib/account/assertion.ts`
(`verifyAssertion`), `lib/account/passkey.ts` (`askPasskey`), `lib/account/chain.ts` (`simulate`),
`lib/account/store.ts` (device memory pattern), `components/Sheet.tsx`, `components/SignButton.tsx`,
`tests/virtual-authenticator.ts`.

| File | Change |
| --- | --- |
| `lib/oneclick.ts` | Add `realQuote`, `generateIntent`, `submitIntent`, `swapStatus`, and resolving "USDC on network X" from `getTokens()`. Dry quotes stay as they are. |
| `lib/send/types.ts` (new) | The three asks (`change`, `pay`, `add`), the prepared result, the receipt. |
| `lib/send/guard.ts` (new) | Rule 1 above, as a pure function. |
| `lib/send/address.ts` (new) | Address shape checks per network family. |
| `app/api/send/route.ts` (new) | `prepare`, `submit`, `status`. Validates every field, simulates before submitting. |
| `lib/account/holdings.ts` | Each part also carries `assetId`, `decimals` and the raw balance, so a send can name its source token. |
| `lib/account/flows.ts` | Extract `signPayload(accountId, payload)` from `signAndSend` so sends and key management share one signing path. |
| `lib/send/flow.ts` (new) | prepare → compare with shown price → guard → passkey → submit → poll. Reports steps for the sign button. |
| `lib/send/history.ts`, `lib/send/people.ts` (new) | What this account sent, and saved recipients, in local storage. Public data only. |
| `lib/verbs.ts` | Real-mode blanks and outcome rows for change, pay and add. `Ctx` gains `holdings` and `people`. |
| `components/Sentence.tsx` | A typed-amount blank, and an "add someone" form for a new recipient. |
| `components/Composer.tsx` | For a real account: real steps and statuses, the price-moved second hold, the deposit address panel for Add, a receipt with a link to the transaction. Signing stays off only for grow, borrow and ask. |
| `components/Surface.tsx` | Said lists real sends for a real account. Standing lists deposits being waited on. An empty account's "Right now" card offers Add. |
| `tests/` | `guard.test.ts`, `send-flow.test.ts`, `address.test.ts`, and read-only additions to `live.test.ts`. |

One stated limit for this round: a send draws from a single held token. If your dollars are split
across networks and no single one covers the amount, the sentence says so and offers the most it can use.

## Steps, each one commit

Delegated to **Sonnet** (cheaper than this model, and I would not trust money-moving code to Haiku).
One step per agent run, in order, because they share files. Each step ends with types, lint and
tests green and a commit with no attribution. I read every diff and re-run the checks before
starting the next step, and I do the final design pass and browser check myself.

0. Copy this plan to `docs/sending-plan.md` so each run can read it.
1. Server pipeline: `lib/oneclick.ts` additions, `lib/send/types.ts`, `guard.ts`, `address.ts`,
   `app/api/send/route.ts`, unit tests, and a live read-only test that prepares a real quote for a
   throwaway account, signs it with the software passkey, and expects the contract's simulator to
   refuse it for lack of funds (proving everything up to the balance check is right).
2. Client flow: `signPayload` extraction, `lib/send/flow.ts`, `history.ts`, `people.ts`, holdings
   fields, tests with a stubbed network.
3. Change, end to end: typed amount blank, real-mode blanks from holdings, composer states, Said.
4. Pay: people, the new-recipient form, networks.
5. Add: pay-in options, refund address, deposit panel, Standing.
6. README table and a first-send checklist.

## Verification

- `pnpm test`: guard accepts the payload shape 1Click returned today and rejects a wrong receiver,
  token, amount, signer, contract, or a second intent. Flow tests cover price-moved, a refused
  payload, a refund and a timeout.
- `pnpm test:live` (read-only): described in step 1. It never calls `submit-intent`.
- In the browser with the software passkey and `submit` stubbed: each sentence from blank to
  receipt, the price-moved second hold, an empty account, and an uncovered amount. Phone, tablet
  and desktop.
- `pnpm build`, lint, types.
- Then you, with real money: add a few dollars, change $1, pay $1 to an address you control. The
  README will list the steps and what each screen should say.

## Risks and what I need from you

- **`submit-intent` may want a partner key.** If it does, the fallback is to publish the same
  signed transfer through the relay the app already uses for passkeys (`lib/account/relay.ts`).
  If both refuse, you would need a free key from partners.near-intents.org in
  `NEAR_INTENTS_API_KEY`. A key also removes the extra 0.25% fee on unauthenticated quotes.
- **Terms.** Using the 1Click API means accepting NEAR Intents' terms of service. That is your call.
- **No limit, as you chose.** Rules 1 to 3 are the protection. I'd still make your first sends small.
- **Localhost.** Your current account's passkey only works at localhost. That is fine for testing
  with small amounts, and an account for real use should be made on the deployed site.
- **Design.** A cheaper model will follow the existing components, but I expect to polish the new
  blanks and the Add panel myself before calling it done.
