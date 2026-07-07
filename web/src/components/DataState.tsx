import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";

export function DataState({
  loading,
  error,
  isEmpty,
  emptyMessage,
  children,
}: {
  readonly loading: boolean;
  readonly error: string | null;
  readonly isEmpty?: boolean;
  readonly emptyMessage?: string;
  readonly children: ReactNode;
}) {
  if (loading) {
    return (
      <p className="status-line status-line--loading">
        <Loader2 className="spinner" size={15} aria-hidden />
        Loading...
      </p>
    );
  }
  if (error) return <p className="error">{error}</p>;
  if (isEmpty && emptyMessage) return <p className="status-line">{emptyMessage}</p>;
  return <>{children}</>;
}
