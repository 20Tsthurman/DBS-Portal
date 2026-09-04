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
import { renderReceiptPdfBuffer } from "@/lib/receiptPdf";
import {
  buildInvoicePaymentConfirmationEmailHtml,
  buildInvoiceSentEmailHtml,
} from "@/lib/invoiceEmails";
import { resolveBaseUrl } from "@/lib/baseUrl";
import { fetchRevisionCharges } from "@/app/owner/content/_lib/revisionCharges";
import { generateNextInvoiceNumber } from "./_lib/numbering";
import { fetchInvoiceById } from "./_lib/queries";
import {
  revisionChargeOption,
  sameRoundIds,
  type RevisionChargeOption,
} from "./_lib/revisionChargeLines";

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
  // The content cycle bar shows each charge's billed state.
  revalidatePath("/owner/content");
}

// ---------------------------------------------------------------------------
// Revision charges on an invoice (Content & Approval, Phase 8; spec §6.2)
//
// An accrued revision charge becomes ONE MORE {description, amount} LINE ITEM
// and nothing else changes downstream: the Stripe webhook and mark-paid
// derive income from the invoice total and never look inside line items, so
// the payment pipeline is untouched. The only new write anywhere is stamping
// `revision_rounds.invoice_id` here, at invoice-build time.
//
// The panel sends a tagged line item as `{ revisionRoundIds }`; the server
// NEVER trusts its text or amount. It re-reads the client's charges through
// the same function the content cycle bar uses, finds the charge by its round
// ids, checks it is ready and unclaimed (or already on this invoice), and
// rebuilds the description and amount from the charge — so the line the
// client reads is the deck's string at the price they consented to.
//
// The stamp is SET-BASED on every save: rounds stamped to this invoice are
// made equal to the submitted set — additions stamped, removals cleared
// (approved 2026-09-04: refusing removal would strand a charge on an invoice
// Kelsey wants to fix). A removed charge returns to the pool; the FK's ON
// DELETE SET NULL does the same for a deleted draft with no code.
//
// The stamp predicate admits a round that is unstamped, stamped to THIS
// invoice, or stamped to an invoice the charge read knew about (a retired
// one — the inactive-invoice rule: a stamp to an inactive invoice does not
// count as billed, so the charge is offered again and re-adding moves the
// stamp). It never admits a stamp it did not know about, and it selects the
// ids back: a short count means another invoice claimed a round in between,
// and the caller says so.
// ---------------------------------------------------------------------------

export interface InvoiceLineItemInput {
  description: string;
  amount: number;
  /**
   * Present on a line the panel added from the revision charges picker: the
   * charge's round ids. The server rebuilds `description` and `amount` for
   * such a line and ignores what the panel sent for them.
   */
  revisionRoundIds?: string[];
}

interface ResolvedRevisionLines {
  /** Every line item, with tagged ones rebuilt from their charge. */
  items: Array<{ description: string; amount: number }>;
  /** Every round id the tagged lines stand on — the stamp's target set. */
  roundIds: string[];
  /** Every invoice id those rounds were already stamped with, live or not. */
  priorStampIds: string[];
}

async function resolveRevisionLineItems(input: {
  clientId: string;
  invoiceId: string | null;
  lineItems: InvoiceLineItemInput[];
}): Promise<
  { ok: true; value: ResolvedRevisionLines } | { ok: false; error: string }
> {
  if (!Array.isArray(input.lineItems)) {
    return { ok: false, error: "At least one line item is required" };
  }
  const tagged = input.lineItems.filter(
    (li) => Array.isArray(li?.revisionRoundIds) && li.revisionRoundIds.length > 0
  );
  if (tagged.length === 0) {
    return {
      ok: true,
      value: {
        items: input.lineItems.map((li) => ({
          description: li?.description,
          amount: li?.amount,
        })),
        roundIds: [],
        priorStampIds: [],
      },
    };
  }

  const charges = await fetchRevisionCharges(input.clientId);
  const used = new Set<string>();
  const roundIds: string[] = [];
  const priorStampIds = new Set<string>();
  const items: Array<{ description: string; amount: number }> = [];

  for (const li of input.lineItems) {
    const ids = li?.revisionRoundIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      items.push({ description: li?.description, amount: li?.amount });
      continue;
    }
    const charge = charges.find((c) => sameRoundIds(c.roundIds, ids));
    if (!charge) {
      return {
        ok: false,
        error:
          "A revision charge on this invoice no longer exists. Remove that line and try again.",
      };
    }
    if (used.has(charge.key)) {
      return {
        ok: false,
        error: "The same revision charge is on this invoice twice. Remove one.",
      };
    }
    used.add(charge.key);
    if (charge.invoice && charge.invoice.id !== input.invoiceId) {
      return {
        ok: false,
        error: `That revision charge is already on ${
          charge.invoice.number ?? "another invoice"
        }.`,
      };
    }
    // A charge already on this invoice stays whatever its state reads now;
    // one being added must be ready — every request in its round answered,
    // and not every one denied.
    if (!charge.invoice && charge.state !== "ready") {
      return {
        ok: false,
        error:
          charge.state === "waived"
            ? "That revision charge was waived — every request in the round was denied."
            : "That revision charge is still pending — accept or deny every request in the round first.",
      };
    }
    const option = revisionChargeOption(charge);
    items.push({ description: option.description, amount: option.amount });
    roundIds.push(...charge.roundIds);
    for (const id of charge.stampedInvoiceIds) priorStampIds.add(id);
  }

  return {
    ok: true,
    value: { items, roundIds, priorStampIds: Array.from(priorStampIds) },
  };
}

type StampSyncResult =
  | { ok: true }
  | { ok: false; kind: "error" | "claimed"; detail: string };

/**
 * Make the set of rounds stamped to `invoiceId` equal to `roundIds`. Two
 * statements, clear then stamp, each atomic on its own; a failure between
 * them leaves a subset stamped, which the next save repairs.
 */
async function syncRevisionChargeStamps(input: {
  invoiceId: string;
  roundIds: string[];
  priorStampIds: string[];
}): Promise<StampSyncResult> {
  const supabase = getSupabaseServiceClient();

  let clear = supabase
    .from("revision_rounds")
    .update({ invoice_id: null })
    .eq("invoice_id", input.invoiceId);
  if (input.roundIds.length > 0) {
    clear = clear.not("id", "in", `(${input.roundIds.join(",")})`);
  }
  const { error: clearError } = await clear;
  if (clearError) return { ok: false, kind: "error", detail: clearError.message };

  if (input.roundIds.length === 0) return { ok: true };

  const admitted = [input.invoiceId, ...input.priorStampIds];
  const { data, error } = await supabase
    .from("revision_rounds")
    .update({ invoice_id: input.invoiceId })
    .in("id", input.roundIds)
    .eq("is_billable", true)
    .or(`invoice_id.is.null,invoice_id.in.(${admitted.join(",")})`)
    .select("id");
  if (error) return { ok: false, kind: "error", detail: error.message };

  const stamped = (data ?? []).length;
  if (stamped < input.roundIds.length) {
    return {
      ok: false,
      kind: "claimed",
      detail: `${input.roundIds.length - stamped} of ${input.roundIds.length} rounds`,
    };
  }
  return { ok: true };
}

/**
 * Owner-facing. The invoice write already landed when this is shown, so the
 * message says what did happen and names the one next step. "claimed" is the
 * double-billing direction — another invoice took a round in between — and
 * the fix is to remove the line, not to retry.
 */
function stampFailureMessage(
  verb: "created" | "saved",
  invoiceNumber: string | null,
  result: { kind: "error" | "claimed"; detail: string }
): string {
  const name = invoiceNumber ? `Invoice ${invoiceNumber}` : "The invoice";
  return result.kind === "claimed"
    ? `${name} was ${verb}, but at least one of its revision charges was just added to another invoice. Remove that line and save again.`
    : `${name} was ${verb}, but its revision charges couldn't be marked as billed. Open it and save it again. (${result.detail})`;
}

// ---------------------------------------------------------------------------
// fetchInvoiceRevisionChargesAction — the panel's read, on open and on client
// change (decided 2026-09-04 over prop-drilling: the standalone page picks the
// client inside the panel, edit mode needs invoice-scoped data, and every
// content panel section already fetches on open).
// ---------------------------------------------------------------------------

export interface FetchInvoiceRevisionChargesInput {
  clientId: string;
  /** The invoice being edited, or null on create. */
  invoiceId: string | null;
}

export interface InvoiceRevisionCharges {
  /** Ready and unclaimed — offerable. */
  available: RevisionChargeOption[];
  /** Already stamped to this invoice — the panel tags their line items. */
  attached: RevisionChargeOption[];
}

export async function fetchInvoiceRevisionChargesAction(
  input: FetchInvoiceRevisionChargesInput
): Promise<ActionResult<InvoiceRevisionCharges>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.clientId) return { ok: false, error: "Missing client id" };

  try {
    const charges = await fetchRevisionCharges(input.clientId);
    return {
      ok: true,
      data: {
        available: charges
          .filter((c) => c.state === "ready" && c.invoice === null)
          .map(revisionChargeOption),
        attached: input.invoiceId
          ? charges
              .filter((c) => c.invoice?.id === input.invoiceId)
              .map(revisionChargeOption)
          : [],
      },
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not load revision charges",
    };
  }
}

// ---------------------------------------------------------------------------
// createInvoiceAction
// ---------------------------------------------------------------------------

export interface CreateInvoiceInput {
  clientId: string;
  lineItems: InvoiceLineItemInput[];
  dueDate: string | null;
  memo: string | null;
  incomeType: IncomeType;
}

/**
 * On success the invoice exists. `revisionChargeWarning` is set when it was
 * created but its revision charges could NOT be stamped — the one partial
 * state this action can leave, reported rather than hidden so the panel can
 * show it instead of closing as if all was well.
 */
export type CreateInvoiceResult = InvoiceRecord & {
  revisionChargeWarning?: string;
};

export async function createInvoiceAction(
  input: CreateInvoiceInput
): Promise<ActionResult<CreateInvoiceResult>> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };

  if (!input.clientId) return { ok: false, error: "Missing client id" };

  let resolved: Awaited<ReturnType<typeof resolveRevisionLineItems>>;
  try {
    resolved = await resolveRevisionLineItems({
      clientId: input.clientId,
      invoiceId: null,
      lineItems: input.lineItems,
    });
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error ? err.message : "Could not check revision charges",
    };
  }
  if (!resolved.ok) return { ok: false, error: resolved.error };

  const lineCheck = validateLineItems(resolved.value.items);
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

    // The invoice exists from here on. Stamp its revision charges; if that
    // fails, the invoice is still reported as created — a second Save would
    // create a second invoice — with the warning riding on the result.
    if (resolved.value.roundIds.length > 0) {
      const sync = await syncRevisionChargeStamps({
        invoiceId: result.data.id,
        roundIds: resolved.value.roundIds,
        priorStampIds: resolved.value.priorStampIds,
      });
      if (!sync.ok) {
        await revalidateInvoiceSurfaces(input.clientId);
        return {
          ok: true,
          data: {
            ...result.data,
            revisionChargeWarning: stampFailureMessage(
              "created",
              result.data.invoice_number,
              sync
            ),
          },
        };
      }
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
  lineItems: InvoiceLineItemInput[];
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

  if (input.dueDate !== null && !isValidDateKey(input.dueDate)) {
    return { ok: false, error: "Invalid due date" };
  }
  if (!INCOME_TYPES.includes(input.incomeType)) {
    return { ok: false, error: "Invalid income type" };
  }

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    if (invoice.inactive_at) {
      return {
        ok: false,
        error: "Inactive invoices cannot be edited. Reactivate it first.",
      };
    }
    if (invoice.status === "paid") {
      return { ok: false, error: "Paid invoices cannot be edited" };
    }
    if (invoice.status !== "draft" && invoice.status !== "sent") {
      return {
        ok: false,
        error: "Invoice is not in an editable state",
      };
    }

    // Tagged lines are rebuilt from the client's charges before validation,
    // so the validator sees the deck's description and the consented amount.
    const resolved = await resolveRevisionLineItems({
      clientId: invoice.client_id,
      invoiceId: invoice.id,
      lineItems: input.lineItems,
    });
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const lineCheck = validateLineItems(resolved.value.items);
    if (!lineCheck.ok) return { ok: false, error: lineCheck.error };

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

    // Set-based: rounds stamped to this invoice become exactly the submitted
    // set. Runs on every save, tagged lines or not, so removing the last
    // charge clears its stamp. The update above is idempotent, so a failure
    // here is retried by saving again.
    const sync = await syncRevisionChargeStamps({
      invoiceId: invoice.id,
      roundIds: resolved.value.roundIds,
      priorStampIds: resolved.value.priorStampIds,
    });
    if (!sync.ok) {
      await revalidateInvoiceSurfaces(invoice.client_id);
      return {
        ok: false,
        error: stampFailureMessage("saved", invoice.invoice_number, sync),
      };
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
    if (invoice.inactive_at) {
      return {
        ok: false,
        error: "Inactive invoices cannot be sent. Reactivate it first.",
      };
    }
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
    if (invoice.inactive_at) {
      return {
        ok: false,
        error: "Inactive invoices cannot be marked paid. Reactivate it first.",
      };
    }
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
    // recorded, so a Resend hiccup shouldn't reverse the action. The
    // receipt PDF is generated inside the try/catch for the same
    // reason: a renderer failure shouldn't roll back the payment.
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey && invoice.client_email && invoice.invoice_number) {
      try {
        const paidDateFormatted = formatDateLong(input.paymentDate);
        const receiptBuffer = await renderReceiptPdfBuffer({
          invoiceNumber: invoice.invoice_number,
          paidDate: paidDateFormatted,
          paymentMethod: input.paymentMethod,
          billToName: invoice.client_name,
          billToEmail: invoice.client_email,
          lineItems: invoice.line_items,
          totalAmount: total,
          memo: invoice.memo,
          businessName: BUSINESS_NAME,
          businessEmail: BUSINESS_EMAIL,
        });

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
            paidDate: paidDateFormatted,
            portalInvoiceUrl: portalUrl,
            hasPortalAccess: invoice.client_clerk_user_id != null,
          }),
          attachments: [
            {
              filename: `Receipt-${invoice.invoice_number}.pdf`,
              content: receiptBuffer.toString("base64"),
              contentType: "application/pdf",
            },
          ],
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
    if (invoice.inactive_at) {
      return {
        ok: false,
        error: "Reactivate the invoice before deleting it.",
      };
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
// setInvoiceInactiveAction / reactivateInvoiceAction
//
// Soft-retire, the non-destructive counterpart to deleteInvoiceAction: the
// row, its number, its line items, and its generated PDF all stay put, but
// the invoice drops out of the live lists, disappears from the client
// portal, and stops being editable / sendable / payable. Used for invoices
// that were cancelled, superseded, or billed by mistake — anything where the
// history still matters.
//
// The underlying `status` is deliberately left alone, so reactivating puts
// the invoice back exactly where it was (a retired overdue invoice comes back
// overdue). Paid invoices can't be retired: the money is already recorded in
// income_payments, and hiding the invoice would orphan that row.
// ---------------------------------------------------------------------------

export interface SetInvoiceInactiveInput {
  invoiceId: string;
}

export async function setInvoiceInactiveAction(
  input: SetInvoiceInactiveInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    // Idempotent: a double-click or a stale tab shouldn't surface an error.
    if (invoice.inactive_at) return { ok: true };
    if (invoice.status === "paid") {
      return {
        ok: false,
        error:
          "Paid invoices can't be made inactive — the payment is already on the books.",
      };
    }

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("invoices")
      .update({ inactive_at: new Date().toISOString() })
      .eq("id", invoice.id)
      // Race guard against a concurrent mark-paid: never retire an invoice
      // that just became paid.
      .neq("status", "paid")
      .is("inactive_at", null);
    if (error) return { ok: false, error: error.message };

    await revalidateInvoiceSurfaces(invoice.client_id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to mark inactive",
    };
  }
}

export interface ReactivateInvoiceInput {
  invoiceId: string;
}

export async function reactivateInvoiceAction(
  input: ReactivateInvoiceInput
): Promise<ActionResult> {
  const guard = await requireOwner();
  if (!guard.ok) return { ok: false, error: guard.error };
  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  try {
    const invoice = await fetchInvoiceById(input.invoiceId);
    if (!invoice) return { ok: false, error: "Invoice not found" };
    if (!invoice.inactive_at) return { ok: true };

    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("invoices")
      .update({ inactive_at: null })
      .eq("id", invoice.id);
    if (error) return { ok: false, error: error.message };

    await revalidateInvoiceSurfaces(invoice.client_id);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to reactivate",
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
