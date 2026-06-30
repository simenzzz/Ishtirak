import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { homeFor } from "./RequireRole";
import { useAuth } from "./useAuth";
import type { Membership } from "../lib/types";

type SelectionState = Readonly<{ selectionToken?: string; memberships?: readonly Membership[] }>;

function storedState(): SelectionState | null {
  try {
    const raw = sessionStorage.getItem("ishtirak.pendingSelection");
    return raw ? (JSON.parse(raw) as SelectionState) : null;
  } catch {
    return null;
  }
}

export function ContextSelectPage() {
  const { selectContext } = useAuth();
  const navigate = useNavigate();
  const state = (useLocation().state as SelectionState | null) ?? storedState();
  const memberships = state?.memberships ?? [];
  const [selected, setSelected] = useState(memberships[0]?.membershipId ?? "");
  const [error, setError] = useState("");

  if (!state?.selectionToken || memberships.length === 0) return <Navigate to="/login" replace />;
  const selectionToken = state.selectionToken;

  async function submit() {
    const membership = memberships.find((item) => item.membershipId === selected);
    if (!membership) return;
    try {
      await selectContext(selectionToken, membership.membershipId);
      sessionStorage.removeItem("ishtirak.pendingSelection");
      navigate(homeFor(membership.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not select context.");
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <p className="eyebrow">Choose workspace</p>
        <h1>Select an operator context</h1>
        <div className="choice-list">
          {memberships.map((membership) => (
            <label key={membership.membershipId} className="choice-card">
              <input
                type="radio"
                checked={selected === membership.membershipId}
                onChange={() => setSelected(membership.membershipId)}
              />
              <span>
                <strong>{membership.operatorName}</strong>
                <small>{membership.role.replace("_", " ")}</small>
              </span>
            </label>
          ))}
        </div>
        {error ? <p className="error">{error}</p> : null}
        <Button block onClick={() => void submit()}>Continue</Button>
      </section>
    </main>
  );
}
