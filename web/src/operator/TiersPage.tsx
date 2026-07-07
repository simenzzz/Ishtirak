import { Zap } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { useAuth } from "../auth/useAuth";
import { DataState } from "../components/DataState";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { usePaginated } from "../hooks/usePaginated";
import { apiRequest } from "../lib/apiClient";
import { formatDual } from "../lib/format";
import type { TariffPolicy, Tier } from "../lib/types";

export function TiersPage() {
  const { identity } = useAuth();
  const tiers = usePaginated<Tier>("/tiers", { limit: 100 });
  const isAdmin = identity?.role === "OPERATOR_ADMIN";
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return tiers.data;
    return tiers.data.filter((tier) => tier.name.toLowerCase().includes(query));
  }, [tiers.data, filter]);

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Tariff book" title="Tiers" />
      {isAdmin ? <TierForm onDone={tiers.refetch} /> : null}
      <input
        aria-label="Filter tiers by name"
        placeholder="Filter by name..."
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />
      <DataState
        loading={tiers.loading}
        error={tiers.error}
        isEmpty={filtered.length === 0}
        emptyMessage={filter ? "No tiers match that filter." : "No tiers yet — create one above."}
      >
        <div className="card-grid">
          {filtered.map((tier) => (
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
      <Pagination meta={tiers.meta} onPageChange={tiers.setPage} />
    </section>
  );
}

function TierForm({ onDone }: { readonly onDone: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [amperage, setAmperage] = useState("10");
  const [policy, setPolicy] = useState<TariffPolicy>("HYBRID");
  const [standingFeeUsd, setStandingFeeUsd] = useState("0");
  const [standingFeeLbp, setStandingFeeLbp] = useState("0");
  const [perKwhRateUsd, setPerKwhRateUsd] = useState("0");
  const [perKwhRateLbp, setPerKwhRateLbp] = useState("0");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "success">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const rates = [standingFeeUsd, standingFeeLbp, perKwhRateUsd, perKwhRateLbp].map(Number);
    if (rates.some((value) => !Number.isFinite(value) || value < 0)) {
      setError("Rates must be numbers >= 0.");
      return;
    }
    setStatus("busy");
    try {
      await apiRequest<Tier>("/tiers", {
        method: "POST",
        body: {
          name,
          amperage: Number(amperage),
          tariffPolicyOverride: policy,
          standingFeeUsd: rates[0],
          standingFeeLbp: rates[1],
          perKwhRateUsd: rates[2],
          perKwhRateLbp: rates[3],
        },
      });
      setName("");
      await onDone();
      setStatus("success");
      setTimeout(() => setStatus((current) => (current === "success" ? "idle" : current)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create tier.");
      setStatus("idle");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Tier name
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        Amps
        <input value={amperage} onChange={(event) => setAmperage(event.target.value)} inputMode="numeric" />
      </label>
      <label>
        Tariff policy
        <select value={policy} onChange={(event) => setPolicy(event.target.value as TariffPolicy)}>
          <option value="FLAT">Flat</option><option value="METERED">Metered</option><option value="HYBRID">Hybrid</option>
        </select>
      </label>
      <label>
        Standing fee (USD)
        <input value={standingFeeUsd} onChange={(event) => setStandingFeeUsd(event.target.value)} inputMode="decimal" />
      </label>
      <label>
        Standing fee (LBP)
        <input value={standingFeeLbp} onChange={(event) => setStandingFeeLbp(event.target.value)} inputMode="numeric" />
      </label>
      <label>
        Per-kWh rate (USD)
        <input value={perKwhRateUsd} onChange={(event) => setPerKwhRateUsd(event.target.value)} inputMode="decimal" />
      </label>
      <label>
        Per-kWh rate (LBP)
        <input value={perKwhRateLbp} onChange={(event) => setPerKwhRateLbp(event.target.value)} inputMode="numeric" />
      </label>
      <Button type="submit" disabled={status === "busy"}>
        {status === "busy" ? "Creating..." : "Create tier"}
      </Button>
      {error ? <p className="error">{error}</p> : null}
      {status === "success" ? <p className="success">Tier created.</p> : null}
    </form>
  );
}
