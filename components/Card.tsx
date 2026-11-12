"use client";

import { useRef } from "react";
import type { Prices } from "@/lib/assets";
import { useAutoLoop, useInView } from "@/lib/hooks";
import { plain, type Verb } from "@/lib/verbs";
import { STAGES } from "./stages";
import { Arrow } from "./ui";

/**
 * One capability. The top half demonstrates itself; the bottom half says what it is for.
 * The whole card is the way in: tapping it opens the same sentence, ready to change and sign.
 */
export function Card({
  verb,
  prices,
  paused,
  onOpen,
}: {
  verb: Verb;
  prices: Prices;
  paused: boolean;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const inView = useInView(ref);
  const loop = useAutoLoop(inView && !paused, verb.loop);
  const Stage = STAGES[verb.key];
  const vals = verb.demo ?? verb.def;

  return (
    <article
      ref={ref}
      className="group relative flex min-w-0 flex-col rounded-[28px] bg-card transition-colors duration-300 hover:bg-[#efeff1]"
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-10 cursor-pointer rounded-[28px]"
        aria-label={`${verb.title}. Open the sentence: ${plain(verb, verb.def, { prices, holdings: null, people: [] })}`}
      />
      <span
        className="absolute right-4 top-4 z-0 grid size-8 place-items-center rounded-full bg-white text-ink-3 shadow-chip transition-all duration-300 group-hover:bg-ink group-hover:text-white"
        aria-hidden="true"
      >
        <Arrow size={14} />
      </span>
      <div className="pointer-events-none h-[318px] px-5 pb-1 pt-7 sm:px-7" aria-hidden="true">
        <Stage
          state={loop.state}
          cycle={loop.cycle}
          vals={vals}
          prices={prices}
          quote={{ status: "none" }}
          live={false}
        />
      </div>
      <div className="px-7 pb-9 pt-5 text-center">
        <h2 className="text-[17px] font-medium tracking-[-0.01em]">{verb.title}</h2>
        <div className="mx-auto my-4 h-px w-44 bg-line" />
        <p className="mx-auto max-w-[36ch] text-[14.5px] leading-[1.55] text-ink-2 text-pretty">{verb.blurb}</p>
      </div>
    </article>
  );
}
