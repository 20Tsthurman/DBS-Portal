import { buildShell } from "@/lib/messageEmails";
import { escapeHtml } from "@/lib/escapeHtml";

function firstNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return trimmed;
  const [first] = trimmed.split(/\s+/);
  return first ?? trimmed;
}

export function buildInvoiceSentEmailHtml(input: {
  recipientName: string;
  invoiceNumber: string;
  amountFormatted: string;
  dueDate: string | null;
  portalInvoiceUrl: string;
  hasPortalAccess: boolean;
}): string {
  const safeFirstName = escapeHtml(firstNameOf(input.recipientName));
  const safeAmount = escapeHtml(input.amountFormatted);
  const dueClause = input.dueDate
    ? ` and due ${escapeHtml(input.dueDate)}`
    : "";

  if (input.hasPortalAccess) {
    const body = `Hi ${safeFirstName}, your invoice for <strong>${safeAmount}</strong> is attached${dueClause}. You can view and pay it in your portal, or use the payment details in the attached PDF.`;
    return buildShell({
      titleTag: `Invoice ${input.invoiceNumber}`,
      headline: `Invoice ${input.invoiceNumber}`,
      bodyParagraph: body,
      portalUrl: input.portalInvoiceUrl,
      recipientName: input.recipientName,
      showGreeting: false,
    });
  }

  const body = `Hi ${safeFirstName}, your invoice for <strong>${safeAmount}</strong> is attached${dueClause}. Payment details are included in the attached PDF — reach out if you have any questions.`;
  const extraBodyHtml = `<p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#4B5C4E;font-family:'DM Sans',Arial,sans-serif;">Want a client portal for invoices, content, and messaging? Just let Kelsey know.</p>`;
  return buildShell({
    titleTag: `Invoice ${input.invoiceNumber}`,
    headline: `Invoice ${input.invoiceNumber}`,
    bodyParagraph: body,
    portalUrl: input.portalInvoiceUrl,
    recipientName: input.recipientName,
    showEyebrow: false,
    showGreeting: false,
    showButton: false,
    extraBodyHtml,
  });
}

export function buildInvoicePaymentConfirmationEmailHtml(input: {
  recipientName: string;
  invoiceNumber: string;
  amountFormatted: string;
  paidDate: string;
  portalInvoiceUrl: string;
}): string {
  const safeNumber = escapeHtml(input.invoiceNumber);
  const safeAmount = escapeHtml(input.amountFormatted);
  const safePaidDate = escapeHtml(input.paidDate);
  const body = `Thank you — we received your payment of <strong>${safeAmount}</strong> for invoice <strong>${safeNumber}</strong> on ${safePaidDate}. You can download a paid receipt from your portal at any time.`;
  return buildShell({
    titleTag: `Payment received — ${input.invoiceNumber}`,
    headline: "Payment received — thank you!",
    bodyParagraph: body,
    portalUrl: input.portalInvoiceUrl,
    recipientName: input.recipientName,
  });
}

export function buildInvoiceOverdueEmailHtml(input: {
  recipientName: string;
  invoiceNumber: string;
  amountFormatted: string;
  dueDate: string;
  daysOverdue: number;
  portalInvoiceUrl: string;
}): string {
  const safeNumber = escapeHtml(input.invoiceNumber);
  const safeAmount = escapeHtml(input.amountFormatted);
  const safeDueDate = escapeHtml(input.dueDate);
  const dayLabel = input.daysOverdue === 1 ? "day" : "days";
  const body = `Invoice <strong>${safeNumber}</strong> for <strong>${safeAmount}</strong> was due on ${safeDueDate} and is now ${input.daysOverdue} ${dayLabel} past due. Please pay it at your earliest convenience — you can do so directly from your portal.`;
  return buildShell({
    titleTag: `Invoice ${input.invoiceNumber} is past due`,
    headline: `Invoice ${input.invoiceNumber} is past due`,
    bodyParagraph: body,
    portalUrl: input.portalInvoiceUrl,
    recipientName: input.recipientName,
  });
}
