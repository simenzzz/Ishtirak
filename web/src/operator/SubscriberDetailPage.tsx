import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SortableTh } from "../components/ui/SortableTh";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { useSort } from "../hooks/useSort";
import { apiRequest } from "../lib/apiClient";
import { formatDateTime } from "../lib/format";
import { subscriberStatusView } from "../lib/statusTone";
import type { Reading, Subscriber } from "../lib/types";

export function SubscriberDetailPage() {
  const { id } = useParams();
  const { identity } = useAuth();
  const subscriber = useFetch<Subscriber>(id ? `/subscribers/${id}` : null);
  const readings = usePaginated<Reading>(`/subscribers/${id ?? "missing"}/readings`);
  const isAdmin = identity?.role === "OPERATOR_ADMIN";
  const statusView = subscriberStatusView(subscriber.data?.status);
  const { sorted, sortKey, direction, toggleSort } = useSort<Reading, "readingAt" | "kwh">(readings.data, "readingAt");

  return (
    <section className="page-stack">
      <DataState loading={subscriber.loading} error={subscriber.error}>
        <PageHeader
          eyebrow="Subscriber"
          title={subscriber.data?.name}
          actions={<Badge tone={statusView.tone}>{statusView.label}</Badge>}
        />
        {isAdmin && subscriber.data ? <PatchSubscriberForm subscriber={subscriber.data} onDone={subscriber.refetch} /> : null}
      </DataState>
      <RecordReadingForm subscriberId={id ?? ""} onDone={readings.refetch} />
      <DataState
        loading={readings.loading}
        error={readings.error}
        isEmpty={sorted.length === 0}
        emptyMessage="No meter readings recorded yet."
      >
        <DataTable>
          <table>
            <thead>
              <tr>
                <SortableTh label="Reading time" sortKey="readingAt" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="kWh" sortKey="kwh" activeKey={sortKey} direction={direction} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {sorted.map((reading) => (
                <tr key={reading.id}>
                  <td data-label="Reading time">{formatDateTime(reading.readingAt)}</td>
                  <td className="tnum" data-label="kWh">{reading.kwh}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </DataState>
      <Pagination meta={readings.meta} onPageChange={readings.setPage} sortableColumns />
    </section>
  );
}

function PatchSubscriberForm({ subscriber, onDone }: { readonly subscriber: Subscriber; readonly onDone: () => Promise<void> }) {
  const [status, setStatus] = useState(subscriber.status);
  const [error, setError] = useState("");
  const [formStatus, setFormStatus] = useState<"idle" | "busy" | "success">("idle");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setFormStatus("busy");
    try {
      await apiRequest<Subscriber>(`/subscribers/${subscriber.id}`, { method: "PATCH", body: { status } });
      await onDone();
      setFormStatus("success");
      setTimeout(() => setFormStatus((current) => (current === "success" ? "idle" : current)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update subscriber.");
      setFormStatus("idle");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value as Subscriber["status"])}>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </label>
      <Button type="submit" disabled={formStatus === "busy"}>
        {formStatus === "busy" ? "Updating..." : "Update subscriber"}
      </Button>
      {error ? <p className="error">{error}</p> : null}
      {formStatus === "success" ? <p className="success">Subscriber updated.</p> : null}
    </form>
  );
}

export function RecordReadingForm({ subscriberId, onDone }: { readonly subscriberId?: string; readonly onDone?: () => Promise<void> }) {
  const [targetId, setTargetId] = useState(subscriberId ?? "");
  const [kwh, setKwh] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "success">("idle");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const value = Number(kwh);
    if (!targetId || !Number.isFinite(value) || value < 0) {
      setError("Enter a subscriber and a non-negative kWh value.");
      return;
    }
    setStatus("busy");
    try {
      await apiRequest<Reading>("/readings", { method: "POST", body: { subscriberId: targetId, kwh: value, readingAt: new Date().toISOString() } });
      setKwh("");
      await onDone?.();
      setStatus("success");
      setTimeout(() => setStatus((current) => (current === "success" ? "idle" : current)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record reading.");
      setStatus("idle");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      {!subscriberId ? (
        <label>
          Subscriber ID
          <input value={targetId} onChange={(event) => setTargetId(event.target.value)} />
        </label>
      ) : null}
      <label>
        kWh
        <input value={kwh} onChange={(event) => setKwh(event.target.value)} inputMode="decimal" />
      </label>
      <Button type="submit" disabled={status === "busy"}>
        {status === "busy" ? "Recording..." : "Record reading"}
      </Button>
      {error ? <p className="error">{error}</p> : null}
      {status === "success" ? <p className="success">Reading recorded.</p> : null}
    </form>
  );
}
