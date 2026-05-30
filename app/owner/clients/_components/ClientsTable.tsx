"use client";

import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  MobileCard,
  MobileCardActions,
  MobileCardField,
  MobileCardHeader,
  MobileCardList,
} from "@/components/ui/MobileCard";
import { effectiveMonthlyPrice } from "@/lib/pricing";
import type { ClientWithRelations } from "../_lib/queries";
import {
  clientStatusLabel,
  clientStatusTone,
  formatCurrency,
  formatDate,
  formatHours,
} from "../_lib/format";
import { TypePill } from "./TypePill";
import { applyFocus, clearFocus, fieldStyle } from "./formStyles";
import { togglePinClient } from "../_actions";

type TypeFilter = "all" | "brand" | "bride";
type StatusFilter = "all" | "lead" | "onboarding" | "active" | "inactive";

const TYPE_FILTERS: ReadonlyArray<{ value: TypeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "brand", label: "Brand" },
  { value: "bride", label: "Bride" },
];

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "lead", label: "Lead" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

interface ClientsTableProps {
  clients: ClientWithRelations[];
}

export function ClientsTable({ clients }: ClientsTableProps) {
  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Optimistic pin overrides keyed by client id. An entry wins over the
  // server-provided client.pinned so a toggled row re-sorts to the top
  // immediately; on action failure we roll the entry back to its prior value.
  const [pinOverrides, setPinOverrides] = useState<Record<string, boolean>>({});
  const [isPending, startTransition] = useTransition();

  const isPinned = (row: ClientWithRelations): boolean =>
    pinOverrides[row.client.id] ?? row.client.pinned;

  const handleTogglePin = (row: ClientWithRelations) => {
    const id = row.client.id;
    const current = isPinned(row);
    const next = !current;
    // Optimistic flip so the row re-sorts immediately.
    setPinOverrides((o) => ({ ...o, [id]: next }));
    startTransition(async () => {
      const res = await togglePinClient(id, next);
      if (!res.ok) {
        // Roll the optimistic value back on failure.
        setPinOverrides((o) => ({ ...o, [id]: current }));
      }
    });
  };

  // Derived list: case-insensitive name search → type → status, then sorted
  // pinned-first and created_at DESC within each group. (Server-side ORDER BY
  // in fetchClientsWithRelations is left untouched; all sorting happens here.)
  const query = searchText.trim().toLowerCase();
  const visible = clients
    .filter((row) => row.client.name.toLowerCase().includes(query))
    .filter((row) => typeFilter === "all" || row.client.type === typeFilter)
    .filter(
      (row) => statusFilter === "all" || row.client.status === statusFilter
    )
    .slice()
    .sort((a, b) => {
      const ap = isPinned(a) ? 1 : 0;
      const bp = isPinned(b) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      return b.client.created_at.localeCompare(a.client.created_at);
    });

  return (
    <>
      <div className="clients-toolbar">
        <div className="clients-toolbar-search">
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onFocus={applyFocus}
            onBlur={clearFocus}
            placeholder="Search clients"
            aria-label="Search clients"
            style={fieldStyle}
          />
        </div>
        <div className="clients-toolbar-filters">
          <PillGroup
            options={TYPE_FILTERS}
            active={typeFilter}
            onSelect={setTypeFilter}
            ariaLabel="Filter by type"
          />
          <PillGroup
            options={STATUS_FILTERS}
            active={statusFilter}
            onSelect={setStatusFilter}
            ariaLabel="Filter by status"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          className="border px-8 py-16 text-center"
          style={{
            borderColor: "var(--border)",
            backgroundColor: "var(--surface-raised)",
            color: "var(--text-muted)",
            fontSize: "14px",
          }}
        >
          No clients match
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
                {visible.map(({ client, project, pkg, hoursThisMonth }) => {
                  const pinned = isPinned({
                    client,
                    project,
                    pkg,
                    hoursThisMonth,
                  });
                  return (
                    <tr key={client.id} className="row-hover">
                      <td
                        style={{
                          color: "var(--text-primary)",
                          fontWeight: 600,
                          borderLeft: pinned
                            ? "2px solid var(--accent)"
                            : "2px solid transparent",
                        }}
                      >
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
                      <td>
                        {formatCurrency(effectiveMonthlyPrice(project, pkg))}
                      </td>
                      <td>{formatHours(hoursThisMonth)}</td>
                      <td style={{ textAlign: "right" }}>
                        <div
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "flex-end",
                            gap: 16,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              handleTogglePin({
                                client,
                                project,
                                pkg,
                                hoursThisMonth,
                              })
                            }
                            disabled={isPending}
                            aria-pressed={pinned}
                            style={{
                              ...actionTextStyle,
                              background: "transparent",
                              border: "none",
                              padding: 0,
                              cursor: isPending ? "default" : "pointer",
                              opacity: isPending ? 0.6 : 1,
                            }}
                          >
                            {pinned ? "Pinned" : "Pin"}
                          </button>
                          <Link
                            href={`/owner/clients/${client.id}`}
                            style={actionTextStyle}
                          >
                            View
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <MobileCardList className="lg:hidden">
            {visible.map(({ client, project, pkg, hoursThisMonth }) => {
              const pinned = isPinned({
                client,
                project,
                pkg,
                hoursThisMonth,
              });
              return (
                <MobileCard
                  key={client.id}
                  style={
                    pinned
                      ? { borderLeftWidth: 2, borderLeftColor: "var(--accent)" }
                      : undefined
                  }
                >
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
                    <button
                      type="button"
                      onClick={() =>
                        handleTogglePin({
                          client,
                          project,
                          pkg,
                          hoursThisMonth,
                        })
                      }
                      disabled={isPending}
                      aria-pressed={pinned}
                      style={{
                        ...actionTextStyle,
                        background: "transparent",
                        border: "none",
                        cursor: isPending ? "default" : "pointer",
                        opacity: isPending ? 0.6 : 1,
                      }}
                    >
                      {pinned ? "Pinned" : "Pin"}
                    </button>
                    <Link
                      href={`/owner/clients/${client.id}`}
                      style={actionTextStyle}
                    >
                      View →
                    </Link>
                  </MobileCardActions>
                </MobileCard>
              );
            })}
          </MobileCardList>
        </>
      )}

      <style>{`
        .row-hover:hover td {
          background-color: var(--surface-base);
        }
        .clients-toolbar {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
          margin-bottom: 24px;
        }
        .clients-toolbar-search {
          flex: 0 0 280px;
          max-width: 100%;
        }
        .clients-toolbar-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
          align-items: center;
        }
        @media (max-width: 640px) {
          .clients-toolbar-search {
            flex-basis: 100%;
          }
        }
      `}</style>
    </>
  );
}

// Client-side segmented pill group. Mirrors the visual of
// invoices/_components/StatusFilterPills (pillStyle, active = accent/#FFF,
// inactive = transparent/text-body) but toggles local state via onClick
// instead of navigating to a URL.
function PillGroup<T extends string>({
  options,
  active,
  onSelect,
  ariaLabel,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  active: T;
  onSelect: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div style={{ display: "inline-flex" }} role="group" aria-label={ariaLabel}>
      {options.map((item, i) => {
        const isActive = item.value === active;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(item.value)}
            style={{
              ...pillStyle,
              borderRight:
                i < options.length - 1 ? "none" : "1px solid var(--border)",
              backgroundColor: isActive ? "var(--accent)" : "transparent",
              color: isActive ? "#FFFFFF" : "var(--text-body)",
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

// Matches the existing "VIEW" link affordance on the roster.
const actionTextStyle: CSSProperties = {
  color: "var(--accent)",
  fontSize: "13px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontFamily: "inherit",
};

const pillStyle: CSSProperties = {
  padding: "8px 16px",
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  border: "1px solid var(--border)",
  fontFamily: "inherit",
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};
