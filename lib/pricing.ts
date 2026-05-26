import type { PackageRecord, ProjectRecord } from "@/lib/supabase";

export function effectiveMonthlyPrice(
  project: Pick<ProjectRecord, "monthly_price_override"> | null,
  pkg: Pick<PackageRecord, "monthly_price"> | null
): number | null {
  if (project?.monthly_price_override != null) return Number(project.monthly_price_override);
  if (pkg?.monthly_price != null) return Number(pkg.monthly_price);
  return null;
}

export function effectiveMonthlyHours(
  project: Pick<ProjectRecord, "monthly_hours_override"> | null,
  pkg: Pick<PackageRecord, "monthly_hours"> | null
): number | null {
  if (project?.monthly_hours_override != null) return Number(project.monthly_hours_override);
  if (pkg?.monthly_hours != null) return Number(pkg.monthly_hours);
  return null;
}
