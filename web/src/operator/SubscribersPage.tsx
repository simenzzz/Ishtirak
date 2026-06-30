import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { apiRequest } from "../lib/apiClient";
import { subscriberStatusView } from "../lib/statusTone";
import type { Subscriber, Tier } from "../lib/types";

export function SubscribersPage() {
  const { identity } = useAuth();
  const subscribers = usePaginated<Subscriber>("/subscribers");
  const tiers = useFetch<readonly Tier[]>("/tiers");
  const isAdmin = identity?.role === "OPERATOR_ADMIN";

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Customer ledger" title="Subscribers" />
      {isAdmin ? <CreateSubscriberForm tiers={tiers.data ?? []} onDone={subscribers.refetch} /> : null}
      <DataState loading={subscribers.loading} error={subscribers.error}>
        <DataTable>
          <table>
            <thead><tr><th>Name</th><th>Meter</th><th>Status</th><th /></tr></thead>
            <tbody>
              {subscribers.data.map((subscriber) => {
                const view = subscriberStatusView(subscriber.status);
                return (
                  <tr key={subscriber.id}>
                    <td>{subscriber.name}</td>
                    <td className="tnum">{subscriber.meterId ?? "Unassigned"}</td>
                    <td><Badge tone={view.tone}>{view.label}</Badge></td>
                    <td><Link to={`/operator/subscribers/${subscriber.id}`}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      </DataState>
    </section>
  );
}

function CreateSubscriberForm({ tiers, onDone }: { readonly tiers: readonly Tier[]; readonly onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [tierId, setTierId] = useState(tiers[0]?.id ?? "");
  const [meterId, setMeterId] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!name || !tierId) {
      setError("Name and tier are required.");
      return;
    }
    try {
      await apiRequest<Subscriber>("/subscribers", { method: "POST", body: { name, tierId, meterId: meterId || undefined } });
      setName("");
      setMeterId("");
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create subscriber.");
    }
  }

  return (
    <form className="inline-form" onSubmit={submit}>
      <input placeholder="Subscriber name" value={name} onChange={(event) => setName(event.target.value)} />
      <select value={tierId} onChange={(event) => setTierId(event.target.value)}>
        <option value="">Tier</option>
        {tiers.map((tier) => <option key={tier.id} value={tier.id}>{tier.name}</option>)}
      </select>
      <input placeholder="Meter ID" value={meterId} onChange={(event) => setMeterId(event.target.value)} />
      <button>Create</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
