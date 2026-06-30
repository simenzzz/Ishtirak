import type { ReactNode } from "react";

export function LiveDot({ on, children }: { readonly on: boolean; readonly children: ReactNode }) {
  return <span className={on ? "live-dot" : "live-dot live-dot--off"}>{children}</span>;
}
