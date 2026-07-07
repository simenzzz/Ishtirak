import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { DataTable } from "../components/ui/DataTable";
import { Button } from "../components/ui/Button";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { apiRequest } from "../lib/apiClient";
import { formatDual } from "../lib/format";
import type { BillingRunInvoice, PageMeta } from "../lib/types";

const PAGE_SIZE = 10;

type BillingRunResult = Readonly<{
  issuedCount: number;
  needsReviewCount: number;
  periodStart: string;
  periodEnd: string;
  invoices: readonly BillingRunInvoice[];
}>;

export function BillingRunPage() {
  const { identity } = useAuth();
  const now = new Date();
  const [periodStart, setPeriodStart] = useState(now.toISOString().slice(0, 8) + "01");
  const [periodEnd, setPeriodEnd] = useState(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10),
  );
  const [result, setResult] = useState<BillingRunResult | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isAdmin = identity?.role === "OPERATOR_ADMIN";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResult(null);
    setBusy(true);
    try {
      const response = await apiRequest<BillingRunResult>("/billing-runs", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { periodStart, periodEnd },
      });
      setResult(response);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing run failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Month close" title="Billing run" />
      {isAdmin ? (
        <form className="inline-form" onSubmit={submit}>
          <label>
            Period start
            <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          </label>
          <label>
            Period end
            <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          </label>
          <Button type="submit" disabled={busy}>{busy ? "Running..." : "Run billing"}</Button>
        </form>
      ) : <p className="status-line">Only admins can run billing.</p>}
      {result ? <BillingRunSummary result={result} page={page} onPageChange={setPage} /> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}

function BillingRunSummary({
  result,
  page,
  onPageChange,
}: {
  readonly result: BillingRunResult;
  readonly page: number;
  readonly onPageChange: (page: number) => void;
}) {
  const invoicesUrl = `/operator/invoices?status=ISSUED&periodStart=${result.periodStart}&periodEnd=${result.periodEnd}`;
  const meta: PageMeta = { total: result.invoices.length, page, limit: PAGE_SIZE };
  const pageInvoices = result.invoices.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="page-stack">
      <p className="success">
        <Link to={invoicesUrl}>
          {result.needsReviewCount > 0
            ? `${result.issuedCount} invoices issued, ${result.needsReviewCount} need review`
            : `${result.issuedCount} invoices issued`}
        </Link>
      </p>
      {pageInvoices.length > 0 ? (
        <>
          <DataTable>
            <table>
              <tbody>
                {pageInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td data-label="Subscriber">{invoice.subscriberName}</td>
                    <td className="tnum" data-label="Amount">{formatDual(invoice.amountUsd, invoice.amountLbp)}</td>
                    <td data-label=""><Link to={`/operator/invoices/${invoice.id}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
          <Pagination meta={meta} onPageChange={onPageChange} />
          <Link to={invoicesUrl}>View all {result.issuedCount} invoices</Link>
        </>
      ) : null}
    </div>
  );
}
