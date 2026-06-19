import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { apiRequest } from "../lib/apiClient";
import type { Subscriber, Tier } from "../lib/types";

export function SubscribersPage() {
  const { identity } = useAuth();
  const subscribers = usePaginated<Subscriber>("/subscribers");
  const tiers = useFetch<readonly Tier[]>("/tiers");
  const isAdmin = identity?.role === "OPERATOR_ADMIN";

  return (
    <section className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Customer ledger</p>
          <h2>Subscribers</h2>
        </div>
      </header>
      {isAdmin ? <CreateSubscriberForm tiers={tiers.data ?? []} onDone={subscribers.refetch} /> : null}
      <DataState loading={subscribers.loading} error={subscribers.error}>
        <table>
          <thead><tr><th>Name</th><th>Meter</th><th>Status</th><th /></tr></thead>
          <tbody>
            {subscribers.data.map((subscriber) => (
              <tr key={subscriber.id}>
                <td>{subscriber.name}</td>
                <td>{subscriber.meterId ?? "Unassigned"}</td>
                <td>{subscriber.status}</td>
                <td><Link to={`/operator/subscribers/${subscriber.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
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
