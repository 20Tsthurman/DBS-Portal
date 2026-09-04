import type { CSSProperties } from "react";
import type { ShootStatus } from "@/lib/supabase";

interface StatusBadgeProps {
  status: ShootStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span style={styleFor(status)}>{labelFor(status)}</span>;
}

function labelFor(status: ShootStatus): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "confirmed":
      return "Confirmed";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "declined":
      return "Not available";
  }
}

function styleFor(status: ShootStatus): CSSProperties {
  switch (status) {
    case "confirmed":
      return confirmedBadge;
    case "completed":
      return completedBadge;
    case "cancelled":
      return cancelledBadge;
    case "declined":
      return declinedBadge;
    case "requested":
    default:
      return requestedBadge;
  }
}

const badgeBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  height: 24,
  padding: "0 10px",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  whiteSpace: "nowrap",
};

const confirmedBadge: CSSProperties = {
  ...badgeBase,
  backgroundColor: "var(--accent)",
  color: "#FFFFFF",
  border: "1px solid var(--accent)",
};

const requestedBadge: CSSProperties = {
  ...badgeBase,
  backgroundColor: "transparent",
  color: "var(--text-muted)",
  border: "1px dashed var(--text-muted)",
};

const completedBadge: CSSProperties = {
  ...badgeBase,
  backgroundColor: "var(--text-muted)",
  color: "#FFFFFF",
  border: "1px solid var(--text-muted)",
};

const cancelledBadge: CSSProperties = {
  ...badgeBase,
  backgroundColor: "transparent",
  color: "var(--status-danger)",
  border: "1px dashed var(--status-danger)",
};

// Solid where `cancelled` is dashed: a decline is a settled answer from
// Kelsey, not a request left hanging. The label says "Not available" rather
// than "Declined" — the slot is what was turned down, not the client.
const declinedBadge: CSSProperties = {
  ...badgeBase,
  backgroundColor: "rgba(122, 48, 64, 0.10)",
  color: "var(--status-danger)",
  border: "1px solid var(--status-danger)",
};
