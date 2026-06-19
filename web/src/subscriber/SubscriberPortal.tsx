import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../auth/useAuth";
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
        <div><p className="eyebrow">Subscriber</p><h1>Ishtirak portal</h1></div>
        <nav>
          <NavLink to="/portal/bill">Bill</NavLink>
          <NavLink to="/portal/consumption">Consumption</NavLink>
          <NavLink to="/portal/outage">Outage</NavLink>
        </nav>
        <button onClick={logout}>Sign out</button>
      </header>
      <p className="status-line">{connected ? "Live updates connected" : "Reconnecting live updates"}</p>
      <Outlet />
    </main>
  );
}
