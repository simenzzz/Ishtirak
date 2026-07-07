import { useEffect } from "react";

import { DataState } from "../components/DataState";
import { PageHeader } from "../components/ui/PageHeader";
import { usePaginated } from "../hooks/usePaginated";
import { formatDate, formatDual } from "../lib/format";
import { invoiceStatusView } from "../lib/statusTone";
import type { Invoice, WsEvent } from "../lib/types";

function headline(invoice: Invoice) {
  if (invoice.status === "NEEDS_REVIEW" || invoice.status === "VOID") return invoiceStatusView(invoice.status).label;
  return formatDual(invoice.amountUsd, invoice.amountLbp);
}

export function CurrentBillPage() {
  const invoices = usePaginated<Invoice>("/me/invoices", { limit: 5 });
  const current = invoices.data[0];
  const { refetch } = invoices;

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<WsEvent>).detail;
      if (detail.type === "invoice.ready" || detail.type === "invoice.updated") void refetch();
    };
    window.addEventListener("ishtirak:ws", listener);
    return () => window.removeEventListener("ishtirak:ws", listener);
  }, [refetch]);

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Current bill" title="Latest invoice" />
      <DataState loading={invoices.loading} error={invoices.error}>
        {current ? (
          <article className="bill-panel" data-testid="current-bill">
            <strong>{headline(current)}</strong>
            <span>{formatDate(current.periodStart)} - {formatDate(current.periodEnd)}</span>
            <small>{current.kwhConsumed} kWh · {invoiceStatusView(current.status).label}</small>
          </article>
        ) : <p className="status-line">No invoices yet.</p>}
        <div className="card-grid">
          {invoices.data.slice(1).map((invoice) => (
            <article className="metric-card" key={invoice.id}>
              <strong>{headline(invoice)}</strong>
              <span>{invoiceStatusView(invoice.status).label}</span>
            </article>
          ))}
        </div>
      </DataState>
    </section>
  );
}
