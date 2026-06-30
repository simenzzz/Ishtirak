import { PageHeader } from "../components/ui/PageHeader";
import { RecordReadingForm } from "./SubscriberDetailPage";

export function ReadingsPage() {
  return (
    <section className="page-stack">
      <PageHeader eyebrow="Meter stream" title="Record reading" />
      <RecordReadingForm />
    </section>
  );
}
