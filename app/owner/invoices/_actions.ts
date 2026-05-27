"use server";

import { revalidatePath } from "next/cache";
import { Resend } from "resend";
import { requireOwner } from "@/lib/auth";
import {
  getSupabaseServiceClient,
  type IncomeType,
  type InvoiceRecord,
} from "@/lib/supabase";
import { isPositiveFiniteNumber, isValidDateKey } from "@/lib/validation";
import type { ActionResult } from "@/lib/actions";
import {
  buildStoragePath,
  createSignedDownloadUrl,
  uploadServerBuffer,
} from "@/lib/storage";
import { renderInvoicePdfBuffer } from "@/lib/invoicePdf";
import {
  buildInvoicePaymentConfirmationEmailHtml,
  buildInvoiceSentEmailHtml,
} from "@/lib/invoiceEmails";
import { resolveBaseUrl } from "@/lib/baseUrl";
import { generateNextInvoiceNumber } from "./_lib/numbering";
import { fetchInvoiceById } from "./_lib/queries";

const INCOME_TYPES: IncomeType[] = [
  "brand_retainer",
  "wedding_same_day",
  "one_off_shoot",
  "other",
];

const PAYMENT_METHODS = [
  "zelle",
  "venmo",
  "direct_deposit",
  "check",
  "cash",
  "other",
] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const MAX_LINE_ITEMS = 20;
const MAX_DESCRIPTION_LENGTH = 200;

const BUSINESS_NAME = "Digital Bloom Socials";
const BUSINESS_EMAIL = "digitalbloomsocials@gmail.com";

interface ValidatedLineItem {
  description: string;
  amount: number;
}

interface ValidatedLineItems {
  items: ValidatedLineItem[];
  total: number;
}

function validateLineItems(
  raw: Array<{ description: string; amount: number }>
): { ok: true; value: ValidatedLineItems } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: "At least one line item is required" };
  }
  if (raw.length > MAX_LINE_ITEMS) {
    return { ok: false, error: `At most ${MAX_LINE_ITEMS} line items allowed` };
  }
  const items: ValidatedLineItem[] = [];
  let total = 0;
  for (const item of raw) {
    if (typeof item?.description !== "string") {
      return { ok: false, error: "Line item description is required" };
    }
    const description = item.description.trim();
    if (!description) {
      return { ok: false, error: "Line item description cannot be empty" };
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return {
        ok: false,
        error: `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`,
      };
    }
    if (!isPositiveFiniteNumber(item.amount)) {
      return {
        ok: false,
        error: "Line item amount must be greater than 0",
      };
    }
    items.push({ description, amount: item.amount });
    total += item.amount;
  }
  return { ok: true, value: { items, total } };
}

function isFutureOrToday(date: string): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return date >= today;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatDateLong(yyyyMmDd: string): string {
  // Build with explicit UTC noon so the local-tz interpretation can't
  // roll the day backwards in negative-offset environments.
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function revalidateInvoiceSurfaces(
  clientId: string | null
): Promise<void> {
  revalidatePath("/owner/invoices");
  if (clientId) revalidatePath(`/owner/clients/${clientId}`);
}

// ---------------------------------------------------------------------------
// createInvoiceAction
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  clientId: string;
  lineItems: Array<{ description: string; amount: number }>;
  dueDate: string | null;
  memo: string | null;
  incomeType: IncomeType;
}

export async function createInvoiceAction(
  input: CreateInvoiceInput
): Promise<ActionResult<InvoiceRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.clientId) return { ok: false, error: "Missing client id" };

  const lineCheck = validateLineItems(input.lineItems);
  if (!lineCheck.ok) return { ok: false, error: lineCheck.error };

  if (input.dueDate !== null) {
    if (!isValidDateKey(input.dueDate)) {
      return { ok: false, error: "Invalid due date" };
    }
    if (!isFutureOrToday(input.dueDate)) {
      return { ok: false, error: "Due date must be today or in the future" };
    }
  }
  if (!INCOME_TYPES.includes(input.incomeType)) {
    return { ok: false, error: "Invalid income type" };
  }

  const memo = input.memo?.trim() || null;
  const supabase = getSupabaseServiceClient();

  // One-shot retry on the partial-unique-index collision documented in
  // _lib/numbering.ts. Two concurrent creates can race and both compute
  // the same next number; the DB rejects the second one with code 23505.
  const tryInsert = async (): Promise<{
    data: InvoiceRecord | null;
    error: { code?: string; message: string } | null;
  }> => {
    const invoiceNumber = await generateNextInvoiceNumber();
    const res = await supabase
      .from("invoices")
      .insert({
        client_id: input.clientId,
        amount: lineCheck.value.total,
        due_date: input.dueDate,
        status: "draft",
        line_items: lineCheck.value.items,
        invoice_number: invoiceNumber,
        income_type: input.incomeType,
        memo,
      })
      .select("*")
      .single();
    return {
      data: (res.data ?? null) as InvoiceRecord | null,
      error: res.error
        ? { code: (res.error as { code?: string }).code, message: res.error.message }
        : null,
    };
  };

  try {
    let result = await tryInsert();
    if (result.error && result.error.code === "23505") {
      result = await tryInsert();
    }
    if (result.error || !result.data) {
      return {
        ok: false,
        error: result.error?.message ?? "Failed to create invoice",
      };
    }
    await revalidateInvoiceSurfaces(input.clientId);
    return { ok: true, data: result.data };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to create invoice",
    };
  }
}

// ---------------------------------------------------------------------------
// updateInvoiceAction
// ---------------------------------------------------------------------------

export interface UpdateInvoiceInput {
  invoiceId: string;
  lineItems: Array<{ description: string; amount: number }>;
  dueDate: string | null;
  memo: string | null;
  incomeType: IncomeType;
}

export async function updateInvoiceAction(
  input: UpdateInvoiceInput
): Promise<ActionResult<InvoiceRecord>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  const lineCheck = validateLineItems(input.lineItems);
  if (!lineCheck.ok) return { ok: false, error: lineCheck.error };

  if (input.dueDate !== null && !isValidDateKey(input.dueDate)) {
    return { ok: false, error: "Invalid due date" };
  }
  if (!INCOME_TYPES.includes(input.incomeType)) {
    return { ok: false, error: "Invalid income type" };
  }

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    if (invoice.status === "paid") {
      return { ok: false, error: "Paid invoices cannot be edited" };
    }
    if (invoice.status !== "draft" && invoice.status !== "sent") {
      return {
        ok: false,
        error: "Invoice is not in an editable state",
      };
    }

    const memo = input.memo?.trim() || null;
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("invoices")
      .update({
        amount: lineCheck.value.total,
        due_date: input.dueDate,
        line_items: lineCheck.value.items,
        income_type: input.incomeType,
        memo,
      })
      .eq("id", input.invoiceId)
      .select("*")
      .single();

    if (error || !data) {
      return {
        ok: false,
        error: error?.message ?? "Failed to update invoice",
      };
    }
    const updated = data as InvoiceRecord;

    // For a sent invoice, regenerate the PDF and overwrite the stored
    // object. The corresponding files row already points at the same
    // storage path, so no new row needs inserting and no email re-send
    // is performed (the client already has the link in their inbox; the
    // download surfaces the new version).
    if (invoice.status === "sent" && invoice.invoice_number) {
      // `sent_at` should always be populated on a sent invoice (the
      // send action stamps it). Defensive fallback to created_at in
      // case a legacy row predates that stamping.
      const issuedSource = invoice.sent_at ?? invoice.created_at;
      const buffer = await renderInvoicePdfBuffer({
        invoiceNumber: invoice.invoice_number,
        issuedDate: formatDateLong(issuedSource.slice(0, 10)),
        dueDate: input.dueDate ? formatDateLong(input.dueDate) : null,
        billToName: invoice.client_name,
        billToEmail: invoice.client_email,
        lineItems: lineCheck.value.items,
        totalAmount: lineCheck.value.total,
        memo,
        businessName: BUSINESS_NAME,
        businessEmail: BUSINESS_EMAIL,
      });

      const { data: existingFile, error: fileLookupError } = await supabase
        .from("files")
        .select("storage_path")
        .eq("client_id", invoice.client_id)
        .eq("file_type", "invoice")
        .eq("name", `${invoice.invoice_number}.pdf`)
        .maybeSingle();
      if (fileLookupError) {
        return { ok: false, error: fileLookupError.message };
      }
      const storagePath =
        (existingFile?.storage_path as string | undefined) ??
        buildStoragePath(
          invoice.client_id,
          `${invoice.invoice_number}.pdf`
        );
      await uploadServerBuffer(storagePath, buffer, "application/pdf", true);

      // If there was no pre-existing files row (unexpected — a sent
      // invoice should always have one) insert one now so download
      // surfaces still work. Idempotent against a future re-run.
      if (!existingFile) {
        await supabase.from("files").insert({
          client_id: invoice.client_id,
          name: `${invoice.invoice_number}.pdf`,
          storage_path: storagePath,
          file_type: "invoice",
          mime_type: "application/pdf",
          size_bytes: buffer.length,
          uploaded_by: guard.ownerLabel,
        });
      }
    }

    await revalidateInvoiceSurfaces(invoice.client_id);
    return { ok: true, data: updated };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to update invoice",
    };
  }
}

// ---------------------------------------------------------------------------
// sendInvoiceAction
// ---------------------------------------------------------------------------

export interface SendInvoiceInput {
  invoiceId: string;
}

export async function sendInvoiceAction(
  input: SendInvoiceInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    if (invoice.status !== "draft") {
      return { ok: false, error: "Only draft invoices can be sent" };
    }
    if (!invoice.invoice_number) {
      return { ok: false, error: "Invoice is missing a number" };
    }
    if (!invoice.client_email) {
      return { ok: false, error: "Client is missing an email address" };
    }

    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      return { ok: false, error: "Email service is not configured" };
    }

    const total = invoice.line_items.reduce(
      (sum, li) => sum + Number(li.amount),
      0
    );

    // The draft → sent transition happens in this action, so the
    // "issued date" is just-now. Compute once so the PDF and DB row
    // agree.
    const sentNowIso = new Date().toISOString();

    const buffer = await renderInvoicePdfBuffer({
      invoiceNumber: invoice.invoice_number,
      issuedDate: formatDateLong(sentNowIso.slice(0, 10)),
      dueDate: invoice.due_date ? formatDateLong(invoice.due_date) : null,
      billToName: invoice.client_name,
      billToEmail: invoice.client_email,
      lineItems: invoice.line_items,
      totalAmount: total,
      memo: invoice.memo,
      businessName: BUSINESS_NAME,
      businessEmail: BUSINESS_EMAIL,
    });

    const storagePath = buildStoragePath(
      invoice.client_id,
      `${invoice.invoice_number}.pdf`
    );
    await uploadServerBuffer(storagePath, buffer, "application/pdf");

    const supabase = getSupabaseServiceClient();

    const { error: fileError } = await supabase.from("files").insert({
      client_id: invoice.client_id,
      name: `${invoice.invoice_number}.pdf`,
      storage_path: storagePath,
      file_type: "invoice",
      mime_type: "application/pdf",
      size_bytes: buffer.length,
      uploaded_by: guard.ownerLabel,
    });
    if (fileError) {
      return { ok: false, error: fileError.message };
    }

    const resend = new Resend(resendKey);
    const fromAddress =
      process.env.RESEND_FROM_EMAIL ||
      "Digital Bloom Socials <onboarding@resend.dev>";
    const portalUrl = `${resolveBaseUrl()}/client/invoices`;

    const { error: sendError } = await resend.emails.send({
      from: fromAddress,
      to: invoice.client_email,
      subject: `Invoice ${invoice.invoice_number} from ${BUSINESS_NAME}`,
      html: buildInvoiceSentEmailHtml({
        recipientName: invoice.client_name,
        invoiceNumber: invoice.invoice_number,
        amountFormatted: formatAmount(total),
        dueDate: invoice.due_date ? formatDateLong(invoice.due_date) : null,
        portalInvoiceUrl: portalUrl,
        hasPortalAccess: invoice.client_clerk_user_id != null,
      }),
      attachments: [
        {
          filename: `${invoice.invoice_number}.pdf`,
          content: buffer.toString("base64"),
        },
      ],
    });
    if (sendError) {
      return { ok: false, error: sendError.message };
    }

    const { error: statusError } = await supabase
      .from("invoices")
      .update({ status: "sent", sent_at: sentNowIso })
      .eq("id", invoice.id)
      .eq("status", "draft");
    if (statusError) {
      return { ok: false, error: statusError.message };
    }

    await revalidateInvoiceSurfaces(invoice.client_id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send invoice",
    };
  }
}

// ---------------------------------------------------------------------------
// markInvoicePaidAction
// ---------------------------------------------------------------------------

export interface MarkInvoicePaidInput {
  invoiceId: string;
  paymentDate: string;
  paymentMethod: PaymentMethod;
  notes: string | null;
}

export async function markInvoicePaidAction(
  input: MarkInvoicePaidInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };
  if (!isValidDateKey(input.paymentDate)) {
    return { ok: false, error: "Invalid payment date" };
  }
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) {
    return { ok: false, error: "Invalid payment method" };
  }

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    if (invoice.status === "paid") {
      return { ok: false, error: "Invoice is already marked paid" };
    }

    const total = invoice.line_items.reduce(
      (sum, li) => sum + Number(li.amount),
      0
    );

    const supabase = getSupabaseServiceClient();

    const { error: incomeError } = await supabase
      .from("income_payments")
      .insert({
        client_id: invoice.client_id,
        client_name_snapshot: invoice.client_name,
        payment_date: input.paymentDate,
        amount: total,
        income_type: invoice.income_type,
        payment_method: input.paymentMethod,
        notes: input.notes?.trim() || null,
        logged_by: guard.ownerLabel,
        source: "invoice",
        invoice_id: invoice.id,
      });
    if (incomeError) {
      return { ok: false, error: incomeError.message };
    }

    const nowIso = new Date().toISOString();
    const { error: statusError } = await supabase
      .from("invoices")
      .update({ status: "paid", paid_at: nowIso })
      .eq("id", invoice.id)
      .neq("status", "paid");
    if (statusError) {
      return { ok: false, error: statusError.message };
    }

    // Confirmation email is best-effort — the payment is already
    // recorded, so a Resend hiccup shouldn't reverse the action.
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && invoice.client_email && invoice.invoice_number) {
      try {
        const resend = new Resend(resendKey);
        const fromAddress =
          process.env.RESEND_FROM_EMAIL ||
          "Digital Bloom Socials <onboarding@resend.dev>";
        const portalUrl = `${resolveBaseUrl()}/client/invoices`;
        const { error: sendError } = await resend.emails.send({
          from: fromAddress,
          to: invoice.client_email,
          subject: `Payment received for ${invoice.invoice_number} — ${BUSINESS_NAME}`,
          html: buildInvoicePaymentConfirmationEmailHtml({
            recipientName: invoice.client_name,
            invoiceNumber: invoice.invoice_number,
            amountFormatted: formatAmount(total),
            paidDate: formatDateLong(input.paymentDate),
            portalInvoiceUrl: portalUrl,
          }),
        });
        if (sendError) {
          console.error(
            `[invoices] payment confirmation email failed for ${invoice.id}:`,
            sendError.message
          );
        }
      } catch (err) {
        console.error(
          `[invoices] payment confirmation email threw for ${invoice.id}:`,
          err
        );
      }
    }

    await revalidateInvoiceSurfaces(invoice.client_id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark paid",
    };
  }
}

// ---------------------------------------------------------------------------
// deleteInvoiceAction
// ---------------------------------------------------------------------------

export interface DeleteInvoiceInput {
  invoiceId: string;
}

export async function deleteInvoiceAction(
  input: DeleteInvoiceInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    if (invoice.status !== "draft") {
      return { ok: false, error: "Only draft invoices can be deleted" };
    }

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("invoices")
      .delete()
      .eq("id", invoice.id)
      .eq("status", "draft");
    if (error) return { ok: false, error: error.message };

    await revalidateInvoiceSurfaces(invoice.client_id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to delete invoice",
    };
  }
}

// ---------------------------------------------------------------------------
// createInvoicePdfDownloadUrlAction
// ---------------------------------------------------------------------------

export interface CreateInvoicePdfDownloadUrlInput {
  invoiceId: string;
}

export async function createInvoicePdfDownloadUrlAction(
  input: CreateInvoicePdfDownloadUrlInput
): Promise<ActionResult<{ signedUrl: string }>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    if (!invoice.invoice_number) {
      return { ok: false, error: "Invoice has no PDF yet" };
    }

    const supabase = getSupabaseServiceClient();
    const { data: file, error } = await supabase
      .from("files")
      .select("storage_path, name")
      .eq("client_id", invoice.client_id)
      .eq("file_type", "invoice")
      .eq("name", `${invoice.invoice_number}.pdf`)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!file) {
      return { ok: false, error: "Invoice PDF has not been generated yet" };
    }

    const signedUrl = await createSignedDownloadUrl(
      file.storage_path as string,
      file.name as string
    );
    return { ok: true, data: { signedUrl } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not generate link",
    };
  }
}
