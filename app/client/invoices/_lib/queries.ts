import { getSupabaseServiceClient } from "@/lib/supabase";
import type { InvoiceWithClient } from "@/app/owner/invoices/_lib/queries";

/**
 * Re-export the shared row shape so the client-side surface doesn't need
 * to know the type lives under `app/owner/invoices/_lib`. Keeps imports
 * symmetric with `_actions.ts`.
 */
export type { InvoiceWithClient } from "@/app/owner/invoices/_lib/queries";

const INVOICE_SELECT =
  "id, client_id, amount, due_date, paid_at, sent_at, status, stripe_payment_link, line_items, created_at, invoice_number, income_type, memo, clients!inner(name, email)";

type RawInvoiceRow = Omit<InvoiceWithClient, "client_name" | "client_email" | "effective_status"> & {
  clients: { name: string; email: string } | { name: string; email: string }[];
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function flattenRow(row: RawInvoiceRow): InvoiceWithClient {
  const joined = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  const clientName = joined?.name ?? "";
  const clientEmail = joined?.email ?? "";
  const today = todayKey();
  const effective =
    row.status === "sent" && row.due_date && row.due_date < today
      ? "overdue"
      : row.status;
  return {
    id: row.id,
    client_id: row.client_id,
    amount: Number(row.amount),
    due_date: row.due_date,
    paid_at: row.paid_at,
    status: row.status,
    stripe_payment_link: row.stripe_payment_link,
    line_items: row.line_items ?? [],
    created_at: row.created_at,
    sent_at: row.sent_at,
    invoice_number: row.invoice_number,
    income_type: row.income_type,
    memo: row.memo,
    client_name: clientName,
    client_email: clientEmail,
    effective_status: effective,
  };
}

/**
 * List the signed-in client's invoices. Drafts are excluded — they're
 * owner-side scratch work and should never appear in the client UI.
 * Ordered newest first.
 */
export async function fetchMyInvoices(
  clientId: string
): Promise<InvoiceWithClient[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("client_id", clientId)
    .neq("status", "draft")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawInvoiceRow[]).map(flattenRow);
}

/**
 * Fetch a single invoice with the ownership check baked in. Returns
 * null when the row is missing OR when it belongs to another client OR
 * when it is still a draft — the client UI must treat all three cases
 * identically (no leakage of "exists but not yours").
 */
export async function fetchMyInvoiceById(
  clientId: string,
  invoiceId: string
): Promise<InvoiceWithClient | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("id", invoiceId)
    .eq("client_id", clientId)
    .neq("status", "draft")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return flattenRow(data as unknown as RawInvoiceRow);
}
