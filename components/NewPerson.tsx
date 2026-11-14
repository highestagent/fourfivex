"use client";

import { useId, useState, type SubmitEvent } from "react";
import { addressProblem, familyOf } from "@/lib/send/address";
import { people, type Person } from "@/lib/send/people";
import { NETWORKS, NETWORK_NAME, type Network } from "@/lib/send/types";
import { Select } from "./Select";

const NETWORK_OPTIONS = NETWORKS.map((value) => ({ value, label: NETWORK_NAME[value] }));

export function NewPerson({ onSave, onCancel }: { onSave: (person: Person) => void; onCancel?: () => void }) {
  const [name, setName] = useState("");
  const [network, setNetwork] = useState<Network>("base");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const networkId = useId();

  const save = (event: SubmitEvent<HTMLFormElement>) => {
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
    <form onSubmit={save} className="grid gap-4 rounded-[18px] border border-line bg-surface p-4 sm:grid-cols-2 sm:p-5">
      <label className="grid gap-2 text-sm font-medium">
        Recipient name
        <input name="recipient-name" className="field" autoComplete="off" maxLength={24} value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <div className="grid gap-2 text-sm font-medium">
        <label htmlFor={networkId} id={`${networkId}-label`}>Network</label>
        <Select
          id={networkId}
          name="recipient-network"
          labelledBy={`${networkId}-label`}
          pickerTitle="Choose a network"
          value={network}
          options={NETWORK_OPTIONS}
          onValueChange={(value) => {
            setNetwork(value);
            setError(null);
          }}
          className="field w-full"
        />
      </div>
      <label className="grid gap-2 text-sm font-medium sm:col-span-2">
        Address on {NETWORK_NAME[network]}
        <input
          name="recipient-address"
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
        <button className="action action-primary max-sm:w-full" type="submit">Use recipient</button>
        {onCancel && <button className="action action-secondary" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
