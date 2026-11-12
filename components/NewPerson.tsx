"use client";

import { useState } from "react";
import { addressProblem, familyOf } from "@/lib/send/address";
import { people, type Person } from "@/lib/send/people";
import { NETWORKS, NETWORK_NAME, type Network } from "@/lib/send/types";
import { Panel } from "./ui";

export const LABEL = "mono mb-2 block text-ink-3";
export const INPUT =
  "h-11 w-full rounded-[12px] bg-card px-3.5 text-[15px] outline-none placeholder:text-ink-3 focus:ring-2 focus:ring-blue";

const PLACEHOLDER: Record<Network, string> = {
  base: "0x…",
  eth: "0x…",
  arb: "0x…",
  sol: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
  near: "name.near",
};

/** A recipient not saved yet: a name, the network they use and their address. Kept on this device only. */
export function NewPerson({ onSave, onCancel }: { onSave: (p: Person) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<Network>("base");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const who = name.trim();
    if (!who) return setError("Give them a name.");
    const problem = addressProblem(familyOf(network)!, address.trim());
    if (problem) return setError(problem);
    try {
      onSave(people.add({ name: who, address: address.trim(), network }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "That could not be saved.");
    }
  };
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };

  return (
    <Panel className="animate-rise p-5">
      <p className="mono text-ink-3">Someone new</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label className={LABEL} htmlFor="person-name">
            Name
          </label>
          <input
            id="person-name"
            className={INPUT}
            placeholder="Maya"
            maxLength={24}
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={enter}
          />
        </div>
        <div>
          <span className={LABEL} id="person-network-label">
            Their network
          </span>
          <div role="radiogroup" aria-labelledby="person-network-label" id="person-network" className="flex flex-wrap gap-2">
            {NETWORKS.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={network === n}
                className={`h-9 cursor-pointer rounded-full px-3.5 text-[13.5px] font-medium ${
                  network === n ? "bg-ink text-white" : "bg-card text-ink-2"
                }`}
                onClick={() => {
                  setNetwork(n);
                  setError(null);
                }}
              >
                {NETWORK_NAME[n]}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={LABEL} htmlFor="person-address">
            Their address on {NETWORK_NAME[network]}
          </label>
          <input
            id="person-address"
            className={`${INPUT} font-mono text-[13px]`}
            placeholder={PLACEHOLDER[network]}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setError(null);
            }}
            onKeyDown={enter}
          />
        </div>
      </div>
      <p className="mt-3 min-h-5 text-[13.5px] text-rose" aria-live="polite">
        {error}
      </p>
      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={save}
          className="inline-flex h-10 cursor-pointer items-center rounded-full bg-ink px-5 text-[14px] font-medium text-white shadow-pill"
        >
          Save and use
        </button>
        <button type="button" onClick={onCancel} className="h-10 cursor-pointer rounded-full bg-white px-5 text-[14px] font-medium shadow-chip">
          Cancel
        </button>
      </div>
      <p className="mt-4 text-[13px] leading-snug text-ink-3">
        Kept on this device only. Check the address with them first: a payment to a wrong address cannot be brought back.
      </p>
    </Panel>
  );
}
