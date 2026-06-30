import { Zap } from "lucide-react";
import { FormEvent, useState } from "react";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { PageHeader } from "../components/ui/PageHeader";
import { useFetch } from "../hooks/useFetch";
import { apiRequest } from "../lib/apiClient";
import { formatDual } from "../lib/format";
import type { TariffPolicy, Tier } from "../lib/types";

export function TiersPage() {
  const { identity } = useAuth();
  const tiers = useFetch<readonly Tier[]>("/tiers");
  const isAdmin = identity?.role === "OPERATOR_ADMIN";
  return (
    <section className="page-stack">
      <PageHeader eyebrow="Tariff book" title="Tiers" />
      {isAdmin ? <TierForm onDone={tiers.refetch} /> : null}
      <DataState loading={tiers.loading} error={tiers.error}>
        <div className="card-grid">
          {(tiers.data ?? []).map((tier) => (
            <article className="metric-card" key={tier.id}>
              <div className="tier-card__head">
                <strong>{tier.name}</strong>
                <span className="amp-chip"><Zap aria-hidden />{tier.amperage} A</span>
              </div>
              <span className="muted">{tier.effectiveTariffPolicy}</span>
              <small>Standing {formatDual(tier.standingFeeUsd, tier.standingFeeLbp)}</small>
              <small>Per kWh {formatDual(tier.perKwhRateUsd, tier.perKwhRateLbp)}</small>
            </article>
          ))}
        </div>
      </DataState>
    </section>
  );
}

function TierForm({ onDone }: { readonly onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [amperage, setAmperage] = useState("10");
  const [policy, setPolicy] = useState<TariffPolicy>("HYBRID");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await apiRequest<Tier>("/tiers", {
        method: "POST",
        body: {
          name,
          amperage: Number(amperage),
          tariffPolicyOverride: policy,
          standingFeeUsd: 0,
          standingFeeLbp: 0,
          perKwhRateUsd: 0,
          perKwhRateLbp: 0,
        },
      });
      setName("");
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create tier.");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <input placeholder="Tier name" value={name} onChange={(event) => setName(event.target.value)} />
      <input placeholder="Amps" value={amperage} onChange={(event) => setAmperage(event.target.value)} inputMode="numeric" />
      <select value={policy} onChange={(event) => setPolicy(event.target.value as TariffPolicy)}>
        <option value="FLAT">Flat</option><option value="METERED">Metered</option><option value="HYBRID">Hybrid</option>
      </select>
      <button>Create tier</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
