import { RecordReadingForm } from "./SubscriberDetailPage";

export function ReadingsPage() {
  return (
    <section className="page-stack">
      <header className="page-header">
        <div><p className="eyebrow">Meter stream</p><h2>Record reading</h2></div>
      </header>
      <RecordReadingForm />
    </section>
  );
}
