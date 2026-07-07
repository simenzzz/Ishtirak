import { Navigate, Outlet, useLocation } from "react-router-dom";

import type { Role } from "../lib/types";
import { useAuth } from "./useAuth";

export function homeFor(role: Role) {
  return role === "SUBSCRIBER" ? "/portal" : "/operator";
}

// Send logged-out users to the login surface matching the audience of the route
// they tried to reach — subscriber routes → /portal/login, everything else → /login.
// No route requires both audiences, so presence of SUBSCRIBER is decisive.
export function loginPathFor(roles: readonly Role[]) {
  return roles.includes("SUBSCRIBER") ? "/portal/login" : "/login";
}

export function RequireRole({ roles }: { readonly roles: readonly Role[] }) {
  const { identity, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="center-panel">Loading session...</main>;
  if (!identity) return <Navigate to={loginPathFor(roles)} replace state={{ from: location.pathname }} />;
  if (!roles.includes(identity.role)) return <Navigate to={homeFor(identity.role)} replace />;
  return <Outlet />;
}
