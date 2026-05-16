"use server";

import { requireOwner } from "@/lib/auth";
import {
  currentMonthKeyForExport,
  fetchMonthlyTimeLogsForExport,
} from "./_lib/queries";

export interface ActionResult<T = null> {
  ok: boolean;
  error?: string;
  data?: T;
}

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
 * RFC 4180 quoting: wrap any field containing comma, double-quote, CR, or LF
 * in double quotes, and escape internal `"` as `""`. Null/undefined → empty
 * string. Numbers are converted to strings (caller decides formatting).
 */
function csvEscape(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "number" ? String(value) : value;
  if (s === "") return "";
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

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
}
