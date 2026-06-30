import { DataState } from "../components/DataState";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { usePaginated } from "../hooks/usePaginated";
import { formatDateTime } from "../lib/format";
import type { Reading } from "../lib/types";

export function ConsumptionHistoryPage() {
  const readings = usePaginated<Reading>("/me/readings");
  return (
    <section className="page-stack">
      <PageHeader eyebrow="Meter history" title="Consumption" />
      <DataState loading={readings.loading} error={readings.error}>
        <DataTable>
          <table>
            <thead><tr><th>Reading</th><th>kWh</th></tr></thead>
            <tbody>{readings.data.map((reading) => (
              <tr key={reading.id}><td>{formatDateTime(reading.readingAt)}</td><td className="tnum">{reading.kwh}</td></tr>
            ))}</tbody>
          </table>
        </DataTable>
      </DataState>
    </section>
  );
}
