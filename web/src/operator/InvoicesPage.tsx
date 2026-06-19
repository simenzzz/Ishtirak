import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { DataState } from "../components/DataState";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { apiRequest } from "../lib/apiClient";
import { formatDate, formatDual } from "../lib/format";
import type { Currency, Invoice, Payment } from "../lib/types";

export function InvoicesPage() {
  const invoices = usePaginated<Invoice>("/invoices");
  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Receivables</p><h2>Invoices</h2></div></header>
      <DataState loading={invoices.loading} error={invoices.error}>
        <table>
          <thead><tr><th>Period</th><th>Amount</th><th>Status</th><th /></tr></thead>
          <tbody>
            {invoices.data.map((invoice) => (
              <tr key={invoice.id}>
                <td>{formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}</td>
                <td>{formatDual(invoice.amountUsd, invoice.amountLbp)}</td>
                <td>{invoice.status}</td>
                <td><Link to={`/operator/invoices/${invoice.id}`}>Open</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataState>
    </section>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const invoice = useFetch<Invoice>(id ? `/invoices/${id}` : null);
  const payments = useFetch<readonly Payment[]>(id ? `/invoices/${id}/payments` : null);
  return (
    <section className="page-stack">
      <DataState loading={invoice.loading} error={invoice.error}>
        <header className="page-header">
          <div><p className="eyebrow">Invoice</p><h2>{invoice.data ? formatDual(invoice.data.amountUsd, invoice.data.amountLbp) : ""}</h2></div>
          <span className="badge">{invoice.data?.status}</span>
        </header>
        {id ? <RecordPaymentForm invoiceId={id} onDone={async () => { await payments.refetch(); await invoice.refetch(); }} /> : null}
      </DataState>
      <DataState loading={payments.loading} error={payments.error}>
        <table><tbody>{(payments.data ?? []).map((payment) => (
          <tr key={payment.id}><td>{payment.method}</td><td>{payment.currency} {payment.tenderedAmount}</td></tr>
        ))}</tbody></table>
      </DataState>
    </section>
  );
}

function RecordPaymentForm({ invoiceId, onDone }: { readonly invoiceId: string; readonly onDone: () => Promise<void> }) {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Payment["method"]>("CASH");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const tenderedAmount = Number(amount);
    setError("");
    if (!Number.isFinite(tenderedAmount) || tenderedAmount <= 0) {
      setError("Enter a positive payment amount.");
      return;
    }
    await apiRequest<Payment>("/payments", { method: "POST", body: { invoiceId, currency, tenderedAmount, method } });
    setAmount("");
    await onDone();
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>USD</option><option>LBP</option></select>
      <input placeholder="Amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" type="number" min="0.01" step="0.01" />
      <select value={method} onChange={(event) => setMethod(event.target.value as Payment["method"])}><option>CASH</option><option>WHISH</option></select>
      <button>Record payment</button>
      {error ? <p className="error">{error}</p> : null}
    </form>
  );
}
