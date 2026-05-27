/**
 * Stripe webhook handler.
 *
 * Mirrors the structural shape of the Clerk webhook
 * (`app/api/webhooks/clerk/route.ts`) — secret guard at the top,
 * signature verification on the raw body, switch on event.type, 2xx on
 * acknowledged events even when the work is a no-op so Stripe doesn't
 * retry. Stripe's signature primitive differs from svix, so this route
 * imports the `stripe` package directly for `webhooks.constructEvent`
 * rather than going through `lib/stripe.ts`.
 *
 * v1 handles a single event: `checkout.session.completed`. On that
 * event we flip the invoice to `paid` and write a matching
 * `income_payments` row with `source='invoice'`.
 */

import { NextResponse } from "next/server";
import Stripe from "stripe";
import { Resend } from "resend";
import { getSupabaseServiceClient } from "@/lib/supabase";
import { buildInvoicePaymentConfirmationEmailHtml } from "@/lib/invoiceEmails";
import { renderReceiptPdfBuffer } from "@/lib/receiptPdf";
import { resolveBaseUrl } from "@/lib/baseUrl";

const BUSINESS_NAME_FOR_PDF = "Digital Bloom Socials";
const BUSINESS_EMAIL_FOR_PDF = "digitalbloomsocials@gmail.com";

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const apiKey = process.env.STRIPE_SECRET_KEY;
  if (!secret || !apiKey) {
    console.error(
      "[stripe webhook] STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY is not set"
    );
    return NextResponse.json(
      { error: "Webhook secret is not configured" },
      { status: 500 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 }
    );
  }

  // Stripe verifies against the *raw* request body. Next.js App Router
  // does not pre-parse the body, but using `request.json()` would
  // re-stringify and break signature validation. `request.text()`
  // returns the raw payload unchanged.
  const payload = await request.text();

  const stripe = new Stripe(apiKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "verification failed";
    console.warn("[stripe webhook] signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const result = await handleCheckoutSessionCompleted(
        event.data.object as Stripe.Checkout.Session
      );
      if ("error" in result) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }
      return NextResponse.json(result);
    }

    default:
      // Stripe sends a wide assortment of events the dashboard happens to
      // be subscribed to; acknowledge with 200 so retries stop.
      console.log("[stripe webhook] unhandled event type:", event.type);
      return NextResponse.json({ received: true, action: "ignored" });
  }
}

type HandlerResult =
  | { received: true; action: string; invoiceId?: string }
  | { error: string; status: 500 };

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session
): Promise<HandlerResult> {
  const invoiceId = session.metadata?.invoice_id;
  if (!invoiceId) {
    console.warn(
      `[stripe webhook] checkout.session.completed without metadata.invoice_id (sessionId=${session.id}) — ignoring`
    );
    return { received: true, action: "skipped_no_invoice_id" };
  }

  const supabase = getSupabaseServiceClient();

  const { data: invoice, error: fetchError } = await supabase
    .from("invoices")
    .select(
      "id, client_id, status, line_items, amount, invoice_number, income_type, memo"
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      `[stripe webhook] failed to fetch invoice ${invoiceId}:`,
      fetchError.message
    );
    return { error: fetchError.message, status: 500 };
  }

  if (!invoice) {
    console.warn(
      `[stripe webhook] no invoice found for id=${invoiceId} (sessionId=${session.id})`
    );
    return { received: true, action: "skipped_invoice_not_found" };
  }

  // Idempotency: Stripe may deliver the same event more than once.
  if (invoice.status === "paid") {
    console.log(
      `[stripe webhook] invoice ${invoiceId} already paid — skipping (sessionId=${session.id})`
    );
    return { received: true, action: "already_paid" };
  }

  // Look up the client to snapshot the name onto the income row and
  // (later) address the confirmation email. `clerk_user_id` is pulled
  // so the email builder can decide whether to include the portal CTA.
  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("id, name, email, clerk_user_id")
    .eq("id", invoice.client_id)
    .maybeSingle();

  if (clientError) {
    console.error(
      `[stripe webhook] failed to fetch client ${invoice.client_id}:`,
      clientError.message
    );
    return { error: clientError.message, status: 500 };
  }

  const clientNameSnapshot = client?.name ?? "Unknown client";
  const amountTotalCents = session.amount_total ?? 0;
  const amountDollars = amountTotalCents / 100;
  const nowIso = new Date().toISOString();
  const today = nowIso.slice(0, 10);

  // Flip the invoice. The `.neq('status', 'paid')` clause is a
  // race-safe guard: if a concurrent webhook delivery already flipped
  // the row, this update returns zero rows and we abort before
  // inserting a duplicate income payment. `.select()` is required to
  // make Supabase return the updated rows so we can count them.
  const { data: updatedRows, error: updateError } = await supabase
    .from("invoices")
    .update({ status: "paid", paid_at: nowIso })
    .eq("id", invoiceId)
    .neq("status", "paid")
    .select("id");

  if (updateError) {
    console.error(
      `[stripe webhook] failed to mark invoice ${invoiceId} paid:`,
      updateError.message
    );
    return { error: updateError.message, status: 500 };
  }

  if (!updatedRows || updatedRows.length === 0) {
    console.log(
      `[stripe webhook] invoice ${invoiceId} already paid by a concurrent delivery — skipping (sessionId=${session.id})`
    );
    return { received: true, action: "already_paid_concurrent" };
  }

  const { error: incomeError } = await supabase.from("income_payments").insert({
    client_id: invoice.client_id,
    client_name_snapshot: clientNameSnapshot,
    payment_date: today,
    amount: amountDollars,
    income_type: invoice.income_type ?? "other",
    payment_method: "stripe",
    notes: invoice.invoice_number
      ? `Stripe payment for ${invoice.invoice_number}`
      : `Stripe payment for invoice ${invoiceId}`,
    logged_by: "Stripe webhook",
    source: "invoice",
    invoice_id: invoiceId,
  });

  if (incomeError) {
    console.error(
      `[stripe webhook] invoice ${invoiceId} marked paid but income insert failed:`,
      incomeError.message
    );
    // The invoice flip already succeeded; surface 500 so we can
    // investigate, but the user-facing payment is recorded.
    return { error: incomeError.message, status: 500 };
  }

  // Confirmation email is best-effort — Stripe shouldn't retry on email
  // hiccups, so we log and continue. The receipt PDF is rendered inside
  // the try/catch for the same reason.
  const recipientEmail = client?.email;
  const hasPortalAccess = client?.clerk_user_id != null;
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && recipientEmail && invoice.invoice_number) {
    try {
      const amountFormatted = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(amountDollars);
      const paidDate = new Date(`${today}T12:00:00Z`).toLocaleDateString(
        "en-US",
        {
          year: "numeric",
          month: "long",
          day: "numeric",
          timeZone: "UTC",
        }
      );

      const lineItems = (invoice.line_items ?? []) as Array<{
        description: string;
        amount: number;
      }>;
      const lineItemTotal = lineItems.reduce(
        (sum, li) => sum + Number(li.amount),
        0
      );
      const receiptBuffer = await renderReceiptPdfBuffer({
        invoiceNumber: invoice.invoice_number,
        paidDate,
        paymentMethod: "stripe",
        billToName: clientNameSnapshot,
        billToEmail: recipientEmail,
        lineItems,
        // Prefer the line-items sum so the table footer reconciles with
        // the line items shown above. In normal Checkout flow this
        // equals the Stripe-charged amount; if they ever drift, the
        // receipt reflects what was invoiced.
        totalAmount: lineItemTotal,
        memo: (invoice.memo as string | null) ?? null,
        businessName: BUSINESS_NAME_FOR_PDF,
        businessEmail: BUSINESS_EMAIL_FOR_PDF,
      });

      const resend = new Resend(resendKey);
      const fromAddress =
        process.env.RESEND_FROM_EMAIL ||
        "Digital Bloom Socials <onboarding@resend.dev>";
      const portalUrl = `${resolveBaseUrl()}/client/invoices`;
      const { error: sendError } = await resend.emails.send({
        from: fromAddress,
        to: recipientEmail,
        subject: `Payment received for ${invoice.invoice_number} — Digital Bloom Socials`,
        html: buildInvoicePaymentConfirmationEmailHtml({
          recipientName: clientNameSnapshot,
          invoiceNumber: invoice.invoice_number,
          amountFormatted,
          paidDate,
          portalInvoiceUrl: portalUrl,
          hasPortalAccess,
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
          `[stripe webhook] payment confirmation email failed for ${invoiceId}:`,
          sendError.message
        );
      }
    } catch (err) {
      console.error(
        `[stripe webhook] payment confirmation email threw for ${invoiceId}:`,
        err
      );
    }
  }

  console.log(
    `[stripe webhook] invoice ${invoiceId} marked paid via Stripe (sessionId=${session.id})`
  );
  return { received: true, action: "marked_paid", invoiceId };
}
