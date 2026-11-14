# fourfivex trading signer

Gives every fourfivex account its own Hyperliquid address without anyone holding its key.

- The address comes from NEAR Chain Signatures. Its derivation path is `intuite:hyperliquid:v1:<account id>` under this contract's account, so each account gets its own address.
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
| Code hash (base58, what NEAR's RPC reports) | `CWJ6MsmF2hpHsYU9mzpV8u88q2EKJ4A32RdAJRZAong9` |
| SHA-256 hex (what NEAR CLI prints) | `aaf1b9e20a0d41e3abccd119171c6954d5331674977c4eebcef46abffc385672` |

If the source, `Cargo.lock` or the image changes, these change too.

## Deploy on mainnet

These steps use [NEAR CLI](https://github.com/near/near-cli-rs) (`npm install -g near-cli-rs`). If a flag differs in your version, run `near` with no arguments and it walks through the same choices. Replace `YOU.near` with an account you control.

1. **Create the signer account.** The name is permanent. Fund it with 1 NEAR: about 0.77 NEAR stays locked for the contract's storage, and every signature costs 1 yoctoNEAR from the rest.
   ```sh
   near account create-account fund-myself trading-signer.YOU.near '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as YOU.near network-config mainnet sign-with-keychain send
   ```
2. **Deploy the Wasm.**
   ```sh
   near contract deploy trading-signer.YOU.near use-file services/trading-signer/target/near/fourfivex_trading_signer.wasm without-init-call network-config mainnet sign-with-keychain send
   ```
3. **Check it before locking it.** `version` must return `1`, and the account summary must show the SHA-256 hex above.
   ```sh
   near contract call-function as-read-only trading-signer.YOU.near version json-args '{}' network-config mainnet now
   near account view-account-summary trading-signer.YOU.near network-config mainnet now
   ```
4. **Remove every key.** The app refuses a signer account that still has a key, so this step is required. After it, nobody can change the contract or move its NEAR.
   ```sh
   near account list-keys trading-signer.YOU.near network-config mainnet now
   near account delete-keys trading-signer.YOU.near public-keys ed25519:<each key> network-config mainnet sign-with-keychain send
   ```
5. **Set up the relayer.** This account pays NEAR gas for each trade, and it keeps its own full-access key in your keychain so you can top it up. Give the app a separate function-call key that can only call `execute_intents` on `intents.near`, with a spending cap. Each trade reserves about 0.025 NEAR of the cap (250 Tgas), so a cap of 1 NEAR covers about 40 trades before the key needs replacing.
   ```sh
   near account create-account fund-myself trading-relayer.YOU.near '2 NEAR' autogenerate-new-keypair save-to-keychain sign-as YOU.near network-config mainnet sign-with-keychain send
   near account add-key trading-relayer.YOU.near grant-function-call-access --allowance '1 NEAR' --contract-account-id intents.near --function-names execute_intents autogenerate-new-keypair print-to-terminal network-config mainnet sign-with-keychain send
   ```
   The private key it prints goes into Vercel only. Don't share it anywhere else.
6. **Set the Vercel variables** for Production, then redeploy.

   | Variable | Value |
   | --- | --- |
   | `TRADING_SIGNER_CONTRACT` | `trading-signer.YOU.near` |
   | `TRADING_SIGNER_CODE_HASH` | The code hash above |
   | `TRADING_RELAYER_ACCOUNT` | `trading-relayer.YOU.near` |
   | `TRADING_RELAYER_KEY` | The private key from step 5. Mark it Sensitive |
   | `TRADING_TICKET_SECRET` | Optional. At least 32 random characters. Without it, the app derives one from the relayer key |
   | `TRADING_NEAR_RPC_URL` | Optional mainnet RPC URL. Defaults to FastNEAR |
   | `TRADING_1CLICK_FUNDING` | Leave unset unless your 1Click agreement covers funding this derivatives integration. See [1Click terms, section 7.12](https://docs.agentsonintents.com/security-compliance/terms-of-service) |

7. **Test with tiny amounts.**
   - `/api/trades` with `op: "account"` should return `available: true` and an address.
   - Fund that address with the smallest deposit Hyperliquid accepts. The first signature happens only after money is there, so if signing fails, that deposit is stuck at an address nobody can sign for.
   - Open a small order and close it, then withdraw to an Arbitrum address you control.
   - Approve an order with a backup passkey on the same account and check that the trading address is the same.

The funding screen opens Relay with the trading address filled in, and it accepts USDC sent from an existing Hyperliquid account. Neither needs a fourfivex API credential. Users bring their own collateral and pay Hyperliquid fees from their trading balance.
