import { FormEvent, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { DataState } from "../components/DataState";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { apiRequest } from "../lib/apiClient";
import { formatDate, formatDual } from "../lib/format";
import type { Currency, Invoice, InvoiceStatus, Payment } from "../lib/types";

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
  const status = invoice.data?.status;
  const refresh = async () => { await payments.refetch(); await invoice.refetch(); };
  const payable = status === "ISSUED" || status === "PARTIAL";
  const canVoidIssued = status === "ISSUED" && !payments.loading && (payments.data ?? []).length === 0;
  const resolvable = status === "NEEDS_REVIEW" || canVoidIssued;
  return (
    <section className="page-stack">
      <DataState loading={invoice.loading} error={invoice.error}>
        <header className="page-header">
          <div><p className="eyebrow">Invoice</p><h2>{invoice.data ? formatDual(invoice.data.amountUsd, invoice.data.amountLbp) : ""}</h2></div>
          <span className="badge">{status}</span>
        </header>
        {id && payable ? <RecordPaymentForm invoiceId={id} onDone={refresh} /> : null}
        {id && resolvable ? <ResolutionActions invoiceId={id} status={status as InvoiceStatus} onDone={refresh} /> : null}
      </DataState>
      <DataState loading={payments.loading} error={payments.error}>
        <table><tbody>{(payments.data ?? []).map((payment) => (
          <tr key={payment.id}><td>{payment.method}</td><td>{payment.currency} {payment.tenderedAmount}</td></tr>
        ))}</tbody></table>
      </DataState>
    </section>
  );
}

/** Operator resolution for held/issued invoices: re-issue after a corrective reading, or void. */
function ResolutionActions({ invoiceId, status, onDone }: {
  readonly invoiceId: string;
  readonly status: InvoiceStatus;
  readonly onDone: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  async function act(action: "reissue" | "void") {
    setError("");
    try {
      await apiRequest<Invoice>(`/invoices/${invoiceId}/${action}`, { method: "POST" });
      await onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update invoice.");
    }
  }
  return (
    <div className="inline-form">
      {status === "NEEDS_REVIEW" ? (
        <>
          <p className="status-line">Under review — record a corrective reading on the Readings page, then re-issue.</p>
          <button type="button" onClick={() => act("reissue")}>Re-issue</button>
        </>
      ) : null}
      <button type="button" onClick={() => act("void")}>Void invoice</button>
      {error ? <p className="error">{error}</p> : null}
    </div>
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
