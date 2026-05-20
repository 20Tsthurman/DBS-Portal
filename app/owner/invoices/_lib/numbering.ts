/**
 * Invoice number generator.
 *
 * Format: INV-YYYY-NNNN (four-digit zero-padded suffix, reset each
 * calendar year, year derived from UTC `now`).
 *
 * Concurrency: two simultaneous calls can return the same number.
 * The partial unique index on `invoices.invoice_number` (see
 * `supabase/migrations/003_invoices.sql`) catches the collision; the
 * create action retries once on a unique-violation error and gives up
 * on a second collision.
 */

import { getSupabaseServiceClient } from "@/lib/supabase";

const PREFIX_FORMAT = (year: number) => `INV-${year}-`;
const SUFFIX_WIDTH = 4;

export async function generateNextInvoiceNumber(): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = PREFIX_FORMAT(year);

  const supabase = getSupabaseServiceClient();

  // Order by invoice_number desc with the current year prefix — the
  // string ordering on a zero-padded fixed-width suffix matches numeric
  // ordering, so the top row is the highest-numbered invoice for the year.
  const { data, error } = await supabase
    .from("invoices")
    .select("invoice_number")
    .like("invoice_number", `${prefix}%`)
    .order("invoice_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Could not read latest invoice number: ${error.message}`);
  }

  let next = 1;
  if (data?.invoice_number) {
    const suffix = data.invoice_number.slice(prefix.length);
    const parsed = Number.parseInt(suffix, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      next = parsed + 1;
    }
  }

  return `${prefix}${String(next).padStart(SUFFIX_WIDTH, "0")}`;
}
