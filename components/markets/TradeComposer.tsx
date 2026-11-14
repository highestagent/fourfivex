"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { defaultInstrument, hyperliquidMarket, marketLabel, type Market } from "@fourfivex/markets-protocol/markets";
import { Select } from "@/components/Select";
import { money } from "./format";
import { Dialog } from "./controls";
import { MarketIcon, MarketPicker, type useMarketCatalog } from "./market-picker";
import { readPerpetual, readPosition, type OrderDraft, type Perpetual, type Position, type Side } from "@/lib/markets/trade";
import { tradeApi, type TradeAccount } from "@/lib/markets/api";

const TradeReview = dynamic(() => import("./TradeReview").then(module => module.TradeReview));
const TradingFunds = dynamic(() => import("./TradingFunds").then(module => module.TradingFunds));
const directions = [{ value: "long", label: "long" }, { value: "short", label: "short" }] as const;
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const amountPattern = "[0-9]{1,7}([.,][0-9]{1,2})?";
const amountDraft = /^\d{0,7}([.,]\d{0,2})?$/;

export function TradeComposer({ market, selectMarket, catalog, accountId, accountOpen, openAccount }: {
  market: Market;
  selectMarket: (market: Market) => void;
  catalog: ReturnType<typeof useMarketCatalog>;
  accountId: string | null;
  accountOpen: boolean;
  openAccount: () => void;
}) {
  const [side, setSide] = useState<Side>("long");
  const [amount, setAmount] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [dialog, setDialog] = useState<"market" | "review" | "close" | "fund" | "withdraw">();
  const [returnToReview, setReturnToReview] = useState(false);
  const [tradeAccount, setTradeAccount] = useState<{ id: string; data: TradeAccount }>();
  const [positionData, setPositionData] = useState<{ market: Market; accountId: string; position?: Position }>();
  const [instrumentData, setInstrumentData] = useState<Perpetual>();
  const [failedMarket, setFailedMarket] = useState<Market>();
  const [refresh, setRefresh] = useState(0);
  const marketButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const fundsButton = useRef<HTMLButtonElement>(null);
  const withdrawButton = useRef<HTMLButtonElement>(null);

  const instrument = catalog.instruments.find(item => item.id === market) ?? defaultInstrument;
  const data = instrumentData?.market === market ? instrumentData : undefined;
  const trading = tradeAccount?.id === accountId ? tradeAccount?.data : undefined;
  const position = positionData?.market === market && positionData.accountId === accountId ? positionData.position : undefined;
  const margin = Number(amount.replace(",", "."));
  const currentLeverage = Math.min(leverage, data?.maxLeverage ?? 1);
  const draft: OrderDraft = { side, margin, leverage: currentLeverage };

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    void tradeApi<TradeAccount>(accountId, "account", {}, controller.signal).then(data => {
      if (!controller.signal.aborted) setTradeAccount({ id: accountId, data });
    }, () => {
      if (!controller.signal.aborted) setTradeAccount({ id: accountId, data: { available: false, funding: false } });
    });
    return () => controller.abort();
  }, [accountId]);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    async function load() {
      try {
        if (document.visibilityState !== "visible" && timer !== undefined) return;
        const next = await readPerpetual(market, controller.signal);
        if (controller.signal.aborted) return;
        setInstrumentData(next);
        setFailedMarket(undefined);
        if (accountId && trading?.available) {
          const position = await readPosition(next, trading.address, controller.signal);
          if (!controller.signal.aborted) setPositionData({ accountId, market, position });
        }
      } catch {
        if (!controller.signal.aborted) setFailedMarket(market);
      } finally {
        if (!controller.signal.aborted) timer = window.setTimeout(() => void load(), 15_000);
      }
    }
    void load();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [market, refresh, accountId, trading]);

  function review(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!(margin > 0)) {
      const input = event.currentTarget.elements.namedItem("margin");
      if (input instanceof HTMLInputElement) {
        input.setCustomValidity("Enter a margin greater than zero.");
        input.reportValidity();
      }
      return;
    }
    setDialog("review");
  }

  function close() {
    const focus = dialog === "market" ? marketButton : dialog === "fund" ? fundsButton : dialog === "withdraw" ? withdrawButton : reviewButton;
    setDialog(undefined);
    requestAnimationFrame(() => focus.current?.focus());
  }

  const marketControl = <button ref={marketButton} type="button" className="trade-field" aria-haspopup="dialog"
    aria-label={`Market: ${marketLabel(instrument)}`} onClick={() => setDialog("market")}>
    <MarketIcon instrument={instrument.id === defaultInstrument.id && !instrument.glyph
      ? { ...instrument, glyph: defaultInstrument.glyph } : instrument} />
    <span>{marketLabel(instrument)}</span>
    <ChevronDown size={15} aria-hidden="true" className="trade-chevron" />
  </button>;

  return (
    <section className="trade-composer" aria-label="Trade perpetuals">
      <div className="trade-context">
        <span className="trade-venue">Hyperliquid <span aria-hidden="true">·</span> Mainnet</span>
      </div>
      {position ? <>
        <p className="trade-sentence">My <strong className={Number(position.szi) > 0 ? "trade-long" : "trade-short"}>{Number(position.szi) > 0 ? "long" : "short"}</strong> position in {marketControl} is worth {usd.format(Number(position.positionValue))} at {position.leverage.value}×.</p>
        <p className="trade-outcome">
          <span>Unrealized P&amp;L <strong>{usd.format(Number(position.unrealizedPnl))}</strong></span>
          {position.liquidationPx && <span>Liquidation <strong>{money(position.liquidationPx, instrument)}</strong></span>}
        </p>
        <button ref={reviewButton} type="button" className="action action-secondary trade-review-button" onClick={() => setDialog("close")}>Review close</button>
      </> : <form className="trade-form" onSubmit={review}>
        <p className="trade-sentence">
          <span>Open a{" "}
            <Select id="trade-side" label="Direction" pickerTitle="Choose direction" value={side} options={directions}
              onValueChange={setSide} className={`trade-field trade-${side}`} />{" "}on
          </span>{" "}
          <span>{marketControl} using</span>{" "}
          <span>
            <label className="trade-field trade-amount">
              <span className="sr-only">Margin in {data?.collateral ?? "US dollars"}</span>
              <span className="trade-currency" aria-hidden="true">{data?.collateral && data.collateral !== "USDC" ? data.collateral : "$"}</span>
              <input name="margin" inputMode="decimal" autoComplete="off" required pattern={amountPattern} placeholder="0"
                aria-describedby="trade-outcome" value={amount} style={{ width: `${Math.max(2, amount.length)}ch` }}
                onChange={event => {
                  event.currentTarget.setCustomValidity("");
                  if (amountDraft.test(event.target.value)) setAmount(event.target.value);
                }} />
            </label>{" "}in margin
          </span>{" "}
          <span>at{" "}
            <Select id="trade-leverage" label="Leverage" pickerTitle="Choose leverage" value={currentLeverage}
              options={Array.from({ length: data?.maxLeverage ?? 1 }, (_, index) => ({ value: index + 1, label: `${index + 1}×` }))}
              onValueChange={setLeverage} className="trade-field trade-number" />{" "}leverage.
          </span>
        </p>
        <p id="trade-outcome" className="trade-outcome">
          {margin > 0 && <span>About <strong>{usd.format(margin * currentLeverage)}</strong> in position size</span>}
          {data && <span>Mark <strong>{money(data.mark, instrument)}</strong></span>}
          {failedMarket === market && <button type="button" className="text-button" onClick={() => setRefresh(value => value + 1)}>Refresh market data</button>}
        </p>
        <button ref={reviewButton} type="submit" className="action action-primary trade-review-button">Review order</button>
      </form>}
      {accountId && trading?.available && <div className="flex flex-wrap justify-center gap-2">
        <button ref={fundsButton} type="button" className="action action-secondary" onClick={() => {
          setReturnToReview(false);
          setDialog("fund");
        }}>Add money</button>
        <button ref={withdrawButton} type="button" className="action action-secondary" onClick={() => setDialog("withdraw")}>Withdraw money</button>
      </div>}
      {dialog === "market" && <Dialog title="Choose a market" close={close}>
        <MarketPicker current={market} product="perp" catalog={{ ...catalog, instruments: catalog.instruments.filter(item => {
          const listing = hyperliquidMarket(item.id);
          return listing?.type === "perp" && !listing.coin.includes(":");
        }) }} select={next => {
          if (next !== market) setLeverage(1);
          selectMarket(next);
          close();
        }} />
      </Dialog>}
      {(dialog === "review" || dialog === "close") && !accountOpen && <TradeReview key={accountId} market={market} instrument={instrument} draft={draft}
        accountId={accountId} trading={trading} position={dialog === "close" ? position : undefined} openAccount={openAccount}
        onFund={() => { setReturnToReview(true); setDialog("fund"); }}
        close={close} onRefresh={() => setRefresh(value => value + 1)} />}
      {accountId && trading?.available && (dialog === "fund" || dialog === "withdraw") && <TradingFunds key={`${accountId}:${dialog}`} accountId={accountId}
        trading={trading} mode={dialog} returnToReview={dialog === "fund" && returnToReview} close={() => {
        setRefresh(value => value + 1);
        if (dialog === "fund" && returnToReview) setDialog("review");
        else close();
      }} />}
    </section>
  );
}
