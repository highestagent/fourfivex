/**
 * The NEAR Intents explorer's page for a send: its deposit, processing and delivery, found by the send's
 * deposit address. Every send has one, whatever networks it touches, unlike the per-chain links 1Click
 * reports, which can come back without a URL.
 */
export const sendPage = (depositAddress: string) =>
  `https://explorer.near-intents.org/transactions/${encodeURIComponent(depositAddress)}`;

/** Every deposit address of a send: its parts when split across networks, otherwise its own. */
export const sendAddresses = (send: { id: string; legs?: readonly string[] }) => (send.legs?.length ? send.legs : [send.id]);
