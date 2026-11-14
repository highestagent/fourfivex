use near_sdk::serde::Deserialize;
use near_sdk::{AccountId, Gas, NearToken, Promise, env, near, require, serde_json};

#[near(contract_state)]
#[derive(Default)]
pub struct TradingSigner {}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct Request {
    digests: Vec<[u8; 32]>,
}

#[near]
impl TradingSigner {
    pub fn version(&self) -> u8 {
        1
    }

    pub fn on_auth(&self, signer_id: AccountId, msg: String) {
        require!(
            env::predecessor_account_id().as_str() == "intents.near",
            "Verifier required"
        );
        require!(
            signer_id
                .as_str()
                .strip_prefix("0x")
                .is_some_and(|key| key.len() == 40
                    && key
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())),
            "Invalid fourfivex account"
        );
        require!(msg.len() <= 512, "Invalid signing request");
        let Request { digests } = serde_json::from_str(&msg).expect("Invalid signing request");
        require!(
            (1..=2).contains(&digests.len()),
            "Expected one or two digests"
        );
        for digest in digests {
            let args = serde_json::json!({ "request": {
                "path": format!("intuite:hyperliquid:v1:{signer_id}"),
                "payload": digest,
                "key_version": 0
            } });
            Promise::new("v1.signer".parse().unwrap())
                .function_call(
                    "sign",
                    serde_json::to_vec(&args).unwrap(),
                    NearToken::from_yoctonear(1),
                    Gas::from_tgas(35),
                )
                .detach();
        }
    }
}
