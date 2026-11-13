"use client";

import { useState, type FormEvent } from "react";
import { addressProblem, familyOf } from "@/lib/send/address";
import { people, type Person } from "@/lib/send/people";
import { NETWORKS, NETWORK_NAME, type Network } from "@/lib/send/types";

export function NewPerson({ onSave, onCancel }: { onSave: (person: Person) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<Network>("base");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const who = name.trim();
    const destination = address.trim();
    if (!who) return setError("Enter a recipient name.");
    const problem = addressProblem(familyOf(network)!, destination);
    if (problem) return setError(problem);
    try {
      onSave(people.add({ name: who, address: destination, network }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The recipient could not be saved.");
    }
  };

  return (
    <form onSubmit={save} className="grid gap-4 rounded-[18px] border border-line bg-white p-4 sm:grid-cols-2 sm:p-5">
      <label className="grid gap-2 text-sm font-medium">
        Recipient name
        <input className="field" autoComplete="off" maxLength={24} value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Network
        <select className="field" value={network} onChange={(event) => setNetwork(event.target.value as Network)}>
          {NETWORKS.map((value) => <option key={value} value={value}>{NETWORK_NAME[value]}</option>)}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium sm:col-span-2">
        Address on {NETWORK_NAME[network]}
        <input
          className="field font-mono"
          autoComplete="off"
          spellCheck={false}
          autoCapitalize="off"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          required
        />
      </label>
      {error && <p role="alert" className="text-sm text-rose sm:col-span-2">{error}</p>}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button className="action action-primary" type="submit">Use recipient</button>
        <button className="action action-secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
