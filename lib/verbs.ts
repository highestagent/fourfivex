/**
 * The grammar. Every capability is a verb with blanks, and every verb answers the same
 * questions before anything is signed: what arrives, what leaves, when, who can see it,
 * what happens if it fails, and whether it can be undone.
 */
import { ASSETS, HOLDINGS, type AssetKey, type Prices } from "./assets";
import { coin, cost, pct, usd, usd0, wait } from "./format";
import type { QuoteAsk, QuoteOk } from "./oneclick";

export type VerbKey = "pay" | "getpaid" | "change" | "grow" | "borrow" | "ask";
export type Vals = Record<string, string | number>;
export type Tone = "ok" | "warn" | "stop";
export type Row = { k: string; v: string; sub?: string; tone?: Tone };
export type StatusTone = "live" | "muted" | "warn";

export type QuoteState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "live"; data: QuoteOk }
  | { status: "no-offer" }
  | { status: "unavailable" };

export type Ctx = { prices: Prices; pricesLive: boolean; quote: QuoteState };
export type Standing = { t: string; m: string; stop: string; ended: string };

export type Outcome = {
  rows: Row[];
  status: { label: string; tone: StatusTone };
  cta: string;
  /** Milliseconds to hold. Zero means a tap is enough because nothing leaves the account. */
  hold: number;
  steps: string[];
  doneLabel: string;
  past: string;
  after?: string;
  fail: string;
  why: string;
  ack?: string;
  /** When set, signing is off and this says why. */
  blocked?: string;
  standing?: Standing;
};

export type Opt = { v: string | number; label: string; asset?: AssetKey };
export type Slot = { cap: string; opts: (p: Prices) => Opt[] };
export type Part = string | { slot: string };

export type Verb = {
  key: VerbKey;
  title: string;
  blurb: string;
  parts: Part[];
  slots: Record<string, Slot>;
  def: Vals;
  /** What the card's self-playing demo shows, when that differs from the default sentence. */
  demo?: Vals;
  /** How long the card's self-playing demo rests, runs and holds its result. */
  loop: [number, number, number];
  fix?: (v: Vals, changed: string) => Vals;
  ask?: (v: Vals) => QuoteAsk | null;
  out: (v: Vals, c: Ctx) => Outcome;
};

export const NAMES: Record<string, string> = { maya: "Maya", dad: "Dad", new: "0x71…9c4e" };

/** A price a little under today's, so "when bitcoin is under …" always reads sensibly. */
export function dipPrice(p: Prices): number {
  return Math.floor((p.btc * 0.95) / 1000) * 1000;
}

/** With twice the loan set aside, a forced sale happens at about 60% of today's price. */
export function salePrice(p: Prices): number {
  return Math.round((p.btc * 0.6) / 100) * 100;
}

const NO_OFFER = "No one is offering this right now. Try another amount or currency.";

function quoteStatus(q: QuoteState): Outcome["status"] {
  switch (q.status) {
    case "live":
      return { label: "Live quote", tone: "live" };
    case "loading":
      return { label: "Getting a price", tone: "muted" };
    case "no-offer":
      return { label: "No offer right now", tone: "warn" };
    case "unavailable":
      return { label: "Estimate", tone: "muted" };
    default:
      return { label: "Example", tone: "muted" };
  }
}

const slot = (s: string): Part => ({ slot: s });

export const VERBS: Record<VerbKey, Verb> = {
  pay: {
    key: "pay",
    title: "Pay anyone in the money they want",
    blurb:
      "You hold bitcoin and your friend wants dollars. Say who and how much. They get exactly that, on whatever network they use.",
    parts: ["Pay ", slot("who"), " ", slot("amt"), " from ", slot("from"), ", ", slot("how"), "."],
    slots: {
      who: {
        cap: "To",
        opts: () => [
          { v: "maya", label: "Maya" },
          { v: "dad", label: "Dad" },
          { v: "new", label: "0x71…9c4e" },
        ],
      },
      amt: {
        cap: "Amount",
        opts: () => [
          { v: 10, label: "$10" },
          { v: 40, label: "$40" },
          { v: 120, label: "$120" },
        ],
      },
      from: {
        cap: "From",
        opts: () => [
          { v: "btc", label: "my bitcoin", asset: "btc" },
          { v: "usd", label: "my dollars", asset: "usd" },
        ],
      },
      how: {
        cap: "Seen by",
        opts: () => [
          { v: "open", label: "openly" },
          { v: "priv", label: "privately" },
        ],
      },
    },
    def: { who: "maya", amt: 40, from: "btc", how: "open" },
    loop: [1500, 2400, 2200],
    ask: (v) => ({ kind: "pay", from: v.from as AssetKey, usd: Number(v.amt) }),
    out(v, c) {
      const who = String(v.who);
      const amt = Number(v.amt);
      const from = v.from as AssetKey;
      const priv = v.how === "priv";
      const isNew = who === "new";
      const n = NAMES[who];
      const q = c.quote.status === "live" ? c.quote.data : null;
      const leavesUsd = q ? q.amountInUsd : amt * 1.013;
      const leaves = q ? q.amountIn : leavesUsd / c.prices[from];
      const fee = Math.max(0, leavesUsd - amt);
      const rows: Row[] = [
        {
          k: isNew ? "They get" : `${n} gets`,
          v: `${usd(amt)} exactly, as dollars`,
          sub: "USDC on Base",
          tone: "ok",
        },
        {
          k: "Leaves you",
          v: from === "usd" ? `${usd(leavesUsd)} of your dollars` : `${coin(leaves)} ${ASSETS[from].name}`,
          sub: `${from === "usd" ? "" : `about ${usd(leavesUsd)} · `}cost ${cost(fee)} (${pct(fee / amt)})`,
        },
        { k: "Arrives", v: `in ${wait(q ? q.seconds : 15)}` },
        {
          k: "Seen by",
          v: priv ? `you and ${isNew ? "them" : n}` : "anyone who looks it up",
          sub: priv ? "no public record · priced at the open rate" : "amount and addresses are public",
        },
        { k: "If it fails", v: "nothing leaves your account" },
        { k: "Once it arrives", v: `only ${isNew ? "they" : n} can send it back`, tone: "stop" },
      ];
      if (isNew)
        rows.splice(1, 0, {
          k: "First time",
          v: "$1.00 goes first",
          sub: "the rest follows when it lands",
          tone: "warn",
        });
      return {
        rows,
        status: quoteStatus(c.quote),
        cta: "Hold to sign",
        hold: 900,
        steps: [
          from === "usd" ? "Sending your dollars" : `Changing ${ASSETS[from].name} into dollars`,
          isNew ? `Arriving at ${n}` : `Arriving with ${n}`,
        ],
        doneLabel: `Paid ${n} ${usd(amt)}`,
        past: `You paid ${n} ${usd(amt)}.`,
        fail: `${isNew ? "The address" : n} was not paid. Nothing left your account.`,
        why: "No one would deliver at the price you were shown.",
        blocked: c.quote.status === "no-offer" ? NO_OFFER : undefined,
      };
    },
  },

  getpaid: {
    key: "getpaid",
    title: "Get paid in anything",
    blurb:
      "Share one link. They pay with whatever they hold, on any of thirty networks, and it reaches you as dollars.",
    parts: ["Ask ", slot("who"), " for ", slot("amt"), " in dollars."],
    slots: {
      who: {
        cap: "From",
        opts: () => [
          { v: "any", label: "anyone with the link" },
          { v: "maya", label: "Maya" },
        ],
      },
      amt: {
        cap: "Amount",
        opts: () => [
          { v: 40, label: "$40" },
          { v: 120, label: "$120" },
          { v: 600, label: "$600" },
        ],
      },
    },
    def: { who: "any", amt: 120, payer: "eth" },
    loop: [1300, 1900, 2200],
    ask: (v) => ({ kind: "getpaid", payer: v.payer as AssetKey, usd: Number(v.amt) }),
    out(v, c) {
      const amt = Number(v.amt);
      const payer = v.payer as AssetKey;
      const P = ASSETS[payer];
      const who = v.who === "any" ? "anyone with the link" : "Maya";
      const q = c.quote.status === "live" ? c.quote.data : null;
      const inUsd = q ? q.amountInUsd : amt * 1.012;
      const sends = q ? q.amountIn : inUsd / c.prices[payer];
      return {
        rows: [
          { k: "You get", v: `${usd(amt)} exactly, as dollars`, tone: "ok" },
          {
            k: `Paying with ${P.name}`,
            v: `they send ${q ? "" : "about "}${coin(sends)} ${P.name}`,
            sub: `about ${usd(inUsd)} · they cover the ${cost(Math.max(0, inUsd - amt))} cost`,
          },
          { k: "Reaches you", v: `${wait(q ? q.seconds : 45)} after they pay` },
          { k: "The link", v: "works once, for 24 hours" },
          { k: "If nobody pays", v: "the link expires", sub: "nothing else happens" },
        ],
        status: quoteStatus(c.quote),
        cta: "Create the request",
        hold: 0,
        steps: ["Writing the request"],
        doneLabel: "Request ready to share",
        past: `You asked ${who} for ${usd(amt)}.`,
        after: "The request waits under Standing until it is paid.",
        fail: "The request was not created. Nothing was sent or received.",
        why: "The service that issues request links did not answer.",
        standing: {
          t: `Waiting for ${usd(amt)} from ${who}.`,
          m: "Expires in 24 hours",
          stop: "Cancel",
          ended: `You cancelled a request for ${usd(amt)}.`,
        },
      };
    },
  },

  change: {
    key: "change",
    title: "Name your price and walk away",
    blurb:
      "Change one kind of money into another now, or leave an instruction that waits for the price you want.",
    parts: ["Change ", slot("amt"), " of ", slot("from"), " into ", slot("to"), ", ", slot("when"), "."],
    slots: {
      amt: {
        cap: "Amount",
        opts: () => [
          { v: 25, label: "$25" },
          { v: 50, label: "$50" },
          { v: 200, label: "$200" },
        ],
      },
      from: {
        cap: "From",
        opts: () => [
          { v: "btc", label: "my bitcoin", asset: "btc" },
          { v: "usd", label: "my dollars", asset: "usd" },
        ],
      },
      to: {
        cap: "Into",
        opts: () => [
          { v: "usd", label: "dollars", asset: "usd" },
          { v: "btc", label: "bitcoin", asset: "btc" },
          { v: "eth", label: "ether", asset: "eth" },
        ],
      },
      when: {
        cap: "When",
        opts: (p) => [
          { v: "now", label: "now" },
          { v: "dip", label: `when bitcoin is under ${usd0(dipPrice(p))}` },
          { v: "fri", label: "every Friday" },
        ],
      },
    },
    def: { amt: 50, from: "btc", to: "usd", when: "now" },
    demo: { amt: 50, from: "usd", to: "btc", when: "dip" },
    loop: [2000, 1300, 2400],
    fix(v, changed) {
      if (v.from !== v.to) return v;
      if (changed === "from") return { ...v, to: v.from === "usd" ? "btc" : "usd" };
      return { ...v, from: v.to === "usd" ? "btc" : "usd" };
    },
    ask: (v) =>
      v.when === "now"
        ? { kind: "change", from: v.from as AssetKey, to: v.to as AssetKey, usd: Number(v.amt) }
        : null,
    out(v, c) {
      const amt = Number(v.amt);
      const from = v.from as AssetKey;
      const to = v.to as AssetKey;
      const F = ASSETS[from];
      const T = ASSETS[to];
      const src = `${usd(amt)} of your ${F.name}`;

      if (v.when === "fri")
        return {
          rows: [
            { k: "Each Friday", v: `${src} becomes ${T.name}`, sub: "at that day’s price" },
            { k: "It can only", v: "do this one thing", sub: "it cannot send money to anyone", tone: "ok" },
            { k: "Ceiling", v: `stops at ${usd(amt * 4)} a month` },
            { k: "Runs", v: "without asking you each time", tone: "warn" },
            { k: "Stop it", v: "any time, under Standing" },
          ],
          status: { label: "Needs a scheduler · not live yet", tone: "warn" },
          cta: "Hold to sign a standing order",
          hold: 1500,
          steps: ["Writing the ceiling into your account", "Scheduled for Friday"],
          doneLabel: "Standing order set",
          past: `You set a standing order: ${usd(amt)} into ${T.name} every Friday.`,
          after: "It lives under Standing, where you can stop it.",
          fail: "The standing order was not set. Nothing will run.",
          why: "The ceiling could not be written, so no permission was given.",
          standing: {
            t: `Every Friday, ${src} becomes ${T.name}.`,
            m: `$0 of ${usd0(amt * 4)} this month`,
            stop: "Stop",
            ended: "You stopped the Friday order.",
          },
        };

      if (v.when === "dip") {
        const dip = usd0(dipPrice(c.prices));
        return {
          rows: [
            { k: "Waits until", v: `bitcoin is under ${dip}`, sub: `it is ${usd0(c.prices.btc)} now` },
            { k: "Then", v: `changes ${src} into ${T.name}` },
            { k: "Until then", v: "your money stays where it is", tone: "ok" },
            { k: "Might", v: "never happen", tone: "warn" },
            { k: "Cancel", v: "any time, under Standing" },
          ],
          status: { label: c.pricesLive ? "Example · live price" : "Example", tone: "muted" },
          cta: "Hold to sign",
          hold: 900,
          steps: ["Instruction recorded"],
          doneLabel: "Instruction left",
          past: `You left an instruction: change ${usd(amt)} into ${T.name} when bitcoin is under ${dip}.`,
          after: "It waits under Standing until the price is met or you cancel.",
          fail: "The instruction was not recorded. Nothing is waiting.",
          why: "The order service did not accept it.",
          standing: {
            t: `When bitcoin is under ${dip}, ${src} becomes ${T.name}.`,
            m: "Waiting",
            stop: "Cancel",
            ended: "You cancelled a waiting instruction.",
          },
        };
      }

      const q = c.quote.status === "live" ? c.quote.data : null;
      const inUsd = q ? q.amountInUsd : amt;
      const outUsd = q ? q.amountOutUsd : amt * 0.996;
      const gets = q ? q.amountOut : outUsd / c.prices[to];
      const fee = Math.max(0, inUsd - outUsd);
      const about = q ? "" : "about ";
      return {
        rows: [
          {
            k: "You get",
            v: to === "usd" ? `${about}${usd(gets)}` : `${about}${coin(gets)} ${T.name}`,
            sub: to === "usd" ? "as dollars, in your account" : `about ${usd(outUsd)}`,
            tone: "ok",
          },
          {
            k: "Leaves you",
            v: from === "usd" ? src : `${coin(q ? q.amountIn : amt / c.prices[from])} ${F.name}`,
            sub: `${from === "usd" ? "" : `about ${usd(inUsd)} · `}cost ${cost(fee)} (${pct(fee / inUsd)})`,
          },
          { k: "Takes", v: wait(q ? q.seconds : 12) },
          { k: "If the price moves", v: "you are asked again first" },
          { k: "Afterwards", v: "you can change it back", sub: "at that day’s price" },
        ],
        status: quoteStatus(c.quote),
        cta: "Hold to sign",
        hold: 900,
        steps: [`Changing ${F.name} into ${T.name}`, "Arrived in your account"],
        doneLabel: `Changed into ${T.name}`,
        past: `You changed ${src} into ${T.name}.`,
        fail: `Nothing was changed. Your ${F.name} is where it was.`,
        why: "The price moved before it could be delivered.",
        blocked: c.quote.status === "no-offer" ? NO_OFFER : undefined,
      };
    },
  },

  grow: {
    key: "grow",
    title: "Put idle money to work",
    blurb:
      "Dollars sitting still earn nothing. Choose how much to put to work, see who runs it, and take it out any time.",
    parts: ["Put ", slot("amt"), " of my dollars to work."],
    slots: {
      amt: {
        cap: "Amount",
        opts: () => [
          { v: 100, label: "$100" },
          { v: 250, label: "$250" },
          { v: 400, label: "$400" },
        ],
      },
    },
    def: { amt: 400 },
    loop: [1300, 2300, 2200],
    out(v) {
      const amt = Number(v.amt);
      return {
        rows: [
          { k: "Earns", v: "about 4.1% a year today", sub: "the rate moves daily" },
          { k: `On ${usd0(amt)}`, v: `roughly ${usd(amt * 0.041)} a year` },
          { k: "Take it out", v: "any time, in about a minute", tone: "ok" },
          { k: "Run by", v: "Gauntlet, on Morpho", sub: "an independent lender" },
          { k: "Not a bank", v: "no deposit insurance", sub: "you could lose money", tone: "stop" },
        ],
        status: { label: "Example rate", tone: "muted" },
        cta: "Hold to sign",
        hold: 900,
        steps: ["Moving your dollars", "Now earning"],
        doneLabel: `${usd0(amt)} is now at work`,
        past: `You put ${usd(amt)} to work.`,
        after: "It lives under Standing, where you can take it out.",
        fail: `Nothing was moved. Your ${usd(amt)} is where it was.`,
        why: "The lender had no room for new money.",
        standing: {
          t: `${usd(amt)} is at work, earning about 4.1% a year.`,
          m: "Rate checked today",
          stop: "Take it out",
          ended: `You took ${usd(amt)} out.`,
        },
      };
    },
  },

  borrow: {
    key: "borrow",
    title: "Borrow without selling",
    blurb:
      "Set some bitcoin aside and get dollars today. You see the exact price at which it would be sold before you sign.",
    parts: ["Borrow ", slot("amt"), " against ", slot("against"), "."],
    slots: {
      amt: {
        cap: "Amount",
        opts: () => [
          { v: 100, label: "$100" },
          { v: 200, label: "$200" },
          { v: 300, label: "$300" },
        ],
      },
      against: { cap: "Set aside", opts: () => [{ v: "btc", label: "my bitcoin", asset: "btc" }] },
    },
    def: { amt: 200, against: "btc" },
    loop: [1500, 2600, 2400],
    out(v, c) {
      const amt = Number(v.amt);
      const aside = (2 * amt) / c.prices.btc;
      const sale = usd0(salePrice(c.prices));
      const enough = aside <= HOLDINGS.btc;
      return {
        rows: [
          { k: "You get", v: `${usd(amt)} now, as dollars`, tone: "ok" },
          { k: "Set aside", v: `${coin(aside)} bitcoin`, sub: `about ${usd(2 * amt)} · it stays yours` },
          { k: "Costs", v: "about 6.2% a year", sub: `${usd((amt * 0.062) / 12)} a month` },
          { k: "Repay", v: "any time", sub: "and your bitcoin is released" },
          {
            k: "If the price falls",
            v: `below ${sale}, your bitcoin is sold to repay`,
            sub: "this cannot be reversed",
            tone: "stop",
          },
        ],
        status: { label: c.pricesLive ? "Example terms · live price" : "Example", tone: "muted" },
        cta: "Hold to sign",
        hold: 1500,
        steps: ["Setting your bitcoin aside", "Dollars arriving"],
        doneLabel: `${usd0(amt)} arrived`,
        past: `You borrowed ${usd(amt)} against your bitcoin.`,
        after: "The loan lives under Standing, where you can repay it.",
        fail: "No loan was made. Your bitcoin was not touched.",
        why: "The lender could not fund it at the rate you were shown.",
        ack: "I understand my bitcoin can be sold if its price falls.",
        blocked: enough ? undefined : "You don’t hold enough bitcoin to set aside for this amount.",
        standing: {
          t: `You owe ${usd(amt)}. ${coin(aside)} bitcoin is set aside.`,
          m: `Sold if bitcoin falls below ${sale}`,
          stop: "Repay",
          ended: `You repaid ${usd(amt)}. Your bitcoin was released.`,
        },
      };
    },
  },

  ask: {
    key: "ask",
    title: "Ask what you wouldn’t ask a chatbot",
    blurb:
      "Questions about health, debt or a contract run inside sealed hardware. The proof is checked before a word is sent.",
    parts: ["Ask privately about ", slot("topic"), "."],
    slots: {
      topic: {
        cap: "About",
        opts: () => [
          { v: "med", label: "a medical result" },
          { v: "debt", label: "money I owe" },
          { v: "contract", label: "a contract I was sent" },
        ],
      },
    },
    def: { topic: "med" },
    loop: [2600, 1500, 2600],
    out() {
      return {
        rows: [
          { k: "Read by", v: "only you", sub: "not us, and not whoever runs the computers", tone: "ok" },
          { k: "How you know", v: "the hardware signs a proof", sub: "checked before anything is sent" },
          { k: "Kept", v: "on this device only" },
          { k: "Needs", v: "no money in your account" },
          { k: "Still true", v: "an AI can be wrong", sub: "treat answers as a second opinion", tone: "warn" },
        ],
        status: { label: "Demo · no model connected", tone: "muted" },
        cta: "Start asking",
        hold: 0,
        steps: ["Checking the proof", "Sealed session open"],
        doneLabel: "Sealed session open",
        past: "You opened a private session.",
        after: "This build stops here. No model is connected.",
        fail: "We could not confirm this session is sealed, so nothing was sent.",
        why: "The proof from the hardware did not check out.",
      };
    },
  },
};

export const VERB_ORDER: VerbKey[] = ["pay", "getpaid", "change", "grow", "borrow", "ask"];

export function label(verb: Verb, key: string, vals: Vals, prices: Prices): string {
  const o = verb.slots[key].opts(prices).find((x) => x.v === vals[key]);
  return o ? o.label : "";
}

/** The sentence as plain text, for labels and receipts. */
export function plain(verb: Verb, vals: Vals, prices: Prices): string {
  return verb.parts.map((p) => (typeof p === "string" ? p : label(verb, p.slot, vals, prices))).join("");
}
