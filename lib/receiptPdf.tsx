/**
 * Receipt PDF document component + a server-side render helper that
 * returns a `Buffer`. Generated whenever an invoice transitions to
 * `paid` (via the Stripe webhook or the manual mark-as-paid action)
 * and attached to the payment-confirmation email.
 *
 * Visual layout mirrors `lib/invoicePdf.tsx` so the two documents read
 * as a matched pair: same palette, fonts, parties row, line items
 * table, totals, and footer. The differences are header-only:
 *   - eyebrow reads "RECEIPT" (not "INVOICE")
 *   - a sharp-cornered green "PAID" badge sits in the header-right
 *   - the meta column shows PAYMENT RECEIVED / PAYMENT METHOD (not
 *     ISSUED / DUE)
 *
 * The colour palette, fonts, currency formatter, and the bulk of the
 * StyleSheet live in `lib/invoicePdf.tsx` as named exports
 * (`PDF_COLORS`, `PDF_FONTS`, `formatPdfAmount`, `pdfSharedStyles`).
 * Only the receipt-specific additions (PAID badge, payment-meta tweaks)
 * are defined locally below.
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { JSX } from "react";
import {
  PDF_COLORS,
  PDF_FONTS,
  formatPdfAmount,
  pdfSharedStyles,
} from "@/lib/invoicePdf";

export interface ReceiptPdfProps {
  invoiceNumber: string;
  /** Pre-formatted, e.g. "May 27, 2026". */
  paidDate: string;
  /**
   * Raw payment-method key from `income_payments.payment_method`
   * (e.g. "stripe", "zelle", "direct_deposit"), or null if not known.
   * Rendered through `formatPaymentMethod` below.
   */
  paymentMethod: string | null;
  billToName: string;
  billToEmail: string;
  lineItems: Array<{ description: string; amount: number }>;
  totalAmount: number;
  memo: string | null;
  businessName: string;
  businessEmail: string;
}

const COLORS = PDF_COLORS;
const SANS = PDF_FONTS.sans;
const SANS_BOLD = PDF_FONTS.sansBold;
const SERIF_BOLD = PDF_FONTS.serifBold;

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  stripe: "Stripe",
  zelle: "Zelle",
  venmo: "Venmo",
  direct_deposit: "Direct deposit",
  check: "Check",
  cash: "Cash",
  other: "Other",
};

function formatPaymentMethod(raw: string | null): string | null {
  if (!raw) return null;
  return PAYMENT_METHOD_LABELS[raw] ?? raw;
}

const receiptStyles = StyleSheet.create({
  // Header-right column holds the meta pairs (Payment received /
  // Payment method) above the PAID badge. We render the badge first
  // visually but in the column flow it sits below the meta — the
  // headerRight container uses flex-end alignment so both line up to
  // the right edge.
  paidBadge: {
    marginTop: 10,
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 14,
    paddingRight: 14,
    backgroundColor: COLORS.success,
    // Sharp corners by default in @react-pdf — explicit 0 for clarity.
    borderRadius: 0,
  },
  paidBadgeText: {
    fontFamily: SANS_BOLD,
    fontSize: 11,
    color: "#FFFFFF",
    letterSpacing: 2,
  },
  receiptNumber: {
    fontFamily: SERIF_BOLD,
    fontSize: 28,
    color: COLORS.forest,
    lineHeight: 1.1,
  },
  // Payment-method meta value is rendered in muted body color (not the
  // darker forestDark used for dates) since it's a string token rather
  // than a hard fact.
  metaMethodValue: {
    fontFamily: SANS,
    fontSize: 9,
    color: COLORS.muted,
  },
});

// Pull the rest of the layout from the shared sheet exported by
// invoicePdf so the two documents stay visually locked.
const s = pdfSharedStyles;

export function ReceiptPdfDocument(props: ReceiptPdfProps): JSX.Element {
  const methodLabel = formatPaymentMethod(props.paymentMethod);
  return (
    <Document
      title={`Receipt ${props.invoiceNumber}`}
      author={props.businessName}
      creator={props.businessName}
      producer={props.businessName}
    >
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <View style={s.headerLeft}>
            <Text style={s.eyebrow}>RECEIPT</Text>
            <Text style={receiptStyles.receiptNumber}>
              {props.invoiceNumber}
            </Text>
          </View>
          <View style={s.headerRight}>
            <View style={s.metaPair}>
              <Text style={s.metaLabel}>PAYMENT RECEIVED</Text>
              <Text style={s.metaValue}>{props.paidDate}</Text>
            </View>
            {methodLabel ? (
              <View style={s.metaPair}>
                <Text style={s.metaLabel}>PAYMENT METHOD</Text>
                <Text style={receiptStyles.metaMethodValue}>{methodLabel}</Text>
              </View>
            ) : null}
            <View style={receiptStyles.paidBadge}>
              <Text style={receiptStyles.paidBadgeText}>PAID</Text>
            </View>
          </View>
        </View>

        <View style={s.divider} />

        <View style={s.partiesRow}>
          <View style={s.partyBlock}>
            <Text style={s.eyebrow}>BILL TO</Text>
            <Text style={s.partyName}>{props.billToName}</Text>
            <Text style={s.partyMuted}>{props.billToEmail}</Text>
          </View>
          <View style={[s.partyBlock, { alignItems: "flex-end" }]}>
            <Text style={s.eyebrow}>FROM</Text>
            <Text style={s.partyName}>{props.businessName}</Text>
            <Text style={s.partyMuted}>{props.businessEmail}</Text>
          </View>
        </View>

        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={s.thDescription}>DESCRIPTION</Text>
            <Text style={s.thAmount}>AMOUNT</Text>
          </View>
          {props.lineItems.map((item, idx) => (
            <View style={s.tableRow} key={`li-${idx}`}>
              <Text style={s.tdDescription}>{item.description}</Text>
              <Text style={s.tdAmount}>{formatPdfAmount(item.amount)}</Text>
            </View>
          ))}
          <View style={s.totalRow}>
            <Text style={s.totalLabel}>TOTAL</Text>
            <Text style={s.totalValue}>{formatPdfAmount(props.totalAmount)}</Text>
          </View>
        </View>

        {props.memo ? (
          <View style={s.memoBlock}>
            <Text style={s.eyebrow}>MEMO</Text>
            <Text style={s.memoText}>{props.memo}</Text>
          </View>
        ) : null}

        <View style={s.footer} fixed>
          <Text style={s.footerThanks}>Thank you for your payment.</Text>
          <Text style={s.footerBusiness}>
            {props.businessName} · {props.businessEmail}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderReceiptPdfBuffer(
  props: ReceiptPdfProps
): Promise<Buffer> {
  return renderToBuffer(<ReceiptPdfDocument {...props} />);
}
