import { FormEvent, useState } from "react";

import { useAuth } from "../auth/useAuth";
import { PageHeader } from "../components/ui/PageHeader";
import { apiRequest } from "../lib/apiClient";

type BillingRunResult = Readonly<{ issuedCount?: number; invoiceCount?: number; needsReviewCount?: number }>;

export function BillingRunPage() {
  const { identity } = useAuth();
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 8) + "01");
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0, 10));
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const isAdmin = identity?.role === "OPERATOR_ADMIN";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await apiRequest<BillingRunResult>("/billing-runs", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { periodStart, periodEnd },
      });
      const issued = response.issuedCount ?? response.invoiceCount ?? 0;
      const needsReview = response.needsReviewCount ?? 0;
      setResult(needsReview > 0
        ? `${issued} invoices issued, ${needsReview} need review`
        : `${issued} invoices issued`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Billing run failed.");
    }
  }

  return (
    <section className="page-stack">
      <PageHeader eyebrow="Month close" title="Billing run" />
      {isAdmin ? (
        <form className="inline-form" onSubmit={submit}>
          <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
          <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
          <button>Run billing</button>
        </form>
      ) : <p className="status-line">Only admins can run billing.</p>}
      {result ? <p className="success">{result}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </section>
  );
}
