import { InvoicesBoard } from "./_components/InvoicesBoard";
import {
  StatusFilterPills,
  type StatusFilter,
} from "./_components/StatusFilterPills";
import {
  fetchClientsForPicker,
  fetchInvoices,
} from "./_lib/queries";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

function parseStatusFilter(raw: unknown): StatusFilter {
  if (raw === "all" || raw === "draft" || raw === "sent" || raw === "paid") {
    return raw;
  }
  return "open";
}

export default async function OwnerInvoicesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = parseStatusFilter(params.status);

  const [invoices, clients] = await Promise.all([
    fetchInvoices({ status }),
    fetchClientsForPicker(),
  ]);

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <h1 className="page-title">Invoices</h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--text-body)",
          }}
        >
          Create, send, and track invoices across all clients.
        </p>
      </header>

      <StatusFilterPills active={status} />

      <InvoicesBoard invoices={invoices} clients={clients} mode="standalone" />
    </section>
  );
}
