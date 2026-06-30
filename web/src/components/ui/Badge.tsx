import type { ReactNode } from "react";

import type { Tone } from "../../lib/statusTone";

export function Badge({ tone = "neutral", children }: { readonly tone?: Tone; readonly children: ReactNode }) {
  const modifier = tone === "neutral" ? "" : ` badge--${tone}`;
  return <span className={`badge${modifier}`}>{children}</span>;
}
