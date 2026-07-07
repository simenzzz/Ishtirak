import { Navigate, Route, Routes } from "react-router-dom";

import { ContextSelectPage } from "./auth/ContextSelectPage";
import { LoginPage } from "./auth/LoginPage";
import { RequireRole } from "./auth/RequireRole";
import { AnalyticsPage } from "./operator/AnalyticsPage";
import { BillingRunPage } from "./operator/BillingRunPage";
import { InvoiceDetailPage, InvoicesPage } from "./operator/InvoicesPage";
import { OperatorDashboard } from "./operator/OperatorDashboard";
import { OutagesPage } from "./operator/OutagesPage";
import { ReadingsPage } from "./operator/ReadingsPage";
import { SubscriberDetailPage } from "./operator/SubscriberDetailPage";
import { SubscribersPage } from "./operator/SubscribersPage";
import { TiersPage } from "./operator/TiersPage";
import { ConsumptionHistoryPage } from "./subscriber/ConsumptionHistoryPage";
import { CurrentBillPage } from "./subscriber/CurrentBillPage";
import { OutageCountdown } from "./subscriber/OutageCountdown";
import { SubscriberPortal } from "./subscriber/SubscriberPortal";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage key="operator" audience="operator" />} />
      <Route path="/portal/login" element={<LoginPage key="subscriber" audience="subscriber" />} />
      <Route path="/select-context" element={<ContextSelectPage />} />
      <Route element={<RequireRole roles={["OPERATOR_ADMIN", "OPERATOR_STAFF"]} />}>
        <Route path="/operator" element={<OperatorDashboard />}>
          <Route index element={<Navigate to="subscribers" replace />} />
          <Route path="subscribers" element={<SubscribersPage />} />
          <Route path="subscribers/:id" element={<SubscriberDetailPage />} />
          <Route path="tiers" element={<TiersPage />} />
          <Route path="readings" element={<ReadingsPage />} />
          <Route path="billing" element={<BillingRunPage />} />
          <Route path="invoices" element={<InvoicesPage />} />
          <Route path="invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="outages" element={<OutagesPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
        </Route>
      </Route>
      <Route element={<RequireRole roles={["SUBSCRIBER"]} />}>
        <Route path="/portal" element={<SubscriberPortal />}>
          <Route index element={<Navigate to="bill" replace />} />
          <Route path="bill" element={<CurrentBillPage />} />
          <Route path="consumption" element={<ConsumptionHistoryPage />} />
          <Route path="outage" element={<OutageCountdown />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/operator" replace />} />
    </Routes>
  );
}
