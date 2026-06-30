import type { ReactNode } from "react";

export function StatCard({
  value,
  label,
  lines,
}: {
  readonly value: ReactNode;
  readonly label: ReactNode;
  readonly lines?: readonly ReactNode[];
}) {
  return (
    <article className="stat-card">
      <strong className="stat-value">{value}</strong>
      <span className="stat-label">{label}</span>
      {lines?.map((line, index) => <small key={index}>{line}</small>)}
    </article>
  );
}
