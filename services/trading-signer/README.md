# fourfivex trading signer

Gives every fourfivex account its own Hyperliquid address without anyone holding its key.

- The address comes from NEAR Chain Signatures. Its derivation path is `fourfivex:hyperliquid:v1:<account id>` under this contract's account, so each account gets its own address.
- A trade or withdrawal is a passkey-signed `auth_call` intent. The NEAR Intents verifier (`intents.near`) checks the passkey, then calls `on_auth` here. This contract refuses any other caller and asks `v1.signer` to sign the one or two digests in the intent.
- Any passkey attached to the account can approve, and every passkey gets the same address.

Once its keys are removed, this contract can never change. Its account ID is part of every address, so a new contract means every user gets a new Hyperliquid address.

## Build

Build inside the same pinned `cargo-near` image that NEAR Intents uses for `intents.near`. near-sdk refuses a plain `cargo build`.

```sh
docker run --rm --platform linux/amd64 \
  -v "$PWD/services/trading-signer":/host -w /host \
  sourcescan/cargo-near@sha256:7467038bdddc86484b73b416eeadce926ff59013e128e53dec5a19e1cb4b2234 \
  cargo near build non-reproducible-wasm --locked
```

The output is `services/trading-signer/target/near/fourfivex_trading_signer.wasm`, 76,948 bytes. Two clean builds of this source give the same file. Its hashes:

| Form | Value |
| --- | --- |
| Code hash (base58, what NEAR's RPC reports) | `9wWUEB6gSnCnN593SSMrzfvsrNSmM4vzWos5UMA8AU1E` |
| SHA-256 hex (what NEAR CLI prints) | `84d42e27d8765e9b1859b07c80deadfe98eaad0eae6dabf45354f86edec38cd1` |

If the source, `Cargo.lock` or the image changes, these change too.

## Deploy on mainnet

These steps use [NEAR CLI](https://github.com/near/near-cli-rs) 0.31.1 (`npm install -g near-cli-rs`). Every command below was checked against its help.

The signer and relayer are plain (implicit) accounts. Each is the hex form of its own public key, so it needs no parent account: it comes into being when NEAR is first sent to it.

| Account | Role | Key file (owner-only) | Keys after setup |
| --- | --- | --- | --- |
| `28d180cb1023548794a934d7338885b75e8ebc312ee8ddcc434418840155298d` | Signer. Runs this contract | `~/.near-credentials/fourfivex/signer/<account>.json` | None |
| `4d264c9e407805c2fd84a14064c7b0130b0fcde138eb792a4bcea8edad79b47c` | Relayer. Pays gas for trades | `~/.near-credentials/fourfivex/relayer/<account>.json` | Its full-access key, plus the capped key Vercel uses |

Each key file holds a private key and a seed phrase. The signer's file is worthless once step 4 deletes its key. Keep a backup of the relayer's: it is the only way to top up the relayer or replace its capped key.

The keys were made with:
```sh
near account create-account fund-later use-auto-generation save-to-folder ~/.near-credentials/fourfivex/signer
near account create-account fund-later use-auto-generation save-to-folder ~/.near-credentials/fourfivex/relayer
```

The commands below use these shell variables:
```sh
SIGNER=28d180cb1023548794a934d7338885b75e8ebc312ee8ddcc434418840155298d
RELAYER=4d264c9e407805c2fd84a14064c7b0130b0fcde138eb792a4bcea8edad79b47c
SIGNER_KEY=~/.near-credentials/fourfivex/signer/$SIGNER.json
RELAYER_KEY=~/.near-credentials/fourfivex/relayer/$RELAYER.json
```

1. **Fund both accounts** from any wallet or exchange: 1 NEAR to the signer, 2 NEAR to the relayer. About 0.77 NEAR of the signer's stays locked for the contract's storage, and every signature costs 1 yoctoNEAR from the rest. Check that both arrived:
   ```sh
   near account view-account-summary $SIGNER network-config mainnet now
   near account view-account-summary $RELAYER network-config mainnet now
   ```
2. **Deploy the Wasm.**
   ```sh
   near contract deploy $SIGNER use-file services/trading-signer/target/near/fourfivex_trading_signer.wasm without-init-call network-config mainnet sign-with-access-key-file $SIGNER_KEY send
   ```
3. **Check it before locking it.** `version` must return `1`, and the account summary must show the SHA-256 hex above.
   ```sh
   near contract call-function as-read-only $SIGNER version json-args '{}' network-config mainnet now
   near account view-account-summary $SIGNER network-config mainnet now
   ```
4. **Delete the signer's key.** The app refuses a signer account that still has a key, so this step is required. It cannot be undone: afterwards nobody can change the contract or move its NEAR.
   ```sh
   near account delete-keys $SIGNER public-keys ed25519:3kLbRaUMAi8TvQkat4fRgopqEKC19iso2LutaDhb3B1v network-config mainnet sign-with-access-key-file $SIGNER_KEY send
   near account list-keys $SIGNER network-config mainnet now
   ```
5. **Give the relayer a capped key for the app.** It can only call `execute_intents` on `intents.near`. Each trade reserves about 0.025 NEAR of the cap (250 Tgas), so a cap of 1 NEAR covers about 40 trades before the key needs replacing.
   ```sh
   near account add-key $RELAYER grant-function-call-access --allowance '1 NEAR' --contract-account-id intents.near --function-names execute_intents autogenerate-new-keypair save-to-legacy-keychain network-config mainnet sign-with-access-key-file $RELAYER_KEY send
   ```
   The CLI prints where it saved the new key file. It never shows the key.
6. **Set the Vercel variables** for Production, then redeploy. The relayer key goes from its file straight into Vercel, without appearing on screen:
   ```sh
   python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["private_key"], end="")' <capped key file from step 5> \
     | vercel env add TRADING_RELAYER_KEY --environment production --sensitive --project fourfivex --scope mcxross
   ```

   | Variable | Value |
   | --- | --- |
   | `TRADING_SIGNER_CONTRACT` | `28d180cb1023548794a934d7338885b75e8ebc312ee8ddcc434418840155298d` |
   | `TRADING_SIGNER_CODE_HASH` | `9wWUEB6gSnCnN593SSMrzfvsrNSmM4vzWos5UMA8AU1E` |
   | `TRADING_RELAYER_ACCOUNT` | `4d264c9e407805c2fd84a14064c7b0130b0fcde138eb792a4bcea8edad79b47c` |
   | `TRADING_RELAYER_KEY` | The capped key from step 5, Sensitive |
   | `TRADING_TICKET_SECRET` | Optional. At least 32 random characters. Without it, the app derives one from the relayer key |
   | `TRADING_NEAR_RPC_URL` | Optional mainnet RPC URL. Defaults to FastNEAR |
   | `TRADING_1CLICK_FUNDING` | Leave unset unless your 1Click agreement covers funding this derivatives integration. See [1Click terms, section 7.12](https://docs.agentsonintents.com/security-compliance/terms-of-service) |

7. **Test with tiny amounts.**
   - `/api/trades` with `op: "account"` should return `available: true` and an address.
   - Fund that address with at least 5 USDC; Hyperliquid doesn't credit smaller deposits. The first signature happens only after money is there, so if signing fails, that deposit is stuck at an address nobody can sign for.
   - Open a small order and close it, then withdraw to an Arbitrum address you control.
   - Approve an order with a backup passkey on the same account and check that the trading address is the same.

The funding screen opens Relay with the trading address filled in, and it accepts USDC sent from an existing Hyperliquid account. Neither needs a fourfivex API credential. Users bring their own collateral and pay Hyperliquid fees from their trading balance.
