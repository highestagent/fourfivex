# Intuite

One surface over NEAR. Every capability is a sentence: say what you want, see exactly what
will happen, sign.

```bash
pnpm dev
```

Then open http://localhost:3000.

## What is real and what is not

| Part | State |
| --- | --- |
| Prices | Live, from the NEAR Intents token list |
| Pay, get paid, change now | Priced by live **dry-run** quotes from NEAR Intents |
| Private payments | Priced at the open rate. Confidential quotes need a signed-in account |
| Change when a price is met | Example. The order API is not wired |
| Change every Friday | Example. Recurring orders need a scheduler that does not exist yet |
| Grow, borrow | Example rate and terms. Borrow uses the live bitcoin price |
| Ask privately | Demo. No model is connected |
| The account and its balances | Examples |
| Signing | Simulated. There are no keys, and nothing is ever sent |

`lib/oneclick.ts` is the only code that talks to NEAR Intents. It always sends `dry: true`,
so it can price an outcome but cannot move money.

## Where things live

- `lib/verbs.ts`: the grammar. Each verb defines its blanks and the outcome lines.
- `components/Surface.tsx`: the three places, Now, Standing and Said.
- `components/Composer.tsx`: say, see, sign.
- `components/stages.tsx`: the picture for each sentence, used by both the cards and the composer.
- `components/Dots.tsx`: money drawn as dots that fly between clusters.
- `docs/near-one-sentence.html`: the research and design direction this was built from.
