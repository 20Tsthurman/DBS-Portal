"use client";

import { useTransition } from "react";
import { exportMonthlyTimeLogsAction } from "../_actions";

/**
 * Triggers the CSV export action then drives a browser download via Blob.
 *
 * We do download via Blob/URL.createObjectURL + a synthetic anchor rather
 * than a route handler so the action's owner-only guard (`requireOwner()`)
 * is the single auth gate — no parallel `/api/...` route to keep in sync.
 */
export function ExportMonthlyCsvButton() {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const result = await exportMonthlyTimeLogsAction();
      if (!result.ok || !result.data) {
        // Owner-only, rare action — alert is fine per spec.
        alert(result.error ?? "Failed to export CSV.");
        return;
      }

      const { csv, filename } = result.data;
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // Give the browser a tick to start the download before revoking.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      style={{
        fontFamily: "inherit",
        fontSize: 13,
        color: "var(--text-primary)",
        border: "1px solid var(--border)",
        background: "var(--surface-raised)",
        padding: "8px 16px",
        cursor: isPending ? "not-allowed" : "pointer",
        opacity: isPending ? 0.6 : 1,
      }}
    >
      {isPending ? "Exporting…" : "Export this month to CSV"}
    </button>
  );
}
