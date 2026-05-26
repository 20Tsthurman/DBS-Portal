"use client";

import { useState } from "react";
import { DashboardCard } from "@/components/ui/DashboardCard";
import { MobileTableScroll } from "@/components/ui/MobileTableScroll";
import { StatusPill } from "@/components/ui/StatusPill";
import { InlineCell } from "@/app/owner/financials/_components/InlineCell";
import type { CommitResult } from "@/app/owner/financials/_lib/types";
import type { PackageRecord } from "@/lib/supabase";
import { updatePackageAction } from "../_actions";

interface PackagesTableSectionProps {
  initial: PackageRecord[];
}

// Stable order — matches fetchPackages (monthly_price ascending). Re-sorting
// after each commit keeps the row order consistent with a fresh server
// render if Kelsey changes a price that crosses another package's price.
function sortPackages(rows: PackageRecord[]): PackageRecord[] {
  return [...rows].sort((a, b) => {
    const ap = Number(a.monthly_price);
    const bp = Number(b.monthly_price);
    if (ap !== bp) return ap - bp;
    return a.tier.localeCompare(b.tier);
  });
}

export function PackagesTableSection({ initial }: PackagesTableSectionProps) {
  const [packages, setPackages] = useState(() => sortPackages(initial));

  const handleUpdate = async (
    id: string,
    patch: { name?: string; monthlyPrice?: number; monthlyHours?: number }
  ): Promise<CommitResult> => {
    const res = await updatePackageAction({ packageId: id, ...patch });
    if (!res.ok || !res.data) {
      return { ok: false, error: res.error };
    }
    const updated = res.data;
    setPackages((rows) =>
      sortPackages(rows.map((r) => (r.id === id ? updated : r)))
    );
    return { ok: true };
  };

  return (
    <DashboardCard eyebrow="PRICING" title="Packages">
      <MobileTableScroll minWidth={640}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 120 }}>Tier</th>
              <th>Name</th>
              <th style={{ textAlign: "right" }}>Monthly Price</th>
              <th style={{ textAlign: "right" }}>Monthly Hours</th>
            </tr>
          </thead>
          <tbody>
            {packages.map((row) => (
              <PackageRow key={row.id} row={row} onUpdate={handleUpdate} />
            ))}
          </tbody>
        </table>
      </MobileTableScroll>

      <p
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        Tier is fixed. Changes here apply to every client on this package who
        doesn&apos;t have a per-client override.
      </p>
    </DashboardCard>
  );
}

// ---------------------------------------------------------------------------
// PackageRow
// ---------------------------------------------------------------------------

interface PackageRowProps {
  row: PackageRecord;
  onUpdate: (
    id: string,
    patch: { name?: string; monthlyPrice?: number; monthlyHours?: number }
  ) => Promise<CommitResult>;
}

function PackageRow({ row, onUpdate }: PackageRowProps) {
  return (
    <tr className="st-row">
      <td>
        <StatusPill tone="neutral">{row.tier}</StatusPill>
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="text"
          label="Package name"
          value={row.name}
          onCommit={(v) =>
            onUpdate(row.id, { name: v === null ? "" : v })
          }
        />
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="money"
          label="Monthly price"
          value={Number(row.monthly_price)}
          align="right"
          onCommit={(v) => onUpdate(row.id, { monthlyPrice: v ?? 0 })}
        />
      </td>
      <td style={{ padding: 0 }}>
        <InlineCell
          type="number"
          label="Monthly hours"
          value={Number(row.monthly_hours)}
          align="right"
          onCommit={(v) => onUpdate(row.id, { monthlyHours: v ?? 0 })}
        />
      </td>
    </tr>
  );
}
