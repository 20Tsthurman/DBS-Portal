/**
 * CPA Financial Package — production download Route Handler.
 *
 * Owner-gated (requireOwnerApi). Streams the @react-pdf buffer directly as a
 * file attachment — no Supabase Storage, no `files` row, because a CPA package
 * is not client-scoped (unlike invoices/receipts). This is the throwaway Phase-2
 * debug route's mechanism, now made permanent and parameterized by range.
 *
 * Query contract:
 *   ?preset=this_year | last_year | q1 | q2 | q3 | q4
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD            (custom range)
 *   (nothing)                                   → defaults to This Year
 *
 * CRITICAL date handling: every range Date is built with the LOCAL constructor
 * `new Date(year, monthIndex, day)`, derived from the same integers used to
 * build the YYYY-MM-DD string keys. We NEVER pass a "YYYY-MM-DD" string to the
 * Date constructor — that parses as UTC midnight and, in a negative-offset zone
 * like Central, rolls `.getDate()` back a day, which would wrongly trip the
 * partial-year warning banner on a legitimate full-year export.
 */

import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import {
  shortDateLabelForDateKey,
} from "@/app/owner/calendar/_lib/timezone";
import { dateKeyInTimezone } from "@/lib/date";
import { aggregateCpaPackage } from "@/app/owner/financials/_lib/cpaPackage";
import type { FinancialsRange } from "@/app/owner/financials/_lib/queries";
import {
  buildCpaPackagePdfProps,
  renderCpaPackagePdfBuffer,
} from "@/lib/cpaPackagePdf";

// @react-pdf/renderer needs the Node runtime (not edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KNOWN_PRESETS = [
  "this_year",
  "last_year",
  "q1",
  "q2",
  "q3",
  "q4",
] as const;
type Preset = (typeof KNOWN_PRESETS)[number];
type Quarter = Exclude<Preset, "this_year" | "last_year">;

const QUARTERS: Record<
  Quarter,
  { startM: number; startD: number; endM: number; endD: number; label: string }
> = {
  q1: { startM: 1, startD: 1, endM: 3, endD: 31, label: "Q1" },
  q2: { startM: 4, startD: 1, endM: 6, endD: 30, label: "Q2" },
  q3: { startM: 7, startD: 1, endM: 9, endD: 30, label: "Q3" },
  q4: { startM: 10, startD: 1, endM: 12, endD: 31, label: "Q4" },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

interface ResolvedRange {
  range: FinancialsRange;
  rangeStart: Date;
  rangeEnd: Date;
  filename: string;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(y: number, m1: number, d: number): string {
  return `${y}-${pad2(m1)}-${pad2(d)}`;
}

function isValidDateKey(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [, m, d] = s.split("-").map(Number);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/**
 * Build the resolved range from integer parts. The string keys (for the DB
 * filter) and the local Dates (for the full-year check) come from the SAME
 * integers, so they can't drift apart.
 */
function buildResolved(
  startY: number,
  startM: number,
  startD: number,
  endY: number,
  endM: number,
  endD: number,
  label: string
): ResolvedRange {
  const start = dateKey(startY, startM, startD);
  const end = dateKey(endY, endM, endD);
  const isFullYear =
    startY === endY &&
    startM === 1 &&
    startD === 1 &&
    endM === 12 &&
    endD === 31;
  const filename = isFullYear
    ? `cpa-package-${startY}.pdf`
    : `cpa-package-${start}_${end}.pdf`;
  return {
    range: { start, end, label },
    rangeStart: new Date(startY, startM - 1, startD),
    rangeEnd: new Date(endY, endM - 1, endD),
    filename,
  };
}

function customLabel(startKey: string, endKey: string): string {
  const startYear = Number(startKey.slice(0, 4));
  const endYear = Number(endKey.slice(0, 4));
  // "Jan 1 – Jun 5, 2026" (same year) / "Dec 30, 2025 – Jan 5, 2026" (crosses).
  if (startYear === endYear) {
    return `${shortDateLabelForDateKey(startKey)} – ${shortDateLabelForDateKey(
      endKey
    )}, ${endYear}`;
  }
  return `${shortDateLabelForDateKey(startKey)}, ${startYear} – ${shortDateLabelForDateKey(
    endKey
  )}, ${endYear}`;
}

function fullYearResolved(year: number): ResolvedRange {
  return buildResolved(year, 1, 1, year, 12, 31, `${year} (full year)`);
}

export async function GET(request: Request): Promise<Response> {
  const denied = await requireOwnerApi();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const presetParam = searchParams.get("preset");
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  // Current year in the portal timezone (not server-local) so quarters and
  // "this year" line up with the rest of the financials surface.
  const currentYear = Number(dateKeyInTimezone(new Date()).slice(0, 4));

  let resolved: ResolvedRange;

  if (presetParam && (KNOWN_PRESETS as readonly string[]).includes(presetParam)) {
    const preset = presetParam as Preset;
    if (preset === "this_year") {
      resolved = fullYearResolved(currentYear);
    } else if (preset === "last_year") {
      resolved = fullYearResolved(currentYear - 1);
    } else {
      const q = QUARTERS[preset];
      resolved = buildResolved(
        currentYear,
        q.startM,
        q.startD,
        currentYear,
        q.endM,
        q.endD,
        `${q.label} ${currentYear}`
      );
    }
  } else if (startParam && endParam) {
    if (
      !isValidDateKey(startParam) ||
      !isValidDateKey(endParam) ||
      endParam < startParam
    ) {
      return NextResponse.json(
        { error: "Invalid custom date range" },
        { status: 400 }
      );
    }
    const [sy, sm, sd] = startParam.split("-").map(Number);
    const [ey, em, ed] = endParam.split("-").map(Number);
    resolved = buildResolved(
      sy,
      sm,
      sd,
      ey,
      em,
      ed,
      customLabel(startParam, endParam)
    );
  } else {
    // No (or unrecognized) preset and no custom range → default to This Year.
    resolved = fullYearResolved(currentYear);
  }

  const data = await aggregateCpaPackage(resolved.range);
  const props = buildCpaPackagePdfProps(data, {
    rangeLabel: resolved.range.label,
    rangeStart: resolved.rangeStart,
    rangeEnd: resolved.rangeEnd,
    preparedOn: new Date(),
  });
  const buffer = await renderCpaPackagePdfBuffer(props);

  // Wrap in a plain Uint8Array — Node's Buffer<ArrayBufferLike> doesn't satisfy
  // the web `BodyInit` type the Response constructor expects.
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${resolved.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
