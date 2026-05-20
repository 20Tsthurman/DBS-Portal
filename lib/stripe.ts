/**
 * Stripe SDK wrapper.
 *
 * All Stripe SDK access in the app should route through this module —
 * the webhook route is the only allowed exception (it imports the SDK
 * directly for `webhooks.constructEvent`, which needs the raw module
 * not a wrapped client).
 *
 * The client is constructed lazily and cached so we don't re-instantiate
 * per request. No apiVersion override — accept the SDK default so the
 * pinned `stripe` package version controls the API surface.
 */

import Stripe from "stripe";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let cachedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;
  cachedClient = new Stripe(requireEnv("STRIPE_SECRET_KEY"));
  return cachedClient;
}

export interface CheckoutSessionInput {
  invoiceId: string;
  invoiceNumber: string;
  clientEmail: string;
  lineItems: Array<{ description: string; amountCents: number }>;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  url: string;
  sessionId: string;
}

/**
 * Creates a Stripe-hosted Checkout Session for an invoice. The returned
 * URL is the destination the browser should be redirected to (via
 * `window.location.href`).
 *
 * The session's metadata carries `invoice_id` and `invoice_number` —
 * the webhook reads these to mark the invoice paid. Don't change the
 * metadata keys without updating the webhook handler.
 */
export async function createCheckoutSessionForInvoice(
  input: CheckoutSessionInput
): Promise<CheckoutSessionResult> {
  const stripe = getStripeClient();

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.clientEmail,
    line_items: input.lineItems.map((item) => ({
      quantity: 1,
      price_data: {
        currency: "usd",
        product_data: { name: item.description },
        unit_amount: item.amountCents,
      },
    })),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: {
      invoice_id: input.invoiceId,
      invoice_number: input.invoiceNumber,
    },
  });

  if (!session.url) {
    throw new Error(
      `Stripe returned a session without a URL (sessionId=${session.id})`
    );
  }

  return { url: session.url, sessionId: session.id };
}
