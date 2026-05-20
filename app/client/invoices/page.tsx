import { requireCurrentClient } from "@/lib/currentClient";
import { fetchMyInvoices } from "./_lib/queries";
import { ClientInvoicesList } from "./_components/ClientInvoicesList";
import { PaymentBanner } from "./_components/PaymentBanner";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    paid?: string;
    canceled?: string;
    invoice?: string;
  }>;
}

export default async function ClientInvoicesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const client = await requireCurrentClient();
  const invoices = await fetchMyInvoices(client.id);

  return (
    <section>
      <header style={{ marginBottom: 24 }}>
        <p className="eyebrow mb-3">Client — Invoices</p>
        <h1 className="page-title">Invoices</h1>
        <p
          style={{
            marginTop: 8,
            fontSize: 14,
            color: "var(--text-body)",
          }}
        >
          View and pay your invoices.
        </p>
      </header>

      <PaymentBanner
        paid={params.paid === "1"}
        canceled={params.canceled === "1"}
        invoiceNumber={params.invoice}
      />

      <ClientInvoicesList invoices={invoices} />
    </section>
  );
}
