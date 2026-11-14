# Intuite trading signer

The signer uses the existing Intuite account ID as part of a NEAR Chain Signatures derivation path. The NEAR Intents verifier checks the passkey against that account before calling the signer. Any attached passkey can approve the same account's trades and withdrawals.

Build the pinned contract using Rust 1.96 and the Wasm target.

```sh
RUSTFLAGS='--cfg near' cargo build --locked --release --target wasm32-unknown-unknown --manifest-path services/trading-signer/Cargo.toml
```

Before enabling trading, deploy the Wasm to a dedicated NEAR mainnet account. Confirm `version` returns 1. Remove every access key from the signer account after verifying the deployed code and choosing the permanent account ID. The account ID is part of the derivation. Changing it gives every customer a different Hyperliquid address.

Set these server variables for the Next.js app.

| Variable | Value |
| --- | --- |
| `TRADING_SIGNER_CONTRACT` | NEAR mainnet account running this contract |
| `TRADING_SIGNER_CODE_HASH` | Base58 SHA-256 hash of the exact deployed Wasm |
| `TRADING_RELAYER_ACCOUNT` | Funded mainnet account that pays NEAR gas |
| `TRADING_RELAYER_KEY` | Function-call access key restricted to `intents.near` and `execute_intents`, with a limited allowance |
| `TRADING_TICKET_SECRET` | Optional independent server secret with at least 32 characters. By default the app derives a separate key from the relayer credential. |
| `TRADING_NEAR_RPC_URL` | Optional mainnet RPC URL |
| `TRADING_1CLICK_FUNDING` | Set to `enabled` when your 1Click agreement covers funding this derivatives integration |

The relayer pays for NEAR signature requests. Users provide their own collateral and pay Hyperliquid fees from their trading balance. The signer contract requests a signature only after the verifier confirms a passkey approval. The app checks the deployed code hash and access-key list before providing a funding address.

The funding screen opens Relay with the trading address prefilled and supports USDC transfers from existing Hyperliquid accounts. Neither option requires an Intuite API credential. Direct 1Click transfers from the Intuite balance are optional and require coverage under your agreement. See [1Click terms, section 7.12](https://docs.agentsonintents.com/security-compliance/terms-of-service).

Verify the full deployment with a small mainnet funding transfer, a bounded order and close, and a withdrawal to Arbitrum. Repeat order authorization with a backup passkey on the same Intuite account and verify that the trading address matches.
