import { sendPage } from "@/lib/send/explorer";

/** "View transaction", or one numbered link per part of a send split across networks. */
export function SendLinks({ addresses, className = "" }: { addresses: readonly string[]; className?: string }) {
  return addresses.map((address, index) => (
    <a key={address} href={sendPage(address)} target="_blank" rel="noreferrer" className={`text-blue underline underline-offset-2 ${className}`}>
      {addresses.length === 1 ? "View transaction" : `View transaction ${index + 1}`}
    </a>
  ));
}
