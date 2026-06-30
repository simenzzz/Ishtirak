import { Activity, LogOut, Power, Receipt } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
import { Button } from "../components/ui/Button";
import { LiveDot } from "../components/ui/LiveDot";
import { useWebSocket } from "../hooks/useWebSocket";
import type { WsEvent } from "../lib/types";

export function SubscriberPortal() {
  const { identity, logout } = useAuth();
  const { connected } = useWebSocket(identity?.role ?? null, (message: WsEvent) => {
    window.dispatchEvent(new CustomEvent("ishtirak:ws", { detail: message }));
  });
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <div className="brand">
          <p className="eyebrow">Subscriber</p>
          <h1>Ishtirak portal</h1>
        </div>
        <nav className="portal-nav">
          <NavLink to="/portal/bill">
            <Receipt aria-hidden />
            Bill
          </NavLink>
          <NavLink to="/portal/consumption">
            <Activity aria-hidden />
            Consumption
          </NavLink>
          <NavLink to="/portal/outage">
            <Power aria-hidden />
            Outage
          </NavLink>
        </nav>
        <Button variant="ghost" onClick={logout}>
          <LogOut size={16} aria-hidden />
          Sign out
        </Button>
      </header>
      <LiveDot on={connected}>{connected ? "Live updates connected" : "Reconnecting live updates"}</LiveDot>
      <Outlet />
    </main>
  );
}
