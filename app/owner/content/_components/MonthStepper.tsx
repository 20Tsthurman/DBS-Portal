import Link from "next/link";
import type { CSSProperties } from "react";
import {
  addMonthsToMonthKey,
  formatMonthLabel,
} from "@/app/owner/calendar/_lib/timezone";
import { contentHref, type ContentView } from "../_lib/href";

interface MonthStepperProps {
  monthKey: string;
  clientId: string | null;
  view: ContentView;
}

/**
 * Month selector for both content views. A cycle IS a month, so the surface
 * needs a way to move between them — this is a filter control that preserves
 * the client filter and the calendar/list view.
 */
export function MonthStepper({ monthKey, clientId, view }: MonthStepperProps) {
  return (
    <div style={rowStyle}>
      <Link
        href={contentHref({
          monthKey: addMonthsToMonthKey(monthKey, -1),
          clientId,
          view,
        })}
        aria-label="Previous month"
        style={stepStyle}
      >
        ‹
      </Link>
      <span style={labelStyle}>{formatMonthLabel(monthKey)}</span>
      <Link
        href={contentHref({
          monthKey: addMonthsToMonthKey(monthKey, 1),
          clientId,
          view,
        })}
        aria-label="Next month"
        style={stepStyle}
      >
        ›
      </Link>
    </div>
  );
}

const rowStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid var(--border)",
  marginBottom: 16,
};

const stepStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 44,
  minHeight: 44,
  fontSize: 20,
  lineHeight: 1,
  color: "var(--text-body)",
  textDecoration: "none",
};

const labelStyle: CSSProperties = {
  padding: "0 16px",
  fontFamily: "var(--font-playfair), serif",
  fontSize: 16,
  color: "var(--text-primary)",
  whiteSpace: "nowrap",
};
