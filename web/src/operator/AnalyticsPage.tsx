import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { DataState } from "../components/DataState";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SortableTh } from "../components/ui/SortableTh";
import { Sparkline } from "../components/ui/Sparkline";
import { StatCard } from "../components/ui/StatCard";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { useSort } from "../hooks/useSort";
import { formatDate, formatDual } from "../lib/format";
import type { CollectionRate, RiskFlag, WsEvent } from "../lib/types";

type Alert = Readonly<{ subscriberId: string; readingId: string; reason: string; score: number }>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseMinScorePercent(value: string): number | undefined {
  const percent = Number(value);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return undefined;
  return percent / 100;
}

export function AnalyticsPage() {
  const collection = useFetch<readonly CollectionRate[]>("/analytics/collection-rate");
  const [subscriberId, setSubscriberId] = useState("");
  const [minScorePercent, setMinScorePercent] = useState("");
  const risk = usePaginated<RiskFlag>("/analytics/risk", {
    params: {
      subscriberId: UUID_PATTERN.test(subscriberId) ? subscriberId : undefined,
      minScore: parseMinScorePercent(minScorePercent),
    },
  });
  const { sorted, sortKey, direction, toggleSort } = useSort<RiskFlag, "subscriberId" | "reason" | "score">(
    risk.data,
    "score",
  );

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Revenue and risk" title="Analytics" />
      <AlertsFeed />
      <DataState loading={collection.loading} error={collection.error}>
        {collection.data && collection.data.length > 1 ? (
          <p className="status-line">
            Collection rate trend <Sparkline values={collection.data.map((item) => item.rate)} />
          </p>
        ) : null}
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
      <div className="inline-form">
        <label>
          Subscriber ID
          <input
            placeholder="Filter by subscriber ID"
            value={subscriberId}
            onChange={(event) => {
              setSubscriberId(event.target.value);
              risk.setPage(1);
            }}
          />
        </label>
        <label>
          Min score %
          <input
            placeholder="0-100"
            inputMode="numeric"
            value={minScorePercent}
            onChange={(event) => {
              setMinScorePercent(event.target.value);
              risk.setPage(1);
            }}
          />
        </label>
      </div>
      <DataState
        loading={risk.loading}
        error={risk.error}
        isEmpty={sorted.length === 0}
        emptyMessage="No risk flags match these filters."
      >
        <DataTable>
          <table>
            <thead>
              <tr>
                <SortableTh label="Subscriber" sortKey="subscriberId" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Reason" sortKey="reason" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Score" sortKey="score" activeKey={sortKey} direction={direction} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>{sorted.map((flag) => (
              <tr key={flag.readingId}>
                <td data-label="Subscriber">{flag.subscriberId}</td>
                <td data-label="Reason">{flag.reason}</td>
                <td className="tnum" data-label="Score">{Math.round(flag.score * 100)}%</td>
              </tr>
            ))}</tbody>
          </table>
        </DataTable>
      </DataState>
      <Pagination meta={risk.meta} onPageChange={risk.setPage} sortableColumns />
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
    <section className="live-strip" data-testid="tampering-alerts" aria-live="polite">
      <strong><TriangleAlert size={15} aria-hidden />Live tampering alerts</strong>
      {alerts.length === 0 ? <span>No alerts received in this session</span> : alerts.map((alert) => (
        <span key={alert.readingId}>{alert.reason} · {Math.round(alert.score * 100)}% · {alert.subscriberId}</span>
      ))}
    </section>
  );
}
