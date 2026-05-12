"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import type {
  AvailabilityBlockRecord,
  ClientRecord,
} from "@/lib/supabase";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import type { ShootWithClientName } from "@/app/owner/shoots/_lib/queries";
import { ShootFormPanel } from "@/app/owner/shoots/_components/ShootFormPanel";
import { ShootRowActions } from "@/app/owner/shoots/_components/ShootRowActions";
import {
  shootStatusLabel,
  shootStatusTone,
} from "@/app/owner/shoots/_lib/format";
import { AvailabilityBlockFormPanel } from "./AvailabilityBlockFormPanel";
import { BlockRowActions } from "./BlockRowActions";
import {
  dateKey,
  defaultShootIsoForDay,
  formatTimeOnly,
  formatTimeRange,
  friendlyDate,
  weekdayLabel,
} from "../_lib/dateMath";
import { blocksForDate } from "../_lib/queries";

interface DaySidePanelProps {
  selectedDate: Date | null;
  shootsForDay: ShootWithClientName[];
  clients: Pick<ClientRecord, "id" | "name">[];
  closeHref: string;
  blocks: AvailabilityBlockRecord[];
}

export function DaySidePanel({
  selectedDate,
  shootsForDay,
  clients,
  closeHref,
  blocks,
}: DaySidePanelProps) {
  const router = useRouter();
  const [addShootOpen, setAddShootOpen] = useState(false);
  const [addBlockOpen, setAddBlockOpen] = useState(false);

  const handleClose = () => {
    setAddShootOpen(false);
    setAddBlockOpen(false);
    router.push(closeHref);
  };

  const isOpen = selectedDate !== null;
  const title = selectedDate ? friendlyDate(selectedDate) : "";
  const blocksForSelectedDay = selectedDate
    ? blocksForDate(blocks, selectedDate)
    : [];
  const selectedDateStr = selectedDate ? dateKey(selectedDate) : "";

  return (
    <>
      <SlidePanel open={isOpen} onClose={handleClose} title={title}>
        <div className="flex h-full flex-col">
          <div
            className="mb-6"
            style={{ display: "flex", flexDirection: "column", gap: 10 }}
          >
            <Button
              type="button"
              onClick={() => setAddShootOpen(true)}
              style={{ width: "100%" }}
            >
              + Add Shoot
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setAddBlockOpen(true)}
              style={{ width: "100%" }}
            >
              + Block Time
            </Button>
          </div>

          <section>
            <p className="eyebrow mb-3">Shoots</p>
            {shootsForDay.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                No shoots scheduled.
              </p>
            ) : (
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {shootsForDay.map((s) => {
                  const when = new Date(s.scheduled_at);
                  return (
                    <li
                      key={s.id}
                      style={{
                        border: "1px solid var(--border)",
                        padding: "12px 14px",
                        backgroundColor: "var(--surface-base)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 13,
                              color: "var(--text-primary)",
                              fontWeight: 600,
                              marginBottom: 2,
                            }}
                          >
                            {formatTimeOnly(when)} — {s.client_name || "—"}
                          </div>
                          {s.location && (
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--text-body)",
                                marginBottom: 6,
                              }}
                            >
                              {s.location}
                            </div>
                          )}
                          <StatusPill tone={shootStatusTone(s.status)}>
                            {shootStatusLabel(s.status)}
                          </StatusPill>
                        </div>
                        <ShootRowActions shoot={s} clients={clients} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <p className="eyebrow mb-3">Availability Blocks</p>
            {blocksForSelectedDay.length === 0 ? (
              <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
                No availability blocks for this day.
              </p>
            ) : (
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {blocksForSelectedDay.map((b) => (
                  <li
                    key={b.id}
                    style={{
                      border: "1px solid var(--border)",
                      padding: "12px 14px",
                      backgroundColor: "var(--surface-base)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 8,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 8,
                            flexWrap: "wrap",
                            fontSize: 13,
                            color: "var(--text-primary)",
                            fontWeight: 600,
                            marginBottom: 2,
                          }}
                        >
                          <span>
                            {formatTimeRange(b.start_time, b.end_time)}
                            {b.recurring_weekday !== null && (
                              <span
                                style={{
                                  color: "var(--text-muted)",
                                  fontWeight: 400,
                                }}
                              >
                                {" "}
                                · Recurring (every{" "}
                                {weekdayLabel(b.recurring_weekday)})
                              </span>
                            )}
                          </span>
                          {!b.is_blocked && (
                            <span
                              style={{
                                fontSize: 10,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: "var(--status-success)",
                                fontWeight: 600,
                              }}
                            >
                              Available
                            </span>
                          )}
                        </div>
                        {b.label && (
                          <div
                            style={{
                              fontSize: 12,
                              color: "var(--text-muted)",
                            }}
                          >
                            {b.label}
                          </div>
                        )}
                      </div>
                      <BlockRowActions
                        block={b}
                        canEdit={b.recurring_weekday === null}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </SlidePanel>

      {selectedDate && (
        <ShootFormPanel
          open={addShootOpen}
          onClose={() => setAddShootOpen(false)}
          clients={clients}
          defaultScheduledAt={defaultShootIsoForDay(selectedDate)}
        />
      )}

      {selectedDate && (
        <AvailabilityBlockFormPanel
          open={addBlockOpen}
          onClose={() => setAddBlockOpen(false)}
          date={selectedDateStr}
        />
      )}
    </>
  );
}
