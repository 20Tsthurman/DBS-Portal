"use server";

import { requireOwner } from "@/lib/auth";
import { csvEscape } from "@/lib/csv";
import type { ActionResult } from "@/lib/actions";
import {
  currentMonthKeyForExport,
  fetchMonthlyTimeLogsForExport,
} from "./_lib/queries";

export interface MonthlyCsvExport {
  /** YYYY-MM month bucket the CSV covers (Central time). */
  monthKey: string;
  /** Suggested filename, e.g. `time-logs-2026-05.csv`. */
  filename: string;
  /** RFC-4180 CSV body, including header row. */
  csv: string;
}

const CSV_HEADERS = [
  "Date",
  "Client",
  "Category",
  "Hours",
  "Notes",
  "Logged By",
  "Created At",
];

/**
 * Owner-only. Returns the CSV body for every time_log in the current Central
 * month (sorted by date asc, created_at asc). The client component triggers
 * the download via Blob + URL.createObjectURL — we don't stream a Response
 * because returning the body in the action keeps the auth check and the
 * timezone math co-located with everything else in this folder.
 */
export async function exportMonthlyTimeLogsAction(): Promise<
  ActionResult<MonthlyCsvExport>
> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  try {
    const logs = await fetchMonthlyTimeLogsForExport();
    const monthKey = currentMonthKeyForExport();

    const lines: string[] = [];
    lines.push(CSV_HEADERS.map(csvEscape).join(","));
    for (const log of logs) {
      const row = [
        log.date,
        log.clientName,
        log.category,
        Number(log.hours).toString(),
        log.notes ?? "",
        log.logged_by,
        log.created_at,
      ];
      lines.push(row.map(csvEscape).join(","));
    }
    // RFC 4180 prefers CRLF between records.
    const csv = lines.join("\r\n");

    return {
      ok: true,
      data: {
        monthKey,
        filename: `time-logs-${monthKey}.csv`,
        csv,
      },
    };
  } catch (err) {
    console.error("[exportMonthlyTimeLogsAction]", err);
    return {
      ok: false,
      error: "Could not generate export. Please try again.",
    };
  }
}
