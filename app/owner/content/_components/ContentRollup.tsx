"use client";

import { useCallback, useState, type CSSProperties } from "react";
import {
  DEFAULT_POLL_INTERVAL_MS,
  useVisibilityPolling,
} from "@/lib/hooks/useVisibilityPolling";
import type { CycleRollup } from "../_lib/rollup";

interface ContentRollupProps {
  cycleId: string;
  /** Server-rendered counts, so the strip is never blank on first paint. */
  initial: CycleRollup;
}

/**
 * Where the client stands in a released month (spec 4.5).
 *
 * READ-ONLY BY CONSTRUCTION. No links, no buttons, nothing clickable. Spec 4.5
 * makes this informational and 4.6 explains why nothing hangs off it: Kelsey
 * cannot reliably distinguish "finished" from "paused partway through" by
 * watching these numbers, so locking a month is the deadline sweep's job, not
 * something this panel should invite.
 *
 * Polls the same way every other live surface in the portal does -
 * `useVisibilityPolling` at the shared 30s cadence, which tears the interval
 * down when the tab is hidden and fires one immediate fetch on return. Thirty
 * seconds, not the six the asset-status poll uses: a transcode resolves in
 * seconds while Kelsey watches, but a client works through a queue over days.
 * There is nothing here worth a faster tick.
 *
 * A failed poll is silent on screen and loud in the console. These are counts
 * Kelsey is glancing at, not acting on; an error banner over a number that is
 * thirty seconds stale would be louder than the problem.
 */
export function ContentRollup({ cycleId, initial }: ContentRollupProps) {
  const [rollup, setRollup] = useState<CycleRollup>(initial);

  const poll = useCallback(
    async (signal: AbortSignal) => {
      try {
        const res = await fetch(
          `/api/owner/content/rollup?cycleId=${encodeURIComponent(cycleId)}`,
          { cache: "no-store", signal }
        );
        if (!res.ok) {
          console.error("[content] rollup poll failed", res.status);
          return;
        }
        const json = (await res.json()) as { rollup?: CycleRollup };
        if (json.rollup) setRollup(json.rollup);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        console.error("[content] rollup poll error", err);
      }
    },
    [cycleId]
  );

  useVisibilityPolling(poll, { intervalMs: DEFAULT_POLL_INTERVAL_MS });

  return (
    <div style={barStyle}>
      <span style={headingStyle}>Client progress</span>
      <div style={countsStyle}>
        <Count label="Approved" value={rollup.approved} tone="success" />
        <Count label="Changes requested" value={rollup.revised} tone="accent" />
        <Count label="Not reviewed yet" value={rollup.untouched} tone="muted" />
      </div>
      <span style={totalStyle}>
        {rollup.total} {rollup.total === 1 ? "post" : "posts"} released
      </span>
    </div>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "accent" | "muted";
}) {
  const color =
    tone === "success"
      ? "var(--status-success)"
      : tone === "accent"
        ? "var(--accent)"
        : "var(--text-muted)";
  return (
    <span style={countStyle}>
      <strong style={{ ...valueStyle, color }}>{value}</strong>
      <span style={labelStyle}>{label}</span>
    </span>
  );
}

const barStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "8px 20px",
  border: "1px solid var(--border)",
  borderTop: "none",
  backgroundColor: "var(--surface-base)",
  padding: "10px 16px",
  // Sits directly under the cycle bar, which owns the margin between them.
  marginBottom: 16,
};

const headingStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

const countsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: "8px 18px",
};

const countStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: 6,
};

const valueStyle: CSSProperties = {
  fontFamily: "var(--font-playfair), serif",
  fontSize: 18,
  fontWeight: 500,
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-body)",
};

const totalStyle: CSSProperties = {
  marginLeft: "auto",
  fontSize: 12,
  color: "var(--text-muted)",
};
