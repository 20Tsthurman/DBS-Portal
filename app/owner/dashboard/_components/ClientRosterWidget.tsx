import { StatCard } from "@/components/ui/StatCard";
import { fetchClientsWithRelations } from "@/app/owner/clients/_lib/queries";
import { formatCurrency } from "@/app/owner/clients/_lib/format";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { effectiveMonthlyPrice } from "@/lib/pricing";

/**
 * Snapshot of the client roster: counts by status + monthly billing value.
 *
 * Re-uses `fetchClientsWithRelations` (the same query the clients list page
 * runs) so numbers stay 1:1 with that page. Time-log totals on each row are
 * ignored here — we only need status, type, and the joined package price.
 *
 * Inactive clients are excluded from every number.
 */
export async function ClientRosterWidget() {
  const all = await fetchClientsWithRelations();
  const rows = all.filter((r) => r.client.status !== "inactive");

  const activeCount = rows.filter((r) => r.client.status === "active").length;
  const onboardingCount = rows.filter(
    (r) => r.client.status === "onboarding"
  ).length;
  const leadCount = rows.filter((r) => r.client.status === "lead").length;

  const billingPool = rows.filter(
    (r) => r.client.status === "active" || r.client.status === "onboarding"
  );
  let monthlyValue = 0;
  let missingPackage = 0;
  for (const r of billingPool) {
    const price = effectiveMonthlyPrice(r.project, r.pkg);
    if (price !== null) {
      monthlyValue += price;
    } else {
      missingPackage += 1;
    }
  }
  const monthlyHint =
    missingPackage > 0
      ? `${missingPackage} client${missingPackage === 1 ? "" : "s"} without package`
      : undefined;

  // Brand/bride split — billing pool only (active + onboarding), leads excluded.
  let brandCount = 0;
  let brideCount = 0;
  for (const r of billingPool) {
    if (r.client.type === "brand") brandCount += 1;
    else brideCount += 1;
  }

  return (
    <DashboardCard eyebrow="ROSTER" title="Active Clients">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Active clients" value={activeCount} />
        <StatCard label="In onboarding" value={onboardingCount} />
        <StatCard label="Leads" value={leadCount} />
        <StatCard
          label="Monthly value"
          value={formatCurrency(monthlyValue)}
          hint={monthlyHint}
        />
      </div>
      <p
        style={{
          marginTop: 16,
          fontSize: 13,
          color: "var(--text-muted)",
        }}
      >
        {brandCount} {brandCount === 1 ? "brand" : "brands"} · {brideCount}{" "}
        {brideCount === 1 ? "bride" : "brides"}
      </p>
    </DashboardCard>
  );
}
