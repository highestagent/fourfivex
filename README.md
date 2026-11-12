# Intuite

One surface over NEAR. Every capability is a sentence: say what you want, see exactly what
will happen, sign.

```bash
pnpm dev
```

Then open http://localhost:3000.

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
`localhost`, yet the account it opens is a real mainnet account. Don't fund accounts made
during development.

## What is real and what is not

| Part | State |
| --- | --- |
| Accounts: create, open, sign out | Real. Passkeys only |
| Account balances | Real, read from the NEAR Intents contract |
| Backup passkeys: add and remove | Built. Signed intents pass the live contract's simulator. The final hand-off to the relay has not been run against mainnet |
| Prices | Live, from the NEAR Intents token list |
| Pay, get paid, change now | Priced by live **dry-run** quotes. Not yet connected to real accounts |
| Private payments | Priced at the open rate. Confidential quotes need a signed-in account |
| Change when a price is met | Example. The order API is not wired |
| Change every Friday | Example. Recurring orders need a scheduler that does not exist yet |
| Grow, borrow | Example rate and terms. Borrow uses the live bitcoin price |
| Ask privately | Demo. No model is connected |
| The demo account (shown when no account is open) | Example balances, simulated signing |

Two places talk to the network:

- `lib/oneclick.ts` asks NEAR Intents for prices and quotes. It always sends `dry: true`, so it
  can price an outcome but cannot move money.
- `app/api/chain/route.ts` reads the verifier contract, and forwards one kind of signed
  intent to the relay: adding or removing a passkey. It simulates first and refuses anything else.

## Tests

```bash
pnpm test        # unit tests, including vectors from the verifier contract's own source
pnpm test:live   # read-only checks against the live contract on mainnet
```

The tests use a software stand-in for a passkey (`tests/virtual-authenticator.ts`) so the
signing path can run without a fingerprint. It exists only in tests.

## Where things live

- `lib/account/`: the account. `keys.ts` (public keys and account ids), `assertion.ts`
  (checking a passkey's signature), `session.ts` (which account a passkey opens),
  `intents.ts` (what a passkey signs), `flows.ts` (create, open, add, remove).
- `lib/verbs.ts`: the grammar. Each verb defines its blanks and the outcome lines.
- `components/Surface.tsx`: the three places, Now, Standing and Said.
- `components/AccountSheet.tsx`: opening and managing an account.
- `components/Composer.tsx`: say, see, sign.
- `components/stages.tsx`: the picture for each sentence, used by both the cards and the composer.
- `docs/near-one-sentence.html`: the research and design direction this was built from.
