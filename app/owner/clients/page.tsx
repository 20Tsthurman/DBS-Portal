import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  MobileCard,
  MobileCardActions,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/ui/MobileCard";
import {
  fetchActivePackages,
  fetchClientsWithRelations,
} from "./_lib/queries";
import {
  clientStatusLabel,
  clientStatusTone,
  formatCurrency,
  formatDate,
  formatHours,
} from "./_lib/format";
import { AddClientButton } from "./_components/AddClientButton";
import { TypePill } from "./_components/TypePill";
import { effectiveMonthlyPrice } from "@/lib/pricing";

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
        <>
          <div
            className="hidden border lg:block"
            style={{
              borderColor: "var(--border)",
              backgroundColor: "var(--surface-raised)",
            }}
          >
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Package</th>
                  <th>Status</th>
                  <th>Start Date</th>
                  <th>Monthly Value</th>
                  <th>Hours This Month</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ client, project, pkg, hoursThisMonth }) => (
                  <tr key={client.id} className="row-hover">
                    <td style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                      {client.name}
                    </td>
                    <td>
                      <TypePill type={client.type} />
                    </td>
                    <td>{pkg?.name ?? "—"}</td>
                    <td>
                      <StatusPill tone={clientStatusTone(client.status)}>
                        {clientStatusLabel(client.status)}
                      </StatusPill>
                    </td>
                    <td>{formatDate(project?.start_date)}</td>
                    <td>{formatCurrency(effectiveMonthlyPrice(project, pkg))}</td>
                    <td>{formatHours(hoursThisMonth)}</td>
                    <td style={{ textAlign: "right" }}>
                      <Link
                        href={`/owner/clients/${client.id}`}
                        style={{
                          color: "var(--accent)",
                          fontSize: "13px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                        }}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <MobileCardList className="lg:hidden">
            {rows.map(({ client, project, pkg, hoursThisMonth }) => (
              <MobileCard key={client.id}>
                <MobileCardHeader
                  title={client.name}
                  badge={
                    <StatusPill tone={clientStatusTone(client.status)}>
                      {clientStatusLabel(client.status)}
                    </StatusPill>
                  }
                  subtitle={<TypePill type={client.type} />}
                />
                <MobileCardField label="Package">
                  {pkg?.name ?? "—"}
                </MobileCardField>
                <MobileCardField label="Start Date">
                  {formatDate(project?.start_date)}
                </MobileCardField>
                <MobileCardField label="Monthly Value">
                  {formatCurrency(effectiveMonthlyPrice(project, pkg))}
                </MobileCardField>
                <MobileCardField label="Hours This Month">
                  {formatHours(hoursThisMonth)}
                </MobileCardField>
                <MobileCardActions align="end">
                  <Link
                    href={`/owner/clients/${client.id}`}
                    style={{
                      color: "var(--accent)",
                      fontSize: "13px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    View →
                  </Link>
                </MobileCardActions>
              </MobileCard>
            ))}
          </MobileCardList>
        </>
      )}

      <style>{`
        .row-hover:hover td {
          background-color: var(--surface-base);
        }
      `}</style>
    </section>
  );
}
