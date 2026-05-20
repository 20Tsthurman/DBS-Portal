import { buildShell } from "@/lib/messageEmails";
import { escapeHtml } from "@/lib/escapeHtml";

export function buildInvoiceSentEmailHtml(input: {
  recipientName: string;
  invoiceNumber: string;
  amountFormatted: string;
  dueDate: string | null;
  portalInvoiceUrl: string;
}): string {
  const safeNumber = escapeHtml(input.invoiceNumber);
  const safeAmount = escapeHtml(input.amountFormatted);
  const dueClause = input.dueDate
    ? ` It's due on ${escapeHtml(input.dueDate)}.`
    : "";
  const body = `A new invoice (<strong>${safeNumber}</strong>) for <strong>${safeAmount}</strong> is ready for you.${dueClause} View and pay it in your portal — the PDF is attached for your records.`;
  return buildShell({
    titleTag: `Invoice ${input.invoiceNumber}`,
    headline: `Invoice ${input.invoiceNumber}`,
    bodyParagraph: body,
    portalUrl: input.portalInvoiceUrl,
    recipientName: input.recipientName,
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
