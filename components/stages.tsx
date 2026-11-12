"use client";

import { useId, type ComponentType, type ReactNode } from "react";
import { ASSETS, HOLDINGS, type AssetKey, type Prices } from "@/lib/assets";
import { coin, usd, usd0 } from "@/lib/format";
import { useTyped, type StageState } from "@/lib/hooks";
import { NAMES, dipPrice, salePrice, type QuoteState, type Vals, type VerbKey } from "@/lib/verbs";
import { DotMatrix } from "./DotMatrix";
import { Dots, type DotGroup, type Ghost } from "./Dots";
import { ArrowUp, Arrow, Check, Dot, Finger, Lock, Panel, Pill, Plus, Sep, Spinner, Tick } from "./ui";

/**
 * A stage is the picture of one sentence. On a card it plays by itself. In the composer it
 * shows the sentence being written and then what happens when it is signed.
 */
export type StageProps = {
  state: StageState;
  cycle: number;
  vals: Vals;
  prices: Prices;
  quote: QuoteState;
  /** True inside the composer, where the person is in control. */
  live: boolean;
  onVal?: (key: string, value: string | number) => void;
};

const BLUE = ASSETS.usd.color;

function Frame({ children }: { children: ReactNode }) {
  return <div className="@container flex h-full flex-col items-center justify-between gap-3">{children}</div>;
}

/** What one dot stands for. Dropped when the stage is too narrow to hold it beside the legend. */
function Unit({ amount }: { amount: number }) {
  return (
    <span className="hidden items-center gap-3 @[21rem]:flex">
      <Sep />
      <span className="mono text-ink-3">1 dot = ${amount}</span>
    </span>
  );
}

type NoteTone = "muted" | "ok" | "stop" | "blue";
const NOTE: Record<NoteTone, string> = {
  muted: "text-ink-3",
  ok: "text-green",
  stop: "text-rose",
  blue: "text-blue",
};

function Note({ tone = "muted", children }: { tone?: NoteTone; children: ReactNode }) {
  return (
    <p className={`mono flex min-h-4 items-center justify-center gap-1.5 text-center ${NOTE[tone]}`}>
      {tone === "ok" && <Tick size={12} />}
      {children}
    </p>
  );
}

/** The button on a card's demo. It presses itself and settles into its result. */
function DemoPill({
  state,
  idle,
  run,
  done,
  icon,
}: {
  state: StageState;
  idle: string;
  run: string;
  done: string;
  icon?: ReactNode;
}) {
  if (state === "done")
    return (
      <span className="inline-flex h-10 animate-pop items-center gap-2 rounded-full bg-white px-5 text-[13.5px] font-medium text-green shadow-chip">
        <Check size={14} strokeWidth={2} />
        {done}
      </span>
    );
  return (
    <span
      className={`inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-[13.5px] font-medium text-white shadow-pill transition-transform duration-200 ${
        state === "run" ? "scale-[0.97]" : ""
      }`}
    >
      {state === "run" ? <Spinner size={13} /> : icon}
      {state === "run" ? run : idle}
    </span>
  );
}

function Labels({ left, right, mid }: { left: string; right: string; mid?: ReactNode }) {
  return (
    <div className={`grid w-full max-w-[360px] ${mid ? "grid-cols-3" : "grid-cols-2"} -mt-1`}>
      <span className="mono justify-self-center rounded-full bg-white px-2.5 py-1.5 shadow-chip">{left}</span>
      {mid}
      <span className="mono justify-self-center rounded-full bg-white px-2.5 py-1.5 shadow-chip">{right}</span>
    </div>
  );
}

/* ───────────────────────────── pay ───────────────────────────── */

function dotUnit(amount: number): number {
  return amount <= 60 ? 1 : amount <= 150 ? 2 : amount <= 320 ? 5 : 10;
}

function PayStage({ state, vals, live }: StageProps) {
  const amt = Number(vals.amt);
  const from = vals.from as AssetKey;
  const who = NAMES[String(vals.who)];
  const unit = dotUnit(amt);
  const n = Math.max(1, Math.round(amt / unit));
  const rest = Math.max(0, 61 - n);
  const moved = state === "run" || state === "done";
  const A: [number, number] = [88, 88];
  const B: [number, number] = [272, 88];
  const color = ASSETS[from].color;
  const groups: DotGroup[] = [
    { id: "rest", n: rest, a: A, b: A, ca: color, cb: color, at: 0 },
    { id: "go", n, a: A, b: B, ca: color, cb: BLUE, at: moved ? 1 : 0, snap: state === "idle", offA: rest, arc: 54, dur: 1900 },
  ];
  const ghosts: Ghost[] = [
    { at: A, n: rest + n },
    { at: B, n },
  ];
  return (
    <Frame>
      <Pill>
        {from !== "usd" && (
          <>
            <span className="flex items-center gap-1.5">
              <Dot color={color} />
              {ASSETS[from].name}
            </span>
            <Sep />
          </>
        )}
        <span className="flex items-center gap-1.5">
          <Dot color={BLUE} />
          dollars
        </span>
        <Unit amount={unit} />
      </Pill>
      <div className="w-full max-w-[360px]">
        <Dots w={360} h={166} groups={groups} ghosts={ghosts} />
        <Labels left="You" right={who} />
      </div>
      {live ? (
        <Note tone={state === "done" ? "ok" : state === "fail" ? "stop" : "muted"}>
          {state === "done"
            ? `${who} has ${usd(amt)}`
            : state === "fail"
              ? "Nothing left your account"
              : state === "run"
                ? "On its way"
                : `${n} dots will leave you`}
        </Note>
      ) : (
        <DemoPill
          state={state}
          idle="Hold to sign"
          run="Signing"
          done={`Paid ${who} ${usd(amt)}`}
          icon={<Finger size={15} />}
        />
      )}
    </Frame>
  );
}

/* ─────────────────────────── get paid ─────────────────────────── */

const PAYERS: AssetKey[] = ["btc", "eth", "sol"];
const TILT = ["-7deg", "4deg", "-3deg", "6deg"];

function GetPaidStage({ state, cycle, vals, quote, live, onVal }: StageProps) {
  const amt = Number(vals.amt);
  const payer = live ? (vals.payer as AssetKey) : PAYERS[cycle % PAYERS.length];
  const P = ASSETS[payer];
  const who = vals.who === "maya" ? "Maya" : "Anyone with the link";
  const flowing = state === "run" || state === "done";
  const sends = quote.status === "live" ? `${coin(quote.data.amountIn)} ${P.name}` : null;

  let note: ReactNode;
  let tone: NoteTone = "muted";
  if (state === "fail") {
    note = "Not created";
    tone = "stop";
  } else if (live) {
    if (state === "done") {
      note = "Link ready · waiting to be paid";
      tone = "ok";
    } else if (state === "run") note = "Writing the request";
    else note = sends ? `With ${P.name} they would send ${sends}` : `Pick what they might pay with`;
  } else if (state === "done") {
    note = "Arrived as dollars";
    tone = "ok";
  } else note = state === "run" ? `Being paid with ${P.name}` : "Waiting to be paid";

  return (
    <Frame>
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-3">
          {PAYERS.map((k, i) => {
            const active = k === payer;
            const cls = `grid size-11 place-items-center rounded-[13px] bg-white text-[18px] font-semibold shadow-chip transition-[transform,box-shadow] duration-300 ${
              active ? "scale-110 ring-2 ring-blue" : ""
            }`;
            const style = { color: ASSETS[k].color, ["--rot" as string]: TILT[i], animationDelay: `${i * -1.1}s` };
            return live ? (
              <button
                key={k}
                type="button"
                className={`${cls} cursor-pointer`}
                style={{ color: ASSETS[k].color }}
                aria-pressed={active}
                aria-label={`Preview a payer using ${ASSETS[k].name}`}
                onClick={() => onVal?.("payer", k)}
              >
                {ASSETS[k].glyph}
              </button>
            ) : (
              <span key={k} className={`${cls} animate-floaty`} style={style}>
                {ASSETS[k].glyph}
              </span>
            );
          })}
          <span
            className={`mono grid h-11 place-items-center rounded-[13px] bg-white px-2.5 text-ink-3 shadow-chip ${live ? "" : "animate-floaty"}`}
            style={{ ["--rot" as string]: TILT[3], animationDelay: "-2.6s" }}
          >
            +30
          </span>
        </div>
        <span
          className={`mt-2 h-7 w-0.5 animate-stream transition-opacity duration-300 ${flowing && !live ? "opacity-100" : "opacity-0"}`}
          style={{
            backgroundImage: `linear-gradient(${P.color} 50%, transparent 50%)`,
            backgroundSize: "2px 12px",
          }}
        />
      </div>
      <Panel className="-mt-2 w-full max-w-[310px] p-4">
        <div className="flex items-center justify-between">
          <span className="mono">Request</span>
          <span className="mono text-ink-3">{who}</span>
        </div>
        <div className="mt-2 flex items-end justify-between">
          <span className="text-[28px] font-medium leading-none tracking-[-0.03em] tabular-nums">{usd(amt)}</span>
          <span className="mono pb-0.5 text-ink-3">to you, as dollars</span>
        </div>
        <div className="mt-3.5 h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
          <div
            className={`h-full rounded-full bg-blue transition-[width] ease-out ${state === "idle" ? "duration-0" : "duration-[1700ms]"}`}
            style={{ width: flowing && !live ? "100%" : "0%" }}
          />
        </div>
      </Panel>
      <Note tone={tone}>{note}</Note>
    </Frame>
  );
}

/* ──────────────────────────── change ──────────────────────────── */

function PriceChart({ state, cycle, vals, prices }: StageProps) {
  const id = useId();
  const to = ASSETS[vals.to as AssetKey];
  const dip = usd0(dipPrice(prices));
  const met = state === "done";
  const drawn = state === "run" || state === "done";
  return (
    <Frame>
      <Pill>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded bg-ink" />
          Bitcoin price
        </span>
        <Sep />
        <span className="flex items-center gap-1.5 text-blue">
          <span className="h-0.5 w-3 rounded bg-blue-2" />
          Your price
        </span>
      </Pill>
      <div className="relative w-full max-w-[330px]">
        <Panel className="px-4 pb-5 pt-3.5">
          <div className="flex items-center justify-between">
            <span className="mono">Bitcoin price</span>
            <span
              className={`mono rounded-full px-2 py-1 !text-[9.5px] transition-colors duration-300 ${
                met ? "bg-blue-4 text-blue" : state === "fail" ? "bg-rose-3 text-rose" : "bg-black/[0.045] text-ink-2"
              }`}
            >
              {met ? "Price met" : state === "fail" ? "Not recorded" : "Waiting"}
            </span>
          </div>
          <svg key={cycle} viewBox="0 0 300 118" className="mt-2 block w-full" aria-hidden="true">
            <defs>
              <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <rect width="6" height="6" fill="#eaeffd" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="#c6d3fa" strokeWidth="1.4" />
              </pattern>
            </defs>
            <line x1="0" y1="18" x2="300" y2="18" stroke="#ededf0" />
            <line x1="0" y1="50" x2="300" y2="50" stroke="#ededf0" />
            <rect x="0" y="82" width="300" height="36" fill={`url(#${id})`} />
            <line x1="0" y1="82" x2="300" y2="82" stroke="#8aa5f3" strokeDasharray="3 3" />
            <text x="6" y="97" className="mono" fill="#2553e6" style={{ fontSize: 8.5 }}>
              UNDER {dip}
            </text>
            <path
              d="M0 44 C 30 34, 52 52, 82 46 S 132 30, 162 42 S 204 50, 226 62 S 252 92, 268 100"
              fill="none"
              stroke="#131316"
              strokeWidth="1.8"
              strokeLinecap="round"
              pathLength={100}
              strokeDasharray={100}
              style={{
                strokeDashoffset: drawn ? 0 : 40,
                transition: "stroke-dashoffset 1.2s cubic-bezier(.5,0,.3,1)",
                animation: drawn ? undefined : "chart-in 1.7s ease-out both",
              }}
            />
            {met && (
              <g className="animate-pop" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                <circle cx="268" cy="100" r="10" fill="#2553e6" />
                <path
                  d="M263.5 100.300l3 3 5.500-6.300"
                  fill="none"
                  stroke="#fff"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </g>
            )}
          </svg>
        </Panel>
        <div className="absolute inset-x-0 -bottom-3.5 flex justify-center">
          <Pill className={met ? "animate-pop" : ""}>
            {met ? (
              <>
                <Tick size={14} />
                <span>
                  Changed {usd0(Number(vals.amt))} into {to.name}
                </span>
              </>
            ) : (
              <span className="text-ink-2">Your money stays put until then</span>
            )}
          </Pill>
        </div>
      </div>
      <span />
    </Frame>
  );
}

function ChangeStage(props: StageProps) {
  const { state, vals, live } = props;
  if (!live || vals.when === "dip") return <PriceChart {...props} />;
  const amt = Number(vals.amt);
  const from = ASSETS[vals.from as AssetKey];
  const to = ASSETS[vals.to as AssetKey];
  const unit = dotUnit(amt);
  const n = Math.max(1, Math.round(amt / unit));
  const rest = Math.max(0, 61 - n);
  const moved = state === "run" || state === "done";
  const A: [number, number] = [88, 88];
  const B: [number, number] = [272, 88];
  const fri = vals.when === "fri";
  return (
    <Frame>
      <Pill>
        <span className="flex items-center gap-1.5">
          <Dot color={from.color} />
          {from.name}
        </span>
        <Sep />
        <span className="flex items-center gap-1.5">
          <Dot color={to.color} />
          {to.name}
        </span>
        <Unit amount={unit} />
      </Pill>
      <div className="w-full max-w-[360px]">
        <Dots
          w={360}
          h={166}
          groups={[
            { id: "rest", n: rest, a: A, b: A, ca: from.color, cb: from.color, at: 0 },
            { id: "go", n, a: A, b: B, ca: from.color, cb: to.color, at: moved && !fri ? 1 : 0, offA: rest, arc: 54, dur: 1900 },
          ]}
          ghosts={[
            { at: A, n: rest + n },
            { at: B, n },
          ]}
        />
        <Labels left={`Your ${from.name}`} right={`Your ${to.name}`} />
      </div>
      <Note tone={state === "done" ? "ok" : state === "fail" ? "stop" : "muted"}>
        {state === "fail"
          ? "Nothing was changed"
          : fri
            ? state === "done"
              ? "First run this Friday"
              : `${n} dots would move each Friday`
            : state === "done"
              ? `Now ${to.name}, in your account`
              : state === "run"
                ? "Changing"
                : `${n} dots will change colour`}
      </Note>
    </Frame>
  );
}

/* ───────────────────────────── grow ───────────────────────────── */

function GrowStage({ state, vals, live }: StageProps) {
  const amt = Number(vals.amt);
  const f = Math.min(0.97, amt / HOLDINGS.usd);
  const working = state === "run" || state === "done";
  const solid = working ? f : 0;
  const preview = live || working ? f : 0;
  const edge = Math.max(solid, preview);
  return (
    <Frame>
      <div className="relative w-full max-w-[360px]">
        <DotMatrix solid={solid} preview={preview} />
        <div className="absolute inset-x-0 top-2 flex justify-center">
          <Pill>
            <span className="flex items-center gap-1.5">
              <Dot color={BLUE} />
              At work
            </span>
            <Sep />
            <span className="flex items-center gap-1.5">
              <Dot color="#d0d0d6" />
              Ready to spend
            </span>
          </Pill>
        </div>
      </div>
      <Panel className="-mt-7 w-full max-w-[310px] p-4">
        <div className="flex items-center justify-between">
          <span className="mono">Your dollars</span>
          <span className="mono">
            {Math.round(solid * 100)}% <span className="text-ink-3">at work</span>
          </span>
        </div>
        <div className="relative mt-3 h-9 rounded-full bg-black/[0.06]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-blue-3 transition-[width] duration-700 ease-out"
            style={{ width: `max(36px, ${preview * 100}%)`, opacity: preview ? 1 : 0 }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-blue transition-[width,opacity] duration-[1500ms] ease-out"
            style={{ width: `max(36px, ${solid * 100}%)`, opacity: solid ? 1 : 0 }}
          />
          <div
            className="absolute top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full bg-white text-ink shadow-chip transition-[left] duration-700 ease-out"
            style={{ left: `max(4px, calc(${edge * 100}% - 32px))` }}
          >
            <Arrow size={13} />
          </div>
        </div>
        <p className="mono mt-3 text-center text-ink-3">
          {usd0(amt)} of {usd0(HOLDINGS.usd)}
        </p>
      </Panel>
      <Note tone={state === "done" ? "ok" : state === "fail" ? "stop" : "muted"}>
        {state === "done"
          ? "Earning about 4.1% a year"
          : state === "fail"
            ? "Nothing was moved"
            : state === "run"
              ? `Moving ${usd0(amt)}`
              : live
                ? `Would earn roughly ${usd(amt * 0.041)} a year`
                : "Nothing at work yet"}
      </Note>
    </Frame>
  );
}

/* ──────────────────────────── borrow ──────────────────────────── */

function BorrowStage({ state, vals, prices, live }: StageProps) {
  const amt = Number(vals.amt);
  const unit = 20;
  const nu = Math.max(1, Math.round(amt / unit));
  const nb = nu * 2;
  const total = Math.max(nb, Math.min(37, Math.round((HOLDINGS.btc * prices.btc) / unit)));
  const rest = total - nb;
  const moved = state === "run" || state === "done";
  const L: [number, number] = [62, 60];
  const M: [number, number] = [180, 60];
  const R: [number, number] = [298, 60];
  const orange = ASSETS.btc.color;
  return (
    <Frame>
      <Pill>
        <span className="flex items-center gap-1.5">
          <Dot color={orange} />
          bitcoin
        </span>
        <Sep />
        <span className="flex items-center gap-1.5">
          <Dot color={BLUE} />
          dollars
        </span>
        <Unit amount={unit} />
      </Pill>
      <div className="w-full max-w-[360px]">
        <Dots
          w={360}
          h={116}
          groups={[
            { id: "rest", n: rest, a: L, b: L, ca: orange, cb: orange, at: 0 },
            { id: "aside", n: nb, a: L, b: M, ca: orange, cb: orange, at: moved ? 1 : 0, snap: state === "idle" && !live, offA: rest, arc: 30, dur: 1500 },
            { id: "usd", n: nu, a: M, b: R, ca: BLUE, cb: BLUE, at: moved ? 1 : 0, snap: state === "idle" && !live, arc: 30, dur: 1400, delay: 800, fadeIn: true },
          ]}
          ghosts={[
            { at: L, n: total },
            { at: M, n: nb },
            { at: R, n: nu },
          ]}
        />
        <Labels
          left="Your bitcoin"
          right="Yours to spend"
          mid={
            <span
              className={`mono flex items-center gap-1 justify-self-center rounded-full px-2.5 py-1.5 shadow-chip transition-colors duration-500 ${
                moved ? "hatch bg-white text-ink" : "bg-white text-ink-3"
              }`}
            >
              <Lock size={11} />
              Set aside
            </span>
          }
        />
      </div>
      <div className="flex flex-col items-center gap-2.5">
        {!live && (
          <DemoPill state={state} idle={`Borrow ${usd0(amt)}`} run="Setting bitcoin aside" done={`${usd0(amt)} arrived`} />
        )}
        <Note tone={state === "fail" ? "stop" : live && state === "done" ? "ok" : "muted"}>
          {state === "fail" ? (
            "Your bitcoin was not touched"
          ) : live && state === "done" ? (
            `${usd0(amt)} arrived · your bitcoin is set aside`
          ) : (
            <span>
              Sold only if bitcoin falls below <span className="text-rose">{usd0(salePrice(prices))}</span>
            </span>
          )}
        </Note>
      </div>
    </Frame>
  );
}

/* ───────────────────────────── ask ───────────────────────────── */

const QUESTIONS: Record<string, string> = {
  med: "What does this blood test result mean?",
  debt: "How do I get out of this debt?",
  contract: "Is this clause in my lease normal?",
};
const LINES = ["84%", "66%", "74%", "42%"];

function Typed({ text }: { text: string }) {
  const shown = useTyped(text, true);
  return (
    <span className="truncate">
      {shown}
      <span className="ml-px inline-block h-[1.05em] w-px translate-y-[2px] animate-blink bg-white/80" />
    </span>
  );
}

function AskStage({ state, cycle, vals, live }: StageProps) {
  const text = QUESTIONS[String(vals.topic)] ?? QUESTIONS.med;
  const sealed = state === "done";
  return (
    <Frame>
      <span />
      <div className="w-full max-w-[330px]">
        <Panel className="px-4 pb-9 pt-3.5">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <span className="flex gap-1">
                <i className="size-1.5 rounded-full bg-black/15" />
                <i className="size-1.5 rounded-full bg-black/15" />
                <i className="size-1.5 rounded-full bg-black/15" />
              </span>
              <span className="mono">Sealed session</span>
            </span>
            <span className={`transition-colors duration-300 ${sealed ? "text-green" : "text-ink-3"}`}>
              <Lock size={14} />
            </span>
          </div>
          <div className="mt-4 grid gap-2.5">
            {LINES.map((w, i) => (
              <span key={i} className="block h-2 rounded-full bg-black/[0.055]" style={{ width: w }}>
                <span
                  className="block h-full rounded-full bg-blue-3 transition-[width] ease-out"
                  style={{
                    width: sealed ? "100%" : "0%",
                    transitionDuration: sealed ? "700ms" : "0ms",
                    transitionDelay: sealed ? `${250 + i * 180}ms` : "0ms",
                  }}
                />
              </span>
            ))}
          </div>
        </Panel>
        <div className="relative mx-1.5 -mt-6 flex h-12 items-center gap-2.5 rounded-[15px] bg-ink px-3 text-[13.5px] text-white shadow-pill">
          {state === "run" ? (
            <>
              <Spinner size={15} className="text-white/70" />
              <span className="text-white/60">Checking the proof</span>
            </>
          ) : sealed ? (
            <>
              <Tick size={18} />
              <span className="truncate">Sealed. Only you can read it.</span>
              <span className="mono ml-auto rounded-full bg-white px-2 py-1 !text-[9px] font-semibold text-ink">Proof</span>
            </>
          ) : state === "fail" ? (
            <>
              <span className="size-2 rounded-full bg-rose" />
              <span className="truncate">Not sealed. Nothing was sent.</span>
            </>
          ) : (
            <>
              <Plus size={15} className="shrink-0 text-white/45" />
              {live ? <span className="truncate">{text}</span> : <Typed key={cycle} text={text} />}
              <span className="ml-auto grid size-7 shrink-0 place-items-center rounded-full bg-white text-ink">
                <ArrowUp size={14} />
              </span>
            </>
          )}
        </div>
      </div>
      <Note tone={sealed ? "ok" : "muted"}>
        {sealed ? "Proof checked before a word was sent" : "Needs no money in your account"}
      </Note>
    </Frame>
  );
}

export const STAGES: Record<VerbKey, ComponentType<StageProps>> = {
  pay: PayStage,
  getpaid: GetPaidStage,
  change: ChangeStage,
  grow: GrowStage,
  borrow: BorrowStage,
  ask: AskStage,
};
