import {
  getSupabaseServiceClient,
  type InvoiceRecord,
  type InvoiceStatus,
} from "@/lib/supabase";

export interface InvoiceWithClient extends InvoiceRecord {
  client_name: string;
  client_email: string;
  client_phone: string | null;
  client_clerk_user_id: string | null;
  /**
   * Computed at read time. Equal to `status` unless `status === 'sent'`
   * and `due_date` is non-null and in the past — in which case the
   * computed value is `'overdue'`. The DB `status` column itself is
   * never auto-updated to 'overdue'; the UI partitions sent vs. overdue
   * via this derived field.
   */
  effective_status: InvoiceStatus;
}

/**
 * `'open'` means all rows where the DB status is `'sent'` — the UI
 * partitions them visually into "sent" and "overdue" using
 * `effective_status`. There is no DB-level 'overdue' status.
 */
export type InvoiceListStatusFilter = "all" | "open" | "draft" | "sent" | "paid";

const INVOICE_SELECT =
  "id, client_id, amount, due_date, paid_at, sent_at, status, stripe_payment_link, line_items, created_at, invoice_number, income_type, memo, clients!inner(name, email, phone, clerk_user_id)";

type RawInvoiceClient = {
  name: string;
  email: string | null;
  phone: string | null;
  clerk_user_id: string | null;
};

type RawInvoiceRow = InvoiceRecord & {
  clients: RawInvoiceClient | RawInvoiceClient[];
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function computeEffectiveStatus(
  status: InvoiceStatus,
  dueDate: string | null
): InvoiceStatus {
  if (status === "sent" && dueDate && dueDate < todayKey()) {
    return "overdue";
  }
  return status;
}

function flattenRow(row: RawInvoiceRow): InvoiceWithClient {
  const joined = Array.isArray(row.clients) ? row.clients[0] : row.clients;
  const clientName = joined?.name ?? "";
  const clientEmail = joined?.email ?? "";
  const clientPhone = joined?.phone ?? null;
  const clientClerkUserId = joined?.clerk_user_id ?? null;
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
    client_phone: clientPhone,
    client_clerk_user_id: clientClerkUserId,
    effective_status: computeEffectiveStatus(row.status, row.due_date),
  };
}

export async function fetchInvoices(filters?: {
  clientId?: string;
  status?: InvoiceListStatusFilter;
}): Promise<InvoiceWithClient[]> {
  const supabase = getSupabaseServiceClient();

  let query = supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .order("created_at", { ascending: false });

  if (filters?.clientId) {
    query = query.eq("client_id", filters.clientId);
  }
  const status = filters?.status ?? "all";
  if (status === "open") {
    query = query.in("status", ["sent"]);
  } else if (status === "draft" || status === "sent" || status === "paid") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawInvoiceRow[]).map(flattenRow);
}

export interface ClientPickerOption {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/**
 * Lightweight client list for the invoice form's client picker. Filters
 * out inactive clients — billing an inactive client is almost always a
 * mistake; if it isn't, reactivate the client first.
 */
export async function fetchClientsForPicker(): Promise<ClientPickerOption[]> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .select("id, name, email, phone")
    .neq("status", "inactive")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as ClientPickerOption[]).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
  }));
}

export async function fetchInvoiceById(
  id: string
): Promise<InvoiceWithClient | null> {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(INVOICE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return flattenRow(data as unknown as RawInvoiceRow);
}
