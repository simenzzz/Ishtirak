import { BarChart3, FileText, Gauge, type LucideIcon, LogOut, Power, Receipt, Layers3, Users } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { LiveDot } from "../components/ui/LiveDot";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import { useWebSocket } from "../hooks/useWebSocket";
import type { WsEvent } from "../lib/types";

const links: readonly (readonly [string, string, LucideIcon])[] = [
  ["/operator/subscribers", "Subscribers", Users],
  ["/operator/tiers", "Tiers", Layers3],
  ["/operator/readings", "Readings", Gauge],
  ["/operator/billing", "Billing", Receipt],
  ["/operator/invoices", "Invoices", FileText],
  ["/operator/outages", "Outages", Power],
  ["/operator/analytics", "Analytics", BarChart3],
];

export function OperatorDashboard() {
  const { identity, logout } = useAuth();
  const { connected } = useWebSocket(identity?.role ?? null, (message: WsEvent) => {
    window.dispatchEvent(new CustomEvent("ishtirak:ws", { detail: message }));
  });

  return (
    <main className="app-shell">
      <a href="#main-content" className="skip-link">Skip to content</a>
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">Operator</p>
          <h1>Ishtirak</h1>
        </div>
        <nav className="nav" aria-label="Operator navigation">
          {links.map(([to, label, Icon]) => (
            <NavLink key={to} to={to}>
              <Icon aria-hidden />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <Card className="session-card">
          <strong>{identity?.name ?? identity?.role}</strong>
          <LiveDot on={connected}>{connected ? "Live alerts connected" : "Reconnecting alerts"}</LiveDot>
          <div className="session-card__actions">
            <ThemeToggle />
            <Button variant="ghost" onClick={logout}>
              <LogOut size={16} aria-hidden />
              Sign out
            </Button>
          </div>
        </Card>
      </aside>
      <section className="workspace" id="main-content">
        <Outlet />
      </section>
    </main>
  );
}
