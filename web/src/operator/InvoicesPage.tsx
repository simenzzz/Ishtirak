import { FormEvent, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { DataState } from "../components/DataState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SortableTh } from "../components/ui/SortableTh";
import { useFetch } from "../hooks/useFetch";
import { usePaginated } from "../hooks/usePaginated";
import { useSort } from "../hooks/useSort";
import { apiRequest } from "../lib/apiClient";
import { formatDate, formatDual } from "../lib/format";
import { invoiceStatusView } from "../lib/statusTone";
import type { Currency, Invoice, InvoiceStatus, Payment } from "../lib/types";

const STATUS_OPTIONS: readonly InvoiceStatus[] = ["ISSUED", "PARTIAL", "PAID", "NEEDS_REVIEW", "VOID"];

export function InvoicesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<InvoiceStatus | "">(() => {
    const fromUrl = searchParams.get("status");
    return (STATUS_OPTIONS as readonly string[]).includes(fromUrl ?? "") ? (fromUrl as InvoiceStatus) : "";
  });
  const periodStart = searchParams.get("periodStart") ?? undefined;
  const periodEnd = searchParams.get("periodEnd") ?? undefined;
  const periodFilterActive = Boolean(periodStart && periodEnd);
  const invoices = usePaginated<Invoice>("/invoices", {
    params: { status: status || undefined, periodStart, periodEnd },
  });
  const { sorted, sortKey, direction, toggleSort } = useSort<Invoice, "periodStart" | "amountUsd" | "status">(
    invoices.data,
    "periodStart",
  );

  function clearPeriodFilter() {
    setSearchParams((params) => {
      const next = new URLSearchParams(params);
      next.delete("periodStart");
      next.delete("periodEnd");
      return next;
    });
    invoices.setPage(1);
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Receivables" title="Invoices" />
      <label>
        Filter by status
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as InvoiceStatus | "");
            invoices.setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{invoiceStatusView(option).label}</option>)}
        </select>
      </label>
      {periodFilterActive ? (
        <p className="status-line">
          Filtered to {formatDate(periodStart as string)} - {formatDate(periodEnd as string)}
          {" "}
          <Button variant="ghost" onClick={clearPeriodFilter}>Clear filter</Button>
        </p>
      ) : null}
      <DataState
        loading={invoices.loading}
        error={invoices.error}
        isEmpty={sorted.length === 0}
        emptyMessage={status || periodFilterActive ? "No invoices match this filter." : "No invoices issued yet."}
      >
        <DataTable>
          <table>
            <thead>
              <tr>
                <SortableTh label="Period" sortKey="periodStart" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Amount" sortKey="amountUsd" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="Status" sortKey="status" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((invoice) => {
                const view = invoiceStatusView(invoice.status);
                return (
                  <tr key={invoice.id}>
                    <td data-label="Period">{formatDate(invoice.periodStart)} - {formatDate(invoice.periodEnd)}</td>
                    <td className="tnum" data-label="Amount">{formatDual(invoice.amountUsd, invoice.amountLbp)}</td>
                    <td data-label="Status"><Badge tone={view.tone}>{view.label}</Badge></td>
                    <td data-label=""><Link to={`/operator/invoices/${invoice.id}`}>Open</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </DataTable>
      </DataState>
      <Pagination meta={invoices.meta} onPageChange={invoices.setPage} sortableColumns />
    </section>
  );
}

export function InvoiceDetailPage() {
  const { id } = useParams();
  const invoice = useFetch<Invoice>(id ? `/invoices/${id}` : null);
  const payments = useFetch<readonly Payment[]>(id ? `/invoices/${id}/payments` : null);
  const status = invoice.data?.status;
  const statusView = invoiceStatusView(status);
  const refresh = async () => { await payments.refetch(); await invoice.refetch(); };
  const payable = status === "ISSUED" || status === "PARTIAL";
  const canVoidIssued = status === "ISSUED" && !payments.loading && (payments.data ?? []).length === 0;
  const resolvable = status === "NEEDS_REVIEW" || canVoidIssued;
  return (
    <section className="page-stack">
      <DataState loading={invoice.loading} error={invoice.error}>
        <PageHeader
          eyebrow="Invoice"
          title={invoice.data ? formatDual(invoice.data.amountUsd, invoice.data.amountLbp) : ""}
          actions={<Badge tone={statusView.tone}>{statusView.label}</Badge>}
        />
        {id && payable ? <RecordPaymentForm invoiceId={id} onDone={refresh} /> : null}
        {id && resolvable ? <ResolutionActions invoiceId={id} status={status as InvoiceStatus} onDone={refresh} /> : null}
      </DataState>
      <DataState
        loading={payments.loading}
        error={payments.error}
        isEmpty={(payments.data ?? []).length === 0}
        emptyMessage="No payments recorded yet."
      >
        <DataTable>
          <table><tbody>{(payments.data ?? []).map((payment) => (
            <tr key={payment.id}>
              <td data-label="Method">{payment.method}</td>
              <td className="tnum" data-label="Amount">{payment.currency} {payment.tenderedAmount}</td>
            </tr>
          ))}</tbody></table>
        </DataTable>
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
  function confirmVoid() {
    if (window.confirm("Void this invoice? This cannot be undone.")) void act("void");
  }
  return (
    <div className="inline-form">
      {status === "NEEDS_REVIEW" ? (
        <>
          <p className="status-line">Under review — record a corrective reading on the Readings page, then re-issue.</p>
          <Button onClick={() => act("reissue")}>Re-issue</Button>
        </>
      ) : null}
      <Button variant="danger" onClick={confirmVoid}>Void invoice</Button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

function RecordPaymentForm({ invoiceId, onDone }: { readonly invoiceId: string; readonly onDone: () => Promise<void> }) {
  const [currency, setCurrency] = useState<Currency>("USD");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Payment["method"]>("CASH");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "success">("idle");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const tenderedAmount = Number(amount);
    setError("");
    if (!Number.isFinite(tenderedAmount) || tenderedAmount <= 0) {
      setError("Enter a positive payment amount.");
      return;
    }
    setStatus("busy");
    try {
      await apiRequest<Payment>("/payments", { method: "POST", body: { invoiceId, currency, tenderedAmount, method } });
      setAmount("");
      await onDone();
      setStatus("success");
      setTimeout(() => setStatus((current) => (current === "success" ? "idle" : current)), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record payment.");
      setStatus("idle");
    }
  }
  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Currency
        <select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}><option>USD</option><option>LBP</option></select>
      </label>
      <label>
        Amount
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" type="number" min="0.01" step="0.01" />
      </label>
      <label>
        Method
        <select value={method} onChange={(event) => setMethod(event.target.value as Payment["method"])}><option>CASH</option><option>WHISH</option></select>
      </label>
      <Button type="submit" disabled={status === "busy"}>
        {status === "busy" ? "Recording..." : "Record payment"}
      </Button>
      {error ? <p className="error">{error}</p> : null}
      {status === "success" ? <p className="success">Payment recorded.</p> : null}
    </form>
  );
}
