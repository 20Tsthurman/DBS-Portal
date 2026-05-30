"use server";

import { requireCurrentClient } from "@/lib/currentClient";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { createSignedDownloadUrl } from "@/lib/storage";
import { createCheckoutSessionForInvoice } from "@/lib/stripe";
import { resolveBaseUrl } from "@/lib/baseUrl";
import type { ActionResult } from "@/lib/actions";
import { fetchMyInvoiceById } from "./_lib/queries";

export interface CreatePaymentSessionInput {
  invoiceId: string;
}

/**
 * Mints a Stripe Checkout Session for the signed-in client's invoice
 * and returns the hosted URL the browser should redirect to. The
 * checkout session's metadata carries the invoice id so the webhook can
 * flip the invoice to paid + write the matching income_payments row
 * (see `app/api/webhooks/stripe/route.ts`).
 *
 * Cross-client access is the primary risk: `fetchMyInvoiceById` filters
 * by `client_id` AND excludes drafts, so a forged invoice id from
 * another client's row resolves to null and falls into the "Forbidden"
 * branch below.
 */
export async function createPaymentSessionAction(
  input: CreatePaymentSessionInput
): Promise<ActionResult<{ url: string }>> {
  let client;
  try {
    client = await requireCurrentClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Not signed in",
    };
  }
  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  let invoice;
  try {
    invoice = await fetchMyInvoiceById(client.id, input.invoiceId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not load invoice",
    };
  }
  if (!invoice) return { ok: false, error: "Forbidden" };
  if (invoice.status === "paid") {
    return { ok: false, error: "Invoice is already paid" };
  }
  if (!invoice.invoice_number) {
    return { ok: false, error: "Invoice is missing a number" };
  }
  // A signed-in client always has a Clerk email (portal access requires an
  // invite, which requires an email). Guard the nullable type defensively.
  if (!client.email) {
    return { ok: false, error: "Your account has no email address on file." };
  }

  const base = resolveBaseUrl();
  const successUrl = `${base}/client/invoices?paid=1&invoice=${encodeURIComponent(
    invoice.invoice_number
  )}`;
  const cancelUrl = `${base}/client/invoices?canceled=1`;

  try {
    const session = await createCheckoutSessionForInvoice({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoice_number,
      clientEmail: client.email,
      lineItems: invoice.line_items.map((li) => ({
        description: li.description,
        amountCents: Math.round(li.amount * 100),
      })),
      successUrl,
      cancelUrl,
    });
    return { ok: true, data: { url: session.url } };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start checkout",
    };
  }
}

export interface CreateInvoicePdfDownloadUrlInput {
  invoiceId: string;
}

/**
 * Mint a signed download URL for the invoice PDF belonging to the
 * signed-in client. Mirrors the cross-client guard in
 * `createPaymentSessionAction` — `fetchMyInvoiceById` enforces the
 * ownership + non-draft check before we look up the file row.
 */
export async function createInvoicePdfDownloadUrlAction(
  input: CreateInvoicePdfDownloadUrlInput
): Promise<ActionResult<{ signedUrl: string }>> {
  let client;
  try {
    client = await requireCurrentClient();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Not signed in",
    };
  }
  if (!input.invoiceId) return { ok: false, error: "Missing invoice id" };

  let invoice;
  try {
    invoice = await fetchMyInvoiceById(client.id, input.invoiceId);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not load invoice",
    };
  }
  if (!invoice) return { ok: false, error: "Forbidden" };
  if (!invoice.invoice_number) {
    return { ok: false, error: "Invoice has no PDF yet" };
  }

  try {
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
