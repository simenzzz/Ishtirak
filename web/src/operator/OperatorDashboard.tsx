import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { useWebSocket } from "../hooks/useWebSocket";
import type { WsEvent } from "../lib/types";

const links = [
  ["/operator/subscribers", "Subscribers"],
  ["/operator/tiers", "Tiers"],
  ["/operator/readings", "Readings"],
  ["/operator/billing", "Billing"],
  ["/operator/invoices", "Invoices"],
  ["/operator/outages", "Outages"],
  ["/operator/analytics", "Analytics"],
] as const;

export function OperatorDashboard() {
  const { identity, logout } = useAuth();
  const { connected } = useWebSocket(identity?.role ?? null, (message: WsEvent) => {
    window.dispatchEvent(new CustomEvent("ishtirak:ws", { detail: message }));
  });

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div>
          <p className="eyebrow">Operator</p>
          <h1>Ishtirak</h1>
        </div>
        <nav>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to}>{label}</NavLink>
          ))}
        </nav>
        <div className="session-card">
          <strong>{identity?.name ?? identity?.role}</strong>
          <small>{connected ? "Live alerts connected" : "Reconnecting alerts"}</small>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <section className="workspace">
        <Outlet />
      </section>
    </main>
  );
}
