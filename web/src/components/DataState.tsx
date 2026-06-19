import type { ReactNode } from "react";

export function DataState({
  loading,
  error,
  children,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly children: ReactNode;
}) {
  if (loading) return <p className="status-line">Loading...</p>;
  if (error) return <p className="error">{error}</p>;
  return <>{children}</>;
}
