import { resolveHome } from "@/domain/home";
import { currentInstant } from "@/lib/clock/now";
import { loadHomeFacts } from "@/lib/home/load";
import { HomeView } from "./_components/HomeView";
import { SetupNotice } from "./_components/SetupNotice";
import { openAppGate } from "./_lib/gate";

export default async function HomePage() {
  const gate = await openAppGate();
  if (gate.kind === "not_configured") return <SetupNotice />;

  // The one clock read of the page (the real time, or the development clock). The facts, the resolver and the
  // refresher all work from this instant, so what is decided and what is shown cannot drift apart within a render.
  const now = currentInstant();
  const facts = await loadHomeFacts(gate.context, now);

  return <HomeView decision={resolveHome(facts)} timeZone={facts.timeZone} renderedAt={now.getTime()} />;
}
