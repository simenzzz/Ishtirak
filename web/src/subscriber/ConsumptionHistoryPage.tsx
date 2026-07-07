import { DataState } from "../components/DataState";
import { DataTable } from "../components/ui/DataTable";
import { PageHeader } from "../components/ui/PageHeader";
import { Pagination } from "../components/ui/Pagination";
import { SortableTh } from "../components/ui/SortableTh";
import { usePaginated } from "../hooks/usePaginated";
import { useSort } from "../hooks/useSort";
import { formatDateTime } from "../lib/format";
import type { Reading } from "../lib/types";

export function ConsumptionHistoryPage() {
  const readings = usePaginated<Reading>("/me/readings");
  const { sorted, sortKey, direction, toggleSort } = useSort<Reading, "readingAt" | "kwh">(readings.data, "readingAt");
  return (
    <section className="page-stack">
      <PageHeader eyebrow="Meter history" title="Consumption" />
      <DataState
        loading={readings.loading}
        error={readings.error}
        isEmpty={sorted.length === 0}
        emptyMessage="No meter readings yet."
      >
        <DataTable>
          <table>
            <thead>
              <tr>
                <SortableTh label="Reading" sortKey="readingAt" activeKey={sortKey} direction={direction} onSort={toggleSort} />
                <SortableTh label="kWh" sortKey="kwh" activeKey={sortKey} direction={direction} onSort={toggleSort} />
              </tr>
            </thead>
            <tbody>{sorted.map((reading) => (
              <tr key={reading.id}>
                <td data-label="Reading">{formatDateTime(reading.readingAt)}</td>
                <td className="tnum" data-label="kWh">{reading.kwh}</td>
              </tr>
            ))}</tbody>
          </table>
        </DataTable>
      </DataState>
      <Pagination meta={readings.meta} onPageChange={readings.setPage} sortableColumns />
    </section>
  );
}
