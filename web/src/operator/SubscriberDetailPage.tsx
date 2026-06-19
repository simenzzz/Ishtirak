import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { apiRequest } from "../lib/apiClient";
import { formatDateTime } from "../lib/format";
import type { Reading, Subscriber } from "../lib/types";

export function SubscriberDetailPage() {
  const { id } = useParams();
  const { identity } = useAuth();
  const subscriber = useFetch<Subscriber>(id ? `/subscribers/${id}` : null);
  const readings = usePaginated<Reading>(`/subscribers/${id ?? "missing"}/readings`);
  const isAdmin = identity?.role === "OPERATOR_ADMIN";

  return (
    <section className="page-stack">
      <DataState loading={subscriber.loading} error={subscriber.error}>
        <header className="page-header">
          <div>
            <p className="eyebrow">Subscriber</p>
            <h2>{subscriber.data?.name}</h2>
          </div>
          <span className="badge">{subscriber.data?.status}</span>
        </header>
        {isAdmin && subscriber.data ? <PatchSubscriberForm subscriber={subscriber.data} onDone={subscriber.refetch} /> : null}
      </DataState>
      <RecordReadingForm subscriberId={id ?? ""} onDone={readings.refetch} />
      <DataState loading={readings.loading} error={readings.error}>
        <table>
          <thead><tr><th>Reading time</th><th>kWh</th></tr></thead>
          <tbody>
            {readings.data.map((reading) => (
              <tr key={reading.id}><td>{formatDateTime(reading.readingAt)}</td><td>{reading.kwh}</td></tr>
            ))}
          </tbody>
        </table>
      </DataState>
    </section>
  );
}

function PatchSubscriberForm({ subscriber, onDone }: { readonly subscriber: Subscriber; readonly onDone: () => Promise<void> }) {
  const [status, setStatus] = useState(subscriber.status);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest<Subscriber>(`/subscribers/${subscriber.id}`, { method: "PATCH", body: { status } });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update subscriber.");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <select value={status} onChange={(event) => setStatus(event.target.value as Subscriber["status"])}>
        <option value="ACTIVE">Active</option>
        <option value="INACTIVE">Inactive</option>
      </select>
      <button>Update subscriber</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}

export function RecordReadingForm({ subscriberId, onDone }: { readonly subscriberId?: string; readonly onDone?: () => Promise<void> }) {
  const [targetId, setTargetId] = useState(subscriberId ?? "");
  const [kwh, setKwh] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const value = Number(kwh);
    if (!targetId || !Number.isFinite(value) || value < 0) {
      setError("Enter a subscriber and a non-negative kWh value.");
      return;
    }
    try {
      await apiRequest<Reading>("/readings", { method: "POST", body: { subscriberId: targetId, kwh: value, readingAt: new Date().toISOString() } });
      setKwh("");
      await onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record reading.");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      {!subscriberId ? <input placeholder="Subscriber ID" value={targetId} onChange={(event) => setTargetId(event.target.value)} /> : null}
      <input placeholder="kWh" value={kwh} onChange={(event) => setKwh(event.target.value)} inputMode="decimal" />
      <button>Record reading</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
