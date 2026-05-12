"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { StatusPill } from "@/components/ui/StatusPill";
import type {
  AvailabilityBlockRecord,
  ShootRecord,
} from "@/lib/supabase";
import { SlidePanel } from "@/app/owner/clients/_components/SlidePanel";
import {
  dateKey,
  formatTimeOnly,
  friendlyDate,
} from "@/app/owner/calendar/_lib/dateMath";
import {
  shootStatusLabel,
  shootStatusTone,
} from "@/app/owner/shoots/_lib/format";
import { cancelMyShootRequest } from "../_actions";
import { RequestShootFormPanel } from "./RequestShootFormPanel";

interface ClientDaySidePanelProps {
  selectedDate: Date | null;
  myShootsForDay: ShootRecord[];
  blocksForDay: AvailabilityBlockRecord[];
  monthParam: string;
}

export function ClientDaySidePanel({
  selectedDate,
  myShootsForDay,
  blocksForDay,
  monthParam,
}: ClientDaySidePanelProps) {
  const router = useRouter();
  const [requestOpen, setRequestOpen] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const handleClose = () => {
    setRequestOpen(false);
    router.push(`/client/book?month=${monthParam}`);
  };

  const isOpen = selectedDate !== null;
  const title = selectedDate ? friendlyDate(selectedDate) : "";
  const selectedDateStr = selectedDate ? dateKey(selectedDate) : "";
  const hasAvailableBlock = blocksForDay.some((b) => !b.is_blocked);
  const hasBlockedBlock = blocksForDay.some((b) => b.is_blocked);
  const warningText = hasAvailableBlock
    ? "Kelsey has set specific availability for this day. You can request a time outside these windows, but she may not be able to accommodate."
    : hasBlockedBlock
      ? "Kelsey has limited availability on this day. You can still send a request — she'll review and respond."
      : null;

  const handleCancel = async (shoot: ShootRecord) => {
    const when = new Date(shoot.scheduled_at);
    const confirmed = window.confirm(
      `Cancel your shoot request for ${friendlyDate(when)}?`
    );
    if (!confirmed) return;

    setCancellingId(shoot.id);
    try {
      const result = await cancelMyShootRequest(shoot.id);
      if (!result.ok) {
        window.alert(result.error ?? "Failed to cancel request.");
        return;
      }
      router.refresh();
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <>
      <SlidePanel open={isOpen} onClose={handleClose} title={title}>
        <div className="flex h-full flex-col">
          {warningText && (
            <div
              style={{
                marginBottom: 20,
                padding: "12px 14px",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-body)",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {warningText}
            </div>
          )}

          <div style={{ marginBottom: 24 }}>
            <Button
              type="button"
              onClick={() => setRequestOpen(true)}
              style={{ width: "100%" }}
            >
              + Request a Shoot
            </Button>
          </div>

          {myShootsForDay.length > 0 && (
            <section>
              <p className="eyebrow mb-3">Your shoots</p>
              <ul
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {myShootsForDay.map((s) => {
                  const when = new Date(s.scheduled_at);
                  const isRequested = s.status === "requested";
                  const isCancelling = cancellingId === s.id;
                  const rowOpacity =
                    s.status === "cancelled"
                      ? 0.6
                      : s.status === "completed"
                        ? 0.7
                        : 1;
                  const textStrike =
                    s.status === "cancelled" ? "line-through" : undefined;
                  return (
                    <li
                      key={s.id}
                      style={{
                        border: "1px solid var(--border)",
                        padding: "12px 14px",
                        backgroundColor: "var(--surface-base)",
                        opacity: rowOpacity,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 8,
                          marginBottom: 6,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13,
                            color: "var(--text-primary)",
                            fontWeight: 600,
                            textDecoration: textStrike,
                          }}
                        >
                          {formatTimeOnly(when)}
                        </div>
                        <StatusPill tone={shootStatusTone(s.status)}>
                          {shootStatusLabel(s.status)}
                        </StatusPill>
                      </div>
                      {s.location && (
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text-body)",
                            marginBottom: isRequested ? 10 : 0,
                            textDecoration: textStrike,
                          }}
                        >
                          {s.location}
                        </div>
                      )}
                      {isRequested && (
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={isCancelling}
                          onClick={() => handleCancel(s)}
                          style={{
                            marginTop: 4,
                            padding: "6px 12px",
                            fontSize: 11,
                          }}
                        >
                          {isCancelling ? "Cancelling…" : "Cancel request"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </SlidePanel>

      {selectedDate && (
        <RequestShootFormPanel
          open={requestOpen}
          onClose={() => setRequestOpen(false)}
          defaultDate={selectedDateStr}
        />
      )}
    </>
  );
}
