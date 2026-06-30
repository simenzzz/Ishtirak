import type { ReactNode } from "react";

export function Card({ className, children }: { readonly className?: string; readonly children: ReactNode }) {
  return <div className={["card", className].filter(Boolean).join(" ")}>{children}</div>;
}
