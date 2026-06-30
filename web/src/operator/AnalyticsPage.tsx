import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { DataState } from "../components/DataState";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { StatCard } from "../components/ui/StatCard";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { formatDate, formatDual } from "../lib/format";
import type { CollectionRate, RiskFlag, WsEvent } from "../lib/types";

type Alert = Readonly<{ subscriberId: string; readingId: string; reason: string; score: number }>;

export function AnalyticsPage() {
  const collection = useFetch<readonly CollectionRate[]>("/analytics/collection-rate");
  const risk = usePaginated<RiskFlag>("/analytics/risk");
  return (
    <section className="page-stack">
      <PageHeader eyebrow="Revenue and risk" title="Analytics" />
      <AlertsFeed />
      <DataState loading={collection.loading} error={collection.error}>
        <div className="card-grid">
          {(collection.data ?? []).map((item) => (
            <StatCard
              key={`${item.periodStart}-${item.periodEnd}`}
              value={`${Math.round(item.rate * 100)}%`}
              label={`${formatDate(item.periodStart)} - ${formatDate(item.periodEnd)}`}
              lines={[
                `Issued ${formatDual(item.issuedUsd, item.issuedLbp)}`,
                `Collected ${formatDual(item.collectedUsd, item.collectedLbp)}`,
              ]}
            />
          ))}
        </div>
      </DataState>
      <DataState loading={risk.loading} error={risk.error}>
        <DataTable>
          <table>
            <thead><tr><th>Subscriber</th><th>Reason</th><th>Score</th></tr></thead>
            <tbody>{risk.data.map((flag) => (
              <tr key={flag.readingId}><td>{flag.subscriberId}</td><td>{flag.reason}</td><td className="tnum">{Math.round(flag.score * 100)}%</td></tr>
            ))}</tbody>
          </table>
        </DataTable>
      </DataState>
    </section>
  );
}

export function AlertsFeed() {
  const [alerts, setAlerts] = useState<readonly Alert[]>([]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<WsEvent>).detail;
      if (detail.type === "tampering.alert") {
        setAlerts((current) => [detail.data, ...current].slice(0, 8));
      }
    };
    window.addEventListener("ishtirak:ws", listener);
    return () => window.removeEventListener("ishtirak:ws", listener);
  }, []);
  return (
    <section className="live-strip" data-testid="tampering-alerts">
      <strong><TriangleAlert size={15} aria-hidden />Live tampering alerts</strong>
      {alerts.length === 0 ? <span>No alerts received in this session</span> : alerts.map((alert) => (
        <span key={alert.readingId}>{alert.reason} · {Math.round(alert.score * 100)}% · {alert.subscriberId}</span>
      ))}
    </section>
  );
}
