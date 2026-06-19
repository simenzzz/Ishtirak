import { Navigate, Outlet, useLocation } from "react-router-dom";

import type { Role } from "../lib/types";
import { useAuth } from "./useAuth";

export function homeFor(role: Role) {
  return role === "SUBSCRIBER" ? "/portal" : "/operator";
}

export function RequireRole({ roles }: { readonly roles: readonly Role[] }) {
  const { identity, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="center-panel">Loading session...</main>;
  if (!identity) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (!roles.includes(identity.role)) return <Navigate to={homeFor(identity.role)} replace />;
  return <Outlet />;
}
