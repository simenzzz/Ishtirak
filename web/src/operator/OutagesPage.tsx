import { FormEvent, useMemo, useState } from "react";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { usePaginated } from "../hooks/usePaginated";
import { apiRequest } from "../lib/apiClient";
import { formatDateTime } from "../lib/format";
import type { Outage } from "../lib/types";

export function OutagesPage() {
  const { identity } = useAuth();
  const outages = usePaginated<Outage>("/outages", { limit: 100 });
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return outages.data;
    return outages.data.filter((outage) => outage.reason.toLowerCase().includes(query));
  }, [outages.data, filter]);

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Load shedding" title="Outages" />
      {identity?.role === "OPERATOR_ADMIN" ? <ScheduleOutageForm onDone={outages.refetch} /> : null}
      <input
        aria-label="Filter outages by reason"
        placeholder="Filter by reason..."
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <DataState
        loading={outages.loading}
        error={outages.error}
        isEmpty={filtered.length === 0}
        emptyMessage={filter ? "No outages match that filter." : "No outages scheduled yet."}
      >
        <div className="card-grid">
          {filtered.map((outage) => (
            <article className="metric-card" key={outage.id}>
              <strong>{outage.reason}</strong>
              <span>{formatDateTime(outage.startsAt)}</span>
              <small>Ends {formatDateTime(outage.endsAt)}</small>
            </article>
          ))}
        </div>
      </DataState>
      <Pagination meta={outages.meta} onPageChange={outages.setPage} />
    </section>
  );
}

function ScheduleOutageForm({ onDone }: { readonly onDone: () => Promise<void> }) {
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState<Outage["reason"]>("FUEL");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "success">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const starts = new Date(startsAt);
    const ends = new Date(endsAt);
    if (!Number.isFinite(starts.getTime()) || !Number.isFinite(ends.getTime()) || ends <= starts) {
      setError("Enter a valid outage window.");
      return;
    }
    setStatus("busy");
    try {
      await apiRequest<Outage>("/outages", {
        method: "POST",
        body: { startsAt: starts.toISOString(), endsAt: ends.toISOString(), reason },
      });
      await onDone();
      setStatus("success");
      setTimeout(() => setStatus((current) => (current === "success" ? "idle" : current)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not schedule outage.");
      setStatus("idle");
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Starts
        <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
      </label>
      <label>
        Ends
        <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
      </label>
      <label>
        Reason
        <select value={reason} onChange={(event) => setReason(event.target.value as Outage["reason"])}>
          <option>FUEL</option><option>MAINTENANCE</option><option>GRID</option><option>OTHER</option>
        </select>
      </label>
      <Button type="submit" disabled={status === "busy"}>
        {status === "busy" ? "Scheduling..." : "Schedule outage"}
      </Button>
      {error ? <p className="error">{error}</p> : null}
      {status === "success" ? <p className="success">Outage scheduled.</p> : null}
    </form>
  );
}
