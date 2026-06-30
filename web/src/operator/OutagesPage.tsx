import { FormEvent, useState } from "react";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { PageHeader } from "../components/ui/PageHeader";
import { useFetch } from "../hooks/useFetch";
import { apiRequest } from "../lib/apiClient";
import { formatDateTime } from "../lib/format";
import type { Outage } from "../lib/types";

export function OutagesPage() {
  const { identity } = useAuth();
  const outages = useFetch<readonly Outage[]>("/outages");
  return (
    <section className="page-stack">
      <PageHeader eyebrow="Load shedding" title="Outages" />
      {identity?.role === "OPERATOR_ADMIN" ? <ScheduleOutageForm onDone={outages.refetch} /> : null}
      <DataState loading={outages.loading} error={outages.error}>
        <div className="card-grid">
          {(outages.data ?? []).map((outage) => (
            <article className="metric-card" key={outage.id}>
              <strong>{outage.reason}</strong>
              <span>{formatDateTime(outage.startsAt)}</span>
              <small>Ends {formatDateTime(outage.endsAt)}</small>
            </article>
          ))}
        </div>
      </DataState>
    </section>
  );
}

function ScheduleOutageForm({ onDone }: { readonly onDone: () => Promise<void> }) {
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState<Outage["reason"]>("FUEL");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const starts = new Date(startsAt);
    const ends = new Date(endsAt);
    if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) {
      setError("Enter a valid outage window.");
      return;
    }
    await apiRequest<Outage>("/outages", {
      method: "POST",
      body: { startsAt: starts.toISOString(), endsAt: ends.toISOString(), reason },
    });
    await onDone();
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
      <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
      <select value={reason} onChange={(event) => setReason(event.target.value as Outage["reason"])}>
        <option>FUEL</option><option>MAINTENANCE</option><option>GRID</option><option>OTHER</option>
      </select>
      <button>Schedule outage</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
