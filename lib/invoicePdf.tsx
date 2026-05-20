/**
 * Invoice PDF document component + a server-side render helper that
 * returns a `Buffer`. Used by the owner-side send/edit invoice actions
 * to attach a generated PDF to the Resend email and to drop the same
 * file into the `client-files` bucket so client and owner can later
 * download it via a signed URL.
 *
 * Font note: this file uses the built-in `Helvetica` / `Times-Roman`
 * PDF base fonts rather than registering Playfair Display + DM Sans
 * via `Font.register`. The base fonts are bundled with pdfkit and
 * require no network fetch at render time, which avoids a class of
 * runtime failures in serverless environments where outbound fetches
 * to fonts.gstatic.com can be flaky or blocked. The visual hierarchy
 * (serif headlines + sans body) is preserved. Upgrading to the brand
 * fonts can be done later by registering them in this file; nothing
 * downstream of this module depends on the font family.
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

export interface InvoicePdfProps {
  invoiceNumber: string;
  /** Pre-formatted, e.g. "May 18, 2026". */
  issuedDate: string;
  /** Pre-formatted or null. */
  dueDate: string | null;
  billToName: string;
  billToEmail: string;
  lineItems: Array<{ description: string; amount: number }>;
  totalAmount: number;
  memo: string | null;
  businessName: string;
  businessEmail: string;
}

const COLORS = {
  background: "#E8E4D8",
  forest: "#1B3827",
  forestDark: "#1A2B1C",
  mauve: "#A8788A",
  muted: "#4B5C4E",
  hairline: "#D8D4C8",
  subtle: "#7A8B7C",
};

const SERIF = "Times-Roman";
const SERIF_BOLD = "Times-Bold";
const SANS = "Helvetica";
const SANS_BOLD = "Helvetica-Bold";
const SANS_OBLIQUE = "Helvetica-Oblique";

const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

function formatAmount(value: number): string {
  return CURRENCY.format(value);
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: COLORS.background,
    paddingTop: 54,
    paddingBottom: 54,
    paddingLeft: 54,
    paddingRight: 54,
    fontFamily: SANS,
    color: COLORS.forestDark,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  headerLeft: {
    flexDirection: "column",
  },
  eyebrow: {
    fontFamily: SANS_BOLD,
    fontSize: 9,
    color: COLORS.mauve,
    letterSpacing: 2,
    marginBottom: 6,
  },
  invoiceNumber: {
    fontFamily: SERIF_BOLD,
    fontSize: 28,
    color: COLORS.forest,
    lineHeight: 1.1,
  },
  headerRight: {
    flexDirection: "column",
    alignItems: "flex-end",
  },
  metaPair: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 2,
  },
  metaLabel: {
    fontFamily: SANS_BOLD,
    fontSize: 9,
    color: COLORS.subtle,
    letterSpacing: 1.2,
    marginRight: 6,
  },
  metaValue: {
    fontFamily: SANS,
    fontSize: 9,
    color: COLORS.forestDark,
  },

  divider: {
    marginTop: 18,
    marginBottom: 18,
    height: 1,
    backgroundColor: COLORS.hairline,
  },

  partiesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 28,
  },
  partyBlock: {
    flexDirection: "column",
    maxWidth: "48%",
  },
  partyName: {
    fontFamily: SANS_BOLD,
    fontSize: 11,
    color: COLORS.forestDark,
    marginTop: 6,
  },
  partyMuted: {
    fontFamily: SANS,
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 2,
  },

  table: {
    marginTop: 4,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingBottom: 6,
  },
  thDescription: {
    flexBasis: "70%",
    fontFamily: SANS_BOLD,
    fontSize: 8,
    color: COLORS.forestDark,
    letterSpacing: 1.4,
  },
  thAmount: {
    flexBasis: "30%",
    textAlign: "right",
    fontFamily: SANS_BOLD,
    fontSize: 8,
    color: COLORS.forestDark,
    letterSpacing: 1.4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingTop: 10,
    paddingBottom: 10,
  },
  tdDescription: {
    flexBasis: "70%",
    fontFamily: SANS,
    fontSize: 10,
    color: COLORS.forestDark,
    paddingRight: 12,
  },
  tdAmount: {
    flexBasis: "30%",
    textAlign: "right",
    fontFamily: SANS,
    fontSize: 10,
    color: COLORS.forestDark,
  },

  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingTop: 10,
    paddingBottom: 10,
    marginTop: 6,
  },
  totalLabel: {
    flexBasis: "70%",
    textAlign: "right",
    fontFamily: SANS_BOLD,
    fontSize: 12,
    color: COLORS.forest,
    paddingRight: 12,
  },
  totalValue: {
    flexBasis: "30%",
    textAlign: "right",
    fontFamily: SANS_BOLD,
    fontSize: 12,
    color: COLORS.forest,
  },

  memoBlock: {
    marginTop: 28,
  },
  memoText: {
    fontFamily: SANS_OBLIQUE,
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 6,
    lineHeight: 1.5,
  },

  footer: {
    position: "absolute",
    left: 54,
    right: 54,
    bottom: 36,
    flexDirection: "column",
    alignItems: "center",
  },
  footerThanks: {
    fontFamily: SANS_OBLIQUE,
    fontSize: 9,
    color: COLORS.muted,
    marginBottom: 4,
  },
  footerBusiness: {
    fontFamily: SANS,
    fontSize: 8,
    color: COLORS.subtle,
  },
});

export function InvoicePdfDocument(props: InvoicePdfProps): JSX.Element {
  return (
    <Document
      title={`Invoice ${props.invoiceNumber}`}
      author={props.businessName}
      creator={props.businessName}
      producer={props.businessName}
    >
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.eyebrow}>INVOICE</Text>
            <Text style={styles.invoiceNumber}>{props.invoiceNumber}</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.metaPair}>
              <Text style={styles.metaLabel}>ISSUED</Text>
              <Text style={styles.metaValue}>{props.issuedDate}</Text>
            </View>
            {props.dueDate ? (
              <View style={styles.metaPair}>
                <Text style={styles.metaLabel}>DUE</Text>
                <Text style={styles.metaValue}>{props.dueDate}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.partiesRow}>
          <View style={styles.partyBlock}>
            <Text style={styles.eyebrow}>BILL TO</Text>
            <Text style={styles.partyName}>{props.billToName}</Text>
            <Text style={styles.partyMuted}>{props.billToEmail}</Text>
          </View>
          <View style={[styles.partyBlock, { alignItems: "flex-end" }]}>
            <Text style={styles.eyebrow}>FROM</Text>
            <Text style={styles.partyName}>{props.businessName}</Text>
            <Text style={styles.partyMuted}>{props.businessEmail}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.thDescription}>DESCRIPTION</Text>
            <Text style={styles.thAmount}>AMOUNT</Text>
          </View>
          {props.lineItems.map((item, idx) => (
            <View style={styles.tableRow} key={`li-${idx}`}>
              <Text style={styles.tdDescription}>{item.description}</Text>
              <Text style={styles.tdAmount}>{formatAmount(item.amount)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>TOTAL</Text>
            <Text style={styles.totalValue}>
              {formatAmount(props.totalAmount)}
            </Text>
          </View>
        </View>

        {props.memo ? (
          <View style={styles.memoBlock}>
            <Text style={styles.eyebrow}>MEMO</Text>
            <Text style={styles.memoText}>{props.memo}</Text>
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerThanks}>
            Thank you for your business.
          </Text>
          <Text style={styles.footerBusiness}>
            {props.businessName} · {props.businessEmail}
          </Text>
        </View>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdfBuffer(
  props: InvoicePdfProps
): Promise<Buffer> {
  return renderToBuffer(<InvoicePdfDocument {...props} />);
}
