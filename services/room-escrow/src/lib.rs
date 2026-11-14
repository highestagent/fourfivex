//! Holds paid room fees inside the NEAR Intents verifier until a session is settled.
//!
//! A buyer pays with a passkey-signed `transfer` intent to this contract whose `msg` names the session.
//! The verifier then calls `mt_on_transfer` here. A payment that can't buy a seat (sold out, late, a
//! duplicate, a canceled session, the wrong amount or token) is handed back by returning its amount,
//! and the verifier refunds the payer in the same transaction. Nobody has to act for that refund.
//!
//! After that, money only moves two ways:
//! - to the session's host, by the settler, once the session and its exception window are over;
//! - back to the payer, by the settler at any time, or by anyone once the session's refund deadline passes
//!   without a payout.
//!
//! The host never calls this contract, so a host can't release their own payout. The settler can't send
//! a fee anywhere except to that session's host or back to its payer.

use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::store::LookupMap;
use near_sdk::{
    AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near,
    require, serde_json,
};

const DAY_MS: u64 = 24 * 60 * 60 * 1000;
/// The longest a fee can wait for its refund deadline after a session ends.
const MAX_REFUND_DELAY_MS: u64 = 30 * DAY_MS;
const MAX_SEATS: u16 = 50;
/// Refunds free seats, so a session can see more payers than seats. This bounds how many it remembers.
const MAX_PAYERS_PER_SEAT: usize = 4;
const TRANSFER_GAS: Gas = Gas::from_tgas(15);
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum Key {
    Sessions,
    Seats,
}

/// What the host offers, fixed when the session opens.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Terms {
    pub host: AccountId,
    /// The seat price, in the token's smallest unit.
    pub price: U128,
    pub seats: u16,
    /// Milliseconds since the epoch. Payments at or after this are refunded.
    pub booking_closes: u64,
    pub ends_at: u64,
    /// The earliest the host can be paid: the end of the session plus its exception window.
    pub release_after: u64,
    /// After this, anyone can refund a seat that was never paid out.
    pub refund_after: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Session {
    pub terms: Terms,
    /// Seats held: paid, or being paid out. A refund frees its seat.
    pub sold: u16,
    pub canceled: bool,
    /// Everyone who has held a seat, so the settler can settle every one of them.
    pub payers: Vec<AccountId>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SeatState {
    Paid,
    Releasing,
    Released,
    Refunding,
    Refunded,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Seat {
    pub amount: U128,
    pub state: SeatState,
    pub paid_at: u64,
}

#[near(serializers = [json])]
pub struct Config {
    pub verifier: AccountId,
    pub token: String,
    pub settler: AccountId,
    /// The least time between a host becoming payable and anyone being able to refund instead.
    pub refund_margin_ms: u64,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct Booking {
    session: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct RoomEscrow {
    verifier: AccountId,
    token: String,
    settler: AccountId,
    refund_margin_ms: u64,
    sessions: LookupMap<String, Session>,
    seats: LookupMap<String, Seat>,
}

fn valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn seat_key(session: &str, payer: &AccountId) -> String {
    format!("{session}/{payer}")
}

fn emit(event: &str, data: serde_json::Value) {
    let body = serde_json::json!({
        "standard": "fourfivex_room_escrow", "version": "1.0.0", "event": event, "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{body}"));
}

#[near]
impl RoomEscrow {
    #[init]
    pub fn new(verifier: AccountId, token: String, settler: AccountId, refund_margin_ms: u64) -> Self {
        require!(!token.is_empty() && token.len() <= 128, "Invalid token");
        require!(settler != verifier, "The settler can't be the verifier");
        require!(refund_margin_ms <= MAX_REFUND_DELAY_MS, "Invalid refund margin");
        Self {
            verifier,
            token,
            settler,
            refund_margin_ms,
            sessions: LookupMap::new(Key::Sessions),
            seats: LookupMap::new(Key::Seats),
        }
    }

    pub fn version(&self) -> u8 {
        1
    }

    pub fn config(&self) -> Config {
        Config {
            verifier: self.verifier.clone(),
            token: self.token.clone(),
            settler: self.settler.clone(),
            refund_margin_ms: self.refund_margin_ms,
        }
    }

    pub fn session(&self, id: String) -> Option<Session> {
        self.sessions.get(&id).cloned()
    }

    pub fn seat(&self, session: String, payer: AccountId) -> Option<Seat> {
        self.seats.get(&seat_key(&session, &payer)).cloned()
    }

    /// Every seat a session has had, with its payer.
    pub fn seats(&self, session: String) -> Vec<(AccountId, Seat)> {
        let Some(entry) = self.sessions.get(&session) else {
            return vec![];
        };
        entry
            .payers
            .iter()
            .filter_map(|payer| {
                self.seats
                    .get(&seat_key(&session, payer))
                    .map(|seat| (payer.clone(), seat.clone()))
            })
            .collect()
    }

    fn require_settler(&self) {
        require!(
            env::predecessor_account_id() == self.settler,
            "Only the settler can do this"
        );
    }

    /// Opens a session for booking. The service calls this after checking the host's record.
    pub fn open_session(&mut self, id: String, terms: Terms) {
        self.require_settler();
        require!(valid_id(&id), "Invalid session");
        require!(!self.sessions.contains_key(&id), "Session already exists");
        let now = env::block_timestamp_ms();
        let Terms {
            host,
            price,
            seats,
            booking_closes,
            ends_at,
            release_after,
            refund_after,
        } = &terms;
        require!(price.0 > 0, "Invalid price");
        require!((1..=MAX_SEATS).contains(seats), "Invalid seats");
        require!(
            now < *booking_closes && booking_closes <= ends_at && ends_at <= release_after,
            "Invalid schedule"
        );
        require!(
            *refund_after >= release_after + self.refund_margin_ms
                && *refund_after <= ends_at + MAX_REFUND_DELAY_MS,
            "Invalid refund deadline"
        );
        require!(
            *host != self.settler && *host != self.verifier && *host != env::current_account_id(),
            "Invalid host"
        );
        emit(
            "session_opened",
            serde_json::json!({ "session": id, "host": host, "price": price, "seats": seats }),
        );
        self.sessions.insert(
            id,
            Session {
                terms,
                sold: 0,
                canceled: false,
                payers: vec![],
            },
        );
    }

    /// Stops new bookings. Seats already paid are refunded one by one with `refund`.
    pub fn cancel_session(&mut self, id: String) {
        self.require_settler();
        let session = self.sessions.get_mut(&id).expect("Unknown session");
        if !session.canceled {
            session.canceled = true;
            emit("session_canceled", serde_json::json!({ "session": id }));
        }
    }

    /// Called by the verifier when a `transfer` intent with a `msg` reaches this account.
    /// Returns what the verifier should refund: nothing for a seat, everything otherwise.
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> PromiseOrValue<Vec<U128>> {
        require!(
            env::predecessor_account_id() == self.verifier,
            "Verifier required"
        );
        match self.book(&sender_id, &previous_owner_ids, &token_ids, &amounts, &msg) {
            Ok(session) => {
                emit(
                    "seat_paid",
                    serde_json::json!({ "session": session, "payer": sender_id, "amount": amounts[0] }),
                );
                PromiseOrValue::Value(vec![U128(0); amounts.len()])
            }
            Err(reason) => {
                emit(
                    "payment_refunded",
                    serde_json::json!({ "payer": sender_id, "reason": reason }),
                );
                PromiseOrValue::Value(amounts)
            }
        }
    }

    fn book(
        &mut self,
        sender_id: &AccountId,
        previous_owner_ids: &[AccountId],
        token_ids: &[String],
        amounts: &[U128],
        msg: &str,
    ) -> Result<String, &'static str> {
        if token_ids.len() != 1
            || amounts.len() != 1
            || previous_owner_ids.len() != 1
            || previous_owner_ids[0] != *sender_id
        {
            return Err("unsupported_transfer");
        }
        if token_ids[0] != self.token {
            return Err("wrong_token");
        }
        let id = (msg.len() <= 512)
            .then(|| serde_json::from_str::<Booking>(msg).ok())
            .flatten()
            .map(|booking| booking.session)
            .filter(|id| valid_id(id))
            .ok_or("invalid_message")?;
        let now = env::block_timestamp_ms();
        let session = self.sessions.get_mut(&id).ok_or("unknown_session")?;
        if session.canceled {
            return Err("canceled");
        }
        if now >= session.terms.booking_closes {
            return Err("booking_closed");
        }
        if *sender_id == session.terms.host {
            return Err("host");
        }
        if amounts[0] != session.terms.price {
            return Err("wrong_amount");
        }
        let key = seat_key(&id, sender_id);
        let previous = self.seats.get(&key);
        if previous.is_some_and(|seat| seat.state != SeatState::Refunded) {
            return Err("duplicate");
        }
        if session.sold >= session.terms.seats {
            return Err("sold_out");
        }
        if previous.is_none() {
            if session.payers.len() >= usize::from(session.terms.seats) * MAX_PAYERS_PER_SEAT {
                return Err("sold_out");
            }
            session.payers.push(sender_id.clone());
        }
        session.sold += 1;
        self.seats.insert(
            key,
            Seat {
                amount: amounts[0],
                state: SeatState::Paid,
                paid_at: now,
            },
        );
        Ok(id)
    }

    /// Pays a seat's fee to the host. Only the settler, and only once the exception window is over.
    pub fn release(&mut self, session: String, payer: AccountId) -> Promise {
        self.require_settler();
        let terms = {
            let entry = self.sessions.get(&session).expect("Unknown session");
            require!(!entry.canceled, "Session was canceled");
            require!(
                env::block_timestamp_ms() >= entry.terms.release_after,
                "Too early to pay the host"
            );
            entry.terms.clone()
        };
        self.settle(session, payer, terms.host, true)
    }

    /// Returns a seat's fee to its payer. The settler can do this at any time.
    pub fn refund(&mut self, session: String, payer: AccountId) -> Promise {
        self.require_settler();
        self.settle(session, payer.clone(), payer, false)
    }

    /// Anyone can return a fee to its payer once the refund deadline passes without a payout.
    pub fn claim_refund(&mut self, session: String, payer: AccountId) -> Promise {
        let entry = self.sessions.get(&session).expect("Unknown session");
        require!(
            env::block_timestamp_ms() >= entry.terms.refund_after,
            "The refund deadline hasn't passed"
        );
        self.settle(session, payer.clone(), payer, false)
    }

    fn settle(&mut self, session: String, payer: AccountId, receiver: AccountId, release: bool) -> Promise {
        let seat = self
            .seats
            .get_mut(&seat_key(&session, &payer))
            .expect("Unknown seat");
        require!(seat.state == SeatState::Paid, "This seat is already settled or settling");
        seat.state = if release {
            SeatState::Releasing
        } else {
            SeatState::Refunding
        };
        let amount = seat.amount;
        let args = serde_json::json!({
            "receiver_id": receiver, "token_id": self.token, "amount": amount,
            "memo": if release { "fourfivex room fee" } else { "fourfivex room refund" },
        });
        Promise::new(self.verifier.clone())
            .function_call(
                "mt_transfer",
                serde_json::to_vec(&args).unwrap(),
                NearToken::from_yoctonear(1),
                TRANSFER_GAS,
            )
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_settled(session, payer, release),
            )
    }

    /// Records how a payout or refund ended. A failed transfer puts the seat back to paid, so it can be retried.
    #[private]
    pub fn on_settled(&mut self, session: String, payer: AccountId, release: bool) -> bool {
        let done = env::promise_result_checked(0, 64).is_ok();
        let seat = self
            .seats
            .get_mut(&seat_key(&session, &payer))
            .expect("Unknown seat");
        seat.state = match (done, release) {
            (true, true) => SeatState::Released,
            (true, false) => SeatState::Refunded,
            (false, _) => SeatState::Paid,
        };
        let amount = seat.amount;
        if done && !release {
            let entry = self.sessions.get_mut(&session).expect("Unknown session");
            entry.sold = entry.sold.saturating_sub(1);
        }
        let event = match (done, release) {
            (true, true) => "seat_released",
            (true, false) => "seat_refunded",
            (false, _) => "settlement_failed",
        };
        emit(
            event,
            serde_json::json!({ "session": session, "payer": payer, "amount": amount }),
        );
        done
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::testing_env;

    const TOKEN: &str = "nep141:usdc.test";
    const START: u64 = 1_800_000_000_000;

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    fn at(predecessor: &str, now_ms: u64) {
        testing_env!(VMContextBuilder::new()
            .current_account_id(account("escrow.test"))
            .predecessor_account_id(account(predecessor))
            .block_timestamp(now_ms * 1_000_000)
            .build());
    }

    fn terms(seats: u16) -> Terms {
        Terms {
            host: account("host.test"),
            price: U128(25_000_000),
            seats,
            booking_closes: START + 60_000,
            ends_at: START + 3_600_000,
            release_after: START + 5_400_000,
            refund_after: START + 5_400_000 + DAY_MS,
        }
    }

    fn escrow(seats: u16) -> RoomEscrow {
        at("settler.test", START);
        let mut contract = RoomEscrow::new(account("intents.test"), TOKEN.into(), account("settler.test"), DAY_MS);
        contract.open_session("s1".into(), terms(seats));
        contract
    }

    fn pay(contract: &mut RoomEscrow, payer: &str, amount: u128, now: u64) -> u128 {
        at("intents.test", now);
        match contract.mt_on_transfer(
            account(payer),
            vec![account(payer)],
            vec![TOKEN.into()],
            vec![U128(amount)],
            r#"{"session":"s1"}"#.into(),
        ) {
            PromiseOrValue::Value(refund) => refund[0].0,
            PromiseOrValue::Promise(_) => panic!("expected a value"),
        }
    }

    #[test]
    fn sells_seats_and_refunds_everything_else() {
        let mut contract = escrow(1);
        assert_eq!(pay(&mut contract, "a.test", 25_000_000, START), 0);
        assert_eq!(pay(&mut contract, "a.test", 25_000_000, START), 25_000_000, "duplicate");
        assert_eq!(pay(&mut contract, "b.test", 25_000_000, START), 25_000_000, "sold out");
        assert_eq!(pay(&mut contract, "host.test", 25_000_000, START), 25_000_000, "host");
        let mut late = escrow(2);
        assert_eq!(pay(&mut late, "c.test", 25_000_000, START + 60_000), 25_000_000, "late");
        assert_eq!(pay(&mut late, "c.test", 24_000_000, START), 24_000_000, "wrong amount");
        assert_eq!(contract.seat("s1".into(), account("a.test")).unwrap().state, SeatState::Paid);
        let seats = contract.seats("s1".into());
        assert_eq!(seats.len(), 1);
        assert_eq!(seats[0].0, account("a.test"));
    }

    #[test]
    #[should_panic(expected = "Verifier required")]
    fn only_the_verifier_can_book() {
        let mut contract = escrow(1);
        at("a.test", START);
        let _ = contract.mt_on_transfer(
            account("a.test"),
            vec![account("a.test")],
            vec![TOKEN.into()],
            vec![U128(25_000_000)],
            r#"{"session":"s1"}"#.into(),
        );
    }

    #[test]
    #[should_panic(expected = "Only the settler can do this")]
    fn the_host_cant_release() {
        let mut contract = escrow(1);
        pay(&mut contract, "a.test", 25_000_000, START);
        at("host.test", START + 6_000_000);
        let _ = contract.release("s1".into(), account("a.test"));
    }

    #[test]
    #[should_panic(expected = "Too early to pay the host")]
    fn no_payout_before_the_exception_window_ends() {
        let mut contract = escrow(1);
        pay(&mut contract, "a.test", 25_000_000, START);
        at("settler.test", START + 3_600_000);
        let _ = contract.release("s1".into(), account("a.test"));
    }

    #[test]
    #[should_panic(expected = "The refund deadline hasn't passed")]
    fn anyone_refunds_only_after_the_deadline() {
        let mut contract = escrow(1);
        pay(&mut contract, "a.test", 25_000_000, START);
        at("stranger.test", START + 5_400_000);
        let _ = contract.claim_refund("s1".into(), account("a.test"));
    }

    #[test]
    fn a_canceled_session_takes_no_more_payments() {
        let mut contract = escrow(2);
        at("settler.test", START);
        contract.cancel_session("s1".into());
        assert_eq!(pay(&mut contract, "a.test", 25_000_000, START), 25_000_000);
    }
}
