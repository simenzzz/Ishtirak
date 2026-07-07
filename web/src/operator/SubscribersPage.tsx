import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";

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
import { subscriberStatusView } from "../lib/statusTone";
import type { Paginated, Subscriber, Tier } from "../lib/types";

export function SubscribersPage() {
  const { identity } = useAuth();
  const [search, setSearch] = useState("");
  const subscribers = usePaginated<Subscriber>("/subscribers", { params: { search } });
  const tiers = useFetch<Paginated<Tier>>("/tiers?limit=100");
  const isAdmin = identity?.role === "OPERATOR_ADMIN";
  const { sorted, sortKey, direction, toggleSort } = useSort<Subscriber, "name" | "meterId" | "status">(
    subscribers.data,
    "name",
  );

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Customer ledger" title="Subscribers" />
      {isAdmin ? <CreateSubscriberForm tiers={tiers.data?.data ?? []} onDone={subscribers.refetch} /> : null}
      <input
        aria-label="Search subscribers by name"
        placeholder="Search by name..."
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          subscribers.setPage(1);
        }}
      />
      <DataState
        loading={subscribers.loading}
        error={subscribers.error}
        isEmpty={sorted.length === 0}
        emptyMessage={search ? "No subscribers match that search." : "No subscribers yet — create one above."}
      >
        <DataTable>
          <table>
            <thead>
              <tr>
                <SortableTh label="Name" sortKey="name" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Meter" sortKey="meterId" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((subscriber) => {
                const view = subscriberStatusView(subscriber.status);
                return (
                  <tr key={subscriber.id}>
                    <td data-label="Name">{subscriber.name}</td>
                    <td className="tnum" data-label="Meter">{subscriber.meterId ?? "Unassigned"}</td>
                    <td data-label="Status"><Badge tone={view.tone}>{view.label}</Badge></td>
                    <td data-label=""><Link to={`/operator/subscribers/${subscriber.id}`}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      </DataState>
      <Pagination meta={subscribers.meta} onPageChange={subscribers.setPage} sortableColumns />
    </section>
  );
}

function CreateSubscriberForm({ tiers, onDone }: { readonly tiers: readonly Tier[]; readonly onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");
  const [meterId, setMeterId] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "success">("idle");

  useEffect(() => {
    if (!tierId && tiers[0]) setTierId(tiers[0].id);
  }, [tiers, tierId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name || !tierId) {
      setError("Name and tier are required.");
      return;
    }
    setStatus("busy");
    try {
      await apiRequest<Subscriber>("/subscribers", { method: "POST", body: { name, tierId, meterId: meterId || undefined } });
      setName("");
      setMeterId("");
      await onDone();
      setStatus("success");
      setTimeout(() => setStatus((current) => (current === "success" ? "idle" : current)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create subscriber.");
      setStatus("idle");
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Subscriber name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Tier
        <select value={tierId} onChange={(event) => setTierId(event.target.value)}>
          <option value="">Tier</option>
          {tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
        </select>
      </label>
      <label>
        Meter ID
        <input value={meterId} onChange={(event) => setMeterId(event.target.value)} />
      </label>
      <Button type="submit" disabled={status === "busy"}>
        {status === "busy" ? "Creating..." : "Create"}
      </Button>
      {error ? <p className="error">{error}</p> : null}
      {status === "success" ? <p className="success">Subscriber created.</p> : null}
    </form>
  );
}
