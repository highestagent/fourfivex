import { Suspense } from "react";
import { notFound } from "next/navigation";
import { id } from "@fourfivex/markets-protocol/protocol";
import { RoomGate } from "@/components/markets/RoomGate";
import { ShellMessage } from "@/components/markets/shell";

async function Room({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  if (!id.safeParse(roomId).success) notFound();
  return <RoomGate key={roomId} roomId={roomId} />;
}

export default function RoomPage({ params }: PageProps<"/markets/[roomId]">) {
  return <Suspense fallback={<ShellMessage title="Opening room…" />}><Room params={params} /></Suspense>;
}
