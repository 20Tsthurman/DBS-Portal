import {
  fetchActivePackages,
  fetchClientsWithRelations,
} from "./_lib/queries";
import { AddClientButton } from "./_components/AddClientButton";
import { ClientsTable } from "./_components/ClientsTable";

export const dynamic = "force-dynamic";

export default async function OwnerClientsPage() {
  const [rows, packages] = await Promise.all([
    fetchClientsWithRelations(),
    fetchActivePackages(),
  ]);

  return (
    <section>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div>
          <p className="eyebrow mb-3">Owner — Clients</p>
          <h1 className="page-title">Clients</h1>
        </div>
        <AddClientButton packages={packages} />
      </header>

      {rows.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center border px-8 py-20 text-center"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
          }}
        >
          <p
            style={{
              color: "var(--text-body)",
              fontSize: "15px",
              marginBottom: 20,
            }}
          >
            No clients yet. Add your first client.
          </p>
          <AddClientButton packages={packages} label="Add Your First Client" />
        </div>
      ) : (
        <ClientsTable clients={rows} />
      )}
    </section>
  );
}
