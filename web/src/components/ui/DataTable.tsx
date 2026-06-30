import type { ReactNode } from "react";

/** Scroll/elevation wrapper around a native <table>; keeps the table DOM intact. */
export function DataTable({ children }: { readonly children: ReactNode }) {
  return <div className="data-table">{children}</div>;
}
