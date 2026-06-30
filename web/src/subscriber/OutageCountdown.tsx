import { useEffect, useMemo, useState } from "react";

import { DataState } from "../components/DataState";
import { PageHeader } from "../components/ui/PageHeader";
import { useCountdown, type CountdownSeed } from "../hooks/useCountdown";
import { useFetch } from "../hooks/useFetch";
import { formatDateTime, secondsToClock } from "../lib/format";
import type { Outage, WsEvent } from "../lib/types";

export function OutageCountdown() {
  const outages = useFetch<readonly Outage[]>("/outages");
  const snapshotSeed = useMemo(() => {
    const now = Date.now();
    const active = (outages.data ?? []).find((outage) => new Date(outage.endsAt).getTime() > now);
    return active ? { startsAt: active.startsAt, endsAt: active.endsAt } : null;
  }, [outages.data]);
  const [liveSeed, setLiveSeed] = useState<CountdownSeed | null>(null);
  const seed = liveSeed ?? snapshotSeed;
  const seconds = useCountdown(seed);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<WsEvent>).detail;
      if (detail.type === "outage.countdown") setLiveSeed(detail.data);
    };
    window.addEventListener("ishtirak:ws", listener);
    return () => window.removeEventListener("ishtirak:ws", listener);
  }, []);

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Live outage" title="Countdown" />
      <DataState loading={outages.loading} error={outages.error}>
        {seed ? (
          <article className="countdown-panel" data-testid="outage-countdown">
            <strong>{secondsToClock(seconds)}</strong>
            <span>{formatDateTime(seed.startsAt)} - {formatDateTime(seed.endsAt)}</span>
          </article>
        ) : <p className="status-line">No scheduled outage is active.</p>}
      </DataState>
    </section>
  );
}
