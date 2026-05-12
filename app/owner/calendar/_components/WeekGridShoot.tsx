"use client";

import { useState } from "react";
import type { ClientRecord, ShootStatus } from "@/lib/supabase";
import type { ShootWithClientName } from "@/app/owner/shoots/_lib/queries";
import { ShootFormPanel } from "@/app/owner/shoots/_components/ShootFormPanel";
import { formatTimeOnly } from "../_lib/dateMath";

interface WeekGridShootProps {
  shoot: ShootWithClientName;
  clients: Pick<ClientRecord, "id" | "name">[];
  top: number;
  height: number;
}

interface PillVisuals {
  backgroundColor: string;
  color: string;
  borderLeft?: string;
  textDecoration?: string;
}

function pillStyle(status: ShootStatus): PillVisuals {
  switch (status) {
    case "confirmed":
      return {
        backgroundColor: "var(--accent)",
        color: "#FFFFFF",
      };
    case "requested":
      return {
        backgroundColor: "var(--surface-raised)",
        color: "var(--text-primary)",
        borderLeft: "3px solid var(--text-muted)",
      };
    case "completed":
      return {
        backgroundColor: "rgba(45, 106, 79, 0.4)",
        color: "var(--text-body)",
        textDecoration: "line-through",
      };
    case "cancelled":
      return {
        backgroundColor: "rgba(122, 48, 64, 0.3)",
        color: "var(--text-body)",
        textDecoration: "line-through",
      };
  }
}

export function WeekGridShoot({
  shoot,
  clients,
  top,
  height,
}: WeekGridShootProps) {
  const [editOpen, setEditOpen] = useState(false);
  const when = new Date(shoot.scheduled_at);
  const visuals = pillStyle(shoot.status);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setEditOpen(true);
        }}
        title={`${formatTimeOnly(when)} — ${shoot.client_name}${shoot.location ? ` · ${shoot.location}` : ""}`}
        style={{
          position: "absolute",
          top,
          left: 2,
          right: 2,
          height,
          border: "none",
          padding: "4px 8px",
          fontSize: 11,
          lineHeight: 1.3,
          textAlign: "left",
          cursor: "pointer",
          overflow: "hidden",
          fontFamily: "inherit",
          zIndex: 2,
          ...visuals,
        }}
      >
        <div
          style={{
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {formatTimeOnly(when)}
        </div>
        <div
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {shoot.client_name || "—"}
          {shoot.status === "requested" && (
            <span
              style={{
                fontStyle: "italic",
                color: "var(--text-muted)",
              }}
            >
              {" "}
              (Pending)
            </span>
          )}
        </div>
      </button>
      <ShootFormPanel
        open={editOpen}
        onClose={() => setEditOpen(false)}
        clients={clients}
        shoot={shoot}
      />
    </>
  );
}
