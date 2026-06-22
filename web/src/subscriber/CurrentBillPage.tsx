import { useEffect } from "react";

import { DataState } from "../components/DataState";
import { usePaginated } from "../hooks/usePaginated";
import { formatDate, formatDual } from "../lib/format";
import type { Invoice, InvoiceStatus, WsEvent } from "../lib/types";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
  ISSUED: "Issued",
  PARTIAL: "Partially paid",
  PAID: "Paid",
  VOID: "Voided",
  NEEDS_REVIEW: "Under review",
};

function headline(invoice: Invoice) {
  if (invoice.status === "NEEDS_REVIEW") return "Under review";
  if (invoice.status === "VOID") return "Voided";
  return formatDual(invoice.amountUsd, invoice.amountLbp);
}

export function CurrentBillPage() {
  const invoices = usePaginated<Invoice>("/me/invoices", 5);
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
      <header className="page-header"><div><p className="eyebrow">Current bill</p><h2>Latest invoice</h2></div></header>
      <DataState loading={invoices.loading} error={invoices.error}>
        {current ? (
          <article className="bill-panel" data-testid="current-bill">
            <strong>{headline(current)}</strong>
            <span>{formatDate(current.periodStart)} - {formatDate(current.periodEnd)}</span>
            <small>{current.kwhConsumed} kWh · {STATUS_LABEL[current.status]}</small>
          </article>
        ) : <p className="status-line">No invoices yet.</p>}
        <div className="card-grid">
          {invoices.data.slice(1).map((invoice) => (
            <article className="metric-card" key={invoice.id}>
              <strong>{headline(invoice)}</strong>
              <span>{STATUS_LABEL[invoice.status]}</span>
            </article>
          ))}
        </div>
      </DataState>
    </section>
  );
}
