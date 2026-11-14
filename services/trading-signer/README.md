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

Everything runs under `fourfivex.near`, the operations account. It pays for and creates the other two, and later tops up the relayer. Its key is in this Mac's keychain (imported with `near account import-account using-seed-phrase`).

| Account | Role | Keys after setup |
| --- | --- | --- |
| `fourfivex.near` | Operations. Creates the other two, tops up the relayer | Its own full-access key |
| `trading-signer.fourfivex.near` | Runs this contract | None |
| `trading-relayer.fourfivex.near` | Pays gas for trades | A full-access key in the keychain, plus the capped key Vercel uses |

`fourfivex.near` needs about 3.1 NEAR first: 1 for the signer, 2 for the relayer, and a little for gas.

1. **Create the signer account** with 1 NEAR. About 0.77 NEAR stays locked for the contract's storage, and every signature costs 1 yoctoNEAR from the rest.
   ```sh
   near account create-account fund-myself trading-signer.fourfivex.near '1 NEAR' autogenerate-new-keypair save-to-keychain sign-as fourfivex.near network-config mainnet sign-with-keychain send
   ```
2. **Deploy the Wasm.**
   ```sh
   near contract deploy trading-signer.fourfivex.near use-file services/trading-signer/target/near/fourfivex_trading_signer.wasm without-init-call network-config mainnet sign-with-keychain send
   ```
3. **Check it before locking it.** `version` must return `1`, and the account summary must show the SHA-256 hex above.
   ```sh
   near contract call-function as-read-only trading-signer.fourfivex.near version json-args '{}' network-config mainnet now
   near account view-account-summary trading-signer.fourfivex.near network-config mainnet now
   ```
4. **Delete the signer's key.** The app refuses a signer account that still has a key, unless `TRADING_SIGNER_ALLOWED_KEY` names that key (see step 6). Deleting it cannot be undone: afterwards nobody can change the contract or move its NEAR.
   ```sh
   near account list-keys trading-signer.fourfivex.near network-config mainnet now
   near account delete-keys trading-signer.fourfivex.near public-keys <the key listed above> network-config mainnet sign-with-keychain send
   near account list-keys trading-signer.fourfivex.near network-config mainnet now
   ```
5. **Create the relayer** with 2 NEAR, then give it a capped key for the app. That key can only call `execute_intents` on `intents.near`. Each trade reserves about 0.025 NEAR of the cap (250 Tgas), so a cap of 1 NEAR covers about 40 trades before the key needs replacing. An account's first order also switches its Hyperliquid address to one balance for every USDC market. That adds a third digest, sent as a second `auth_call` in the same approval, and reserves 0.03 NEAR (300 Tgas).
   ```sh
   near account create-account fund-myself trading-relayer.fourfivex.near '2 NEAR' autogenerate-new-keypair save-to-keychain sign-as fourfivex.near network-config mainnet sign-with-keychain send
   near account add-key trading-relayer.fourfivex.near grant-function-call-access --allowance '1 NEAR' --contract-account-id intents.near --function-names execute_intents autogenerate-new-keypair save-to-legacy-keychain network-config mainnet sign-with-keychain send
   ```
   The second command prints where it saved the capped key's file. It never shows the key.
6. **Set the Vercel variables** for Production, then redeploy. The relayer key goes from its file straight into Vercel, without appearing on screen:
   ```sh
   python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["private_key"], end="")' <capped key file from step 5> \
     | vercel env add TRADING_RELAYER_KEY --environment production --sensitive --project fourfivex --scope mcxross
   ```

   | Variable | Value |
   | --- | --- |
   | `TRADING_SIGNER_CONTRACT` | `trading-signer.fourfivex.near` |
   | `TRADING_SIGNER_CODE_HASH` | `9wWUEB6gSnCnN593SSMrzfvsrNSmM4vzWos5UMA8AU1E` |
   | `TRADING_RELAYER_ACCOUNT` | `trading-relayer.fourfivex.near` |
   | `TRADING_RELAYER_KEY` | The capped key from step 5, Sensitive |
   | `TRADING_SIGNER_ALLOWED_KEY` | Temporary, for testing before step 4. The one public key the signer may still hold, such as `ed25519:…`. Any other key, or a second key, is still refused. While it is set, whoever holds that key can sign for every trading address. Unset it to require a locked signer again |
   | `TRADING_TICKET_SECRET` | Optional. At least 32 random characters. Without it, the app derives one from the relayer key |
   | `TRADING_NEAR_RPC_URL` | Optional mainnet RPC URL. Defaults to FastNEAR |
   | `TRADING_1CLICK_FUNDING` | Leave unset unless your 1Click agreement covers funding this derivatives integration. See [1Click terms, section 7.12](https://docs.agentsonintents.com/security-compliance/terms-of-service) |

7. **Test with tiny amounts.**
   - `/api/trades` with `op: "account"` should return `available: true` and an address.
   - Fund that address with at least 5 USDC; Hyperliquid doesn't credit smaller deposits. The first signature happens only after money is there, so if signing fails, that deposit is stuck at an address nobody can sign for.
   - Open a small order and close it, then withdraw to an Arbitrum address you control.
   - Approve an order with a backup passkey on the same account and check that the trading address is the same.

The funding screen opens Relay with the trading address filled in, and it accepts USDC sent from an existing Hyperliquid account. Neither needs a fourfivex API credential. Users bring their own collateral and pay Hyperliquid fees from their trading balance.
