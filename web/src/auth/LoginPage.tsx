import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { homeFor } from "./RequireRole";
import { useAuth } from "./useAuth";

type LocationState = Readonly<{ from?: string }>;

// Only treat an in-app, single-slash path as a safe post-login redirect target;
// reject protocol-relative (`//host`) or backslash forms.
function safeReturnPath(from: string | undefined): string | null {
  if (!from || !from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) return null;
  return from;
}

export function LoginPage() {
  const { identity, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeReturnPath((location.state as LocationState | null)?.from);
  const [email, setEmail] = useState(import.meta.env.DEV ? "admin@ishtirak.local" : "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.includes("@") || password.length < 1) {
      setError("Enter an email and password.");
      return;
    }
    setBusy(true);
    try {
      const result = await login(email, password);
      if (result.contextSelectionRequired) {
        sessionStorage.setItem("ishtirak.pendingSelection", JSON.stringify({
          selectionToken: result.selectionToken,
          memberships: result.memberships,
        }));
        navigate("/select-context", { state: { selectionToken: result.selectionToken, memberships: result.memberships } });
      } else {
        navigate(from ?? homeFor(result.memberships[0]?.role ?? identity?.role ?? "OPERATOR_ADMIN"), { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-screen">
      <section className="login-panel">
        <p className="eyebrow">Ishtirak v1</p>
        <h1>Generator operations console</h1>
        <form onSubmit={submit} className="form-stack">
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="username" />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button disabled={busy}>{busy ? "Signing in..." : "Sign in"}</button>
        </form>
        <Link to="/portal" className="muted-link">Subscriber portal</Link>
      </section>
    </main>
  );
}
