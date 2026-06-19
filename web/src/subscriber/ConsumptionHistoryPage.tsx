import { DataState } from "../components/DataState";
import { usePaginated } from "../hooks/usePaginated";
import { formatDateTime } from "../lib/format";
import type { Reading } from "../lib/types";

export function ConsumptionHistoryPage() {
  const readings = usePaginated<Reading>("/me/readings");
  return (
    <section className="page-stack">
      <header className="page-header"><div><p className="eyebrow">Meter history</p><h2>Consumption</h2></div></header>
      <DataState loading={readings.loading} error={readings.error}>
        <table>
          <thead><tr><th>Reading</th><th>kWh</th></tr></thead>
          <tbody>{readings.data.map((reading) => (
            <tr key={reading.id}><td>{formatDateTime(reading.readingAt)}</td><td>{reading.kwh}</td></tr>
          ))}</tbody>
        </table>
      </DataState>
    </section>
  );
}
