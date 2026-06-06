/**
 * CPA Financial Package PDF — document component, presentation adapter, and a
 * server-side render helper that returns a `Buffer`. Phase 2 of the CPA
 * package feature (docs/cpa-financial-package-feature.md §5).
 *
 * Mirrors `lib/invoicePdf.tsx` / `lib/receiptPdf.tsx`:
 *   - Built on `@react-pdf/renderer`, LETTER page, `renderToBuffer` helper.
 *   - REUSES the four shared exports from `@/lib/invoicePdf` — `PDF_COLORS`,
 *     `PDF_FONTS`, `formatPdfAmount`, `pdfSharedStyles` — and defines only
 *     CPA-specific styles locally (summary table, warning banner, section
 *     headers, multi-column tables), exactly how receiptPdf.tsx adds only its
 *     PAID badge.
 *   - Does NOT register fonts. Uses the pdfkit built-ins already in use
 *     (Times-Roman/Bold serif, Helvetica family sans) for the same reason
 *     documented in invoicePdf.tsx: no fonts.gstatic.com fetch at render time,
 *     which is flaky/blocked in some serverless environments.
 *
 * Convention (matches invoicePdf): the document is "dumb" — dates arrive as
 * pre-formatted strings, amounts arrive as raw numbers formatted in-doc via
 * `formatPdfAmount`. All reshaping/formatting lives in `buildCpaPackagePdfProps`.
 *
 * Business identity: the legal name is a local constant for now
 * (`BUSINESS_NAME`). EIN and mailing address render as clearly labeled blanks
 * per spec §7 — no schema fields exist for them yet. (Lifting the
 * invoices/_actions.ts business constants into a shared module is a later
 * cleanup, intentionally NOT done here.)
 */

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";
import type { JSX, ReactNode } from "react";
import {
  PDF_COLORS,
  PDF_FONTS,
  formatPdfAmount,
  pdfSharedStyles,
} from "@/lib/invoicePdf";
import type { CpaPackageData } from "@/app/owner/financials/_lib/cpaPackage";

/** Hardcoded for now (see header note). Phase-later: share with invoices. */
const BUSINESS_NAME = "Digital Bloom Socials LLC";

// ---------------------------------------------------------------------------
// Props — flat, presentation-ready. Dates are formatted strings; amounts/miles/
// rates are raw numbers (formatted in-doc).
// ---------------------------------------------------------------------------

export interface CpaPdfSubtotal {
  label: string;
  count: number;
  amount: number;
}

export interface CpaPdfIncomeRow {
  date: string;
  clientName: string;
  typeLabel: string;
  amount: number;
}

export interface CpaPdfExpenseRow {
  date: string;
  description: string;
  receiptLabel: string;
  amount: number;
}

export interface CpaPdfScheduleCLine {
  lineNumber: string;
  lineLabel: string;
  subtotal: number;
  /** Per-category subtotals; rendered as a breakdown when length > 1 (27a). */
  subGroups: Array<{ label: string; amount: number }>;
  rows: CpaPdfExpenseRow[];
}

export interface CpaPdfMileageRow {
  date: string;
  route: string;
  clientName: string;
  miles: number;
  ratePerMile: number;
  amount: number;
}

export interface CpaPackagePdfSummary {
  grossIncome: number;
  totalDeductibleCashExpenses: number;
  netCashProfit: number;
  equipmentTotal: number;
  mileageDeduction: number;
  estimatedTaxableIncome: number;
  estimatedTaxableIncomeIfEquipmentExpensed: number;
  taxSetAsidePercent: number;
  taxSetAsideReserve: number;
}

export interface CpaPackagePdfProps {
  // Cover / identity
  businessName: string;
  einBlank: boolean;
  addressBlank: boolean;
  rangeLabel: string;
  preparedOnLabel: string;
  isFullCalendarYear: boolean;

  // Top-line summary
  summary: CpaPackagePdfSummary;

  // Sections
  income: {
    grossIncome: number;
    byIncomeType: CpaPdfSubtotal[];
    byClient: CpaPdfSubtotal[];
    rows: CpaPdfIncomeRow[];
  };
  scheduleCLines: CpaPdfScheduleCLine[];
  totalDeductibleCashExpenses: number;
  equipment: {
    total: number;
    rows: CpaPdfExpenseRow[];
  };
  mileage: {
    totalMiles: number;
    mileageDeduction: number;
    ratesApplied: number[];
    rows: CpaPdfMileageRow[];
  };
}

// ---------------------------------------------------------------------------
// Adapter — CpaPackageData → presentation-ready props. All date string
// formatting and null→placeholder coercion happens here so the doc stays dumb.
// ---------------------------------------------------------------------------

function formatLongDate(yyyyMmDd: string): string {
  // Explicit UTC noon so a negative-offset server can't roll the day back —
  // same trick as invoices/_actions.ts:formatDateLong (which is private there).
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function formatLongDateFromDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function receiptLabel(onFile: boolean): string {
  return onFile ? "On file" : "None";
}

export function buildCpaPackagePdfProps(
  data: CpaPackageData,
  meta: {
    rangeLabel: string;
    rangeStart: Date;
    rangeEnd: Date;
    preparedOn: Date;
  }
): CpaPackagePdfProps {
  // Full calendar year iff start is Jan 1 and end is Dec 31 of the same year.
  // Reads local Date fields — callers should build the meta Dates with the
  // local constructor (new Date(y, m, d)) so this stays offset-agnostic.
  const isFullCalendarYear =
    meta.rangeStart.getFullYear() === meta.rangeEnd.getFullYear() &&
    meta.rangeStart.getMonth() === 0 &&
    meta.rangeStart.getDate() === 1 &&
    meta.rangeEnd.getMonth() === 11 &&
    meta.rangeEnd.getDate() === 31;

  return {
    businessName: BUSINESS_NAME,
    einBlank: true,
    addressBlank: true,
    rangeLabel: meta.rangeLabel,
    preparedOnLabel: `Prepared on ${formatLongDateFromDate(meta.preparedOn)}`,
    isFullCalendarYear,

    summary: {
      grossIncome: data.summary.grossIncome,
      totalDeductibleCashExpenses: data.summary.totalDeductibleCashExpenses,
      netCashProfit: data.summary.netCashProfit,
      equipmentTotal: data.summary.equipmentTotal,
      mileageDeduction: data.summary.mileageDeduction,
      estimatedTaxableIncome: data.summary.estimatedTaxableIncome,
      estimatedTaxableIncomeIfEquipmentExpensed:
        data.summary.estimatedTaxableIncomeIfEquipmentExpensed,
      taxSetAsidePercent: data.summary.taxSetAsidePercent,
      taxSetAsideReserve: data.summary.taxSetAsideReserve,
    },

    income: {
      grossIncome: data.income.grossIncome,
      byIncomeType: data.income.byIncomeType.map((g) => ({
        label: g.label,
        count: g.count,
        amount: g.subtotal,
      })),
      byClient: data.income.byClient.map((c) => ({
        label: c.clientName,
        count: c.count,
        amount: c.subtotal,
      })),
      rows: data.income.rows.map((r) => ({
        date: formatLongDate(r.date),
        clientName: r.clientName,
        typeLabel: r.incomeTypeLabel,
        amount: r.amount,
      })),
    },

    scheduleCLines: data.expenses.byScheduleCLine.map((line) => ({
      lineNumber: line.lineNumber,
      lineLabel: line.lineLabel,
      subtotal: line.subtotal,
      subGroups: line.subGroups.map((g) => ({
        label: g.label,
        amount: g.subtotal,
      })),
      rows: line.rows.map((r) => ({
        date: formatLongDate(r.date),
        description: r.description ?? "—",
        receiptLabel: receiptLabel(r.receiptOnFile),
        amount: r.amount,
      })),
    })),
    totalDeductibleCashExpenses: data.expenses.totalDeductibleCashExpenses,

    equipment: {
      total: data.equipment.total,
      rows: data.equipment.rows.map((r) => ({
        date: formatLongDate(r.date),
        description: r.description ?? "—",
        receiptLabel: receiptLabel(r.receiptOnFile),
        amount: r.amount,
      })),
    },

    mileage: {
      totalMiles: data.mileage.totalMiles,
      mileageDeduction: data.mileage.mileageDeduction,
      ratesApplied: data.mileage.ratesApplied,
      rows: data.mileage.rows.map((r) => ({
        date: formatLongDate(r.date),
        route: `${r.fromAddress} → ${r.toAddress}`,
        clientName: r.clientName ?? "—",
        miles: r.miles,
        ratePerMile: r.ratePerMile,
        amount: r.amount,
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// Styles — reuse the shared palette/fonts/base sheet; add CPA-specific styles.
// ---------------------------------------------------------------------------

const COLORS = PDF_COLORS;
const SERIF_BOLD = PDF_FONTS.serifBold;
const SANS = PDF_FONTS.sans;
const SANS_BOLD = PDF_FONTS.sansBold;
const SANS_OBLIQUE = PDF_FONTS.sansOblique;

const s = pdfSharedStyles;

const DANGER = "#9B2C2C"; // local only: legal-safety warning, intentionally outside the brand palette — NOT added to PDF_COLORS

const cpa = StyleSheet.create({
  businessName: {
    fontFamily: SERIF_BOLD,
    fontSize: 24,
    color: COLORS.forest,
    marginTop: 4,
    lineHeight: 1.1,
  },
  identityBlock: {
    marginTop: 12,
  },
  identityLine: {
    fontFamily: SANS,
    fontSize: 9,
    color: COLORS.muted,
    marginTop: 3,
  },
  metaBlock: {
    marginTop: 14,
  },
  metaLine: {
    fontFamily: SANS,
    fontSize: 10,
    color: COLORS.forestDark,
    marginTop: 3,
  },
  basisBadge: {
    marginTop: 10,
    alignSelf: "flex-start",
    paddingTop: 4,
    paddingBottom: 4,
    paddingLeft: 10,
    paddingRight: 10,
    backgroundColor: COLORS.forest,
    color: "#FFFFFF",
    fontFamily: SANS_BOLD,
    fontSize: 9,
    letterSpacing: 2,
  },

  // Non-full-year warning. Uses the local DANGER red (outside the brand
  // palette) so it reads as a true legal-safety warning, not a brand accent.
  warningBanner: {
    marginTop: 18,
    padding: 12,
    backgroundColor: DANGER,
  },
  warningTitle: {
    fontFamily: SANS_BOLD,
    fontSize: 10,
    color: "#FFFFFF",
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  warningText: {
    fontFamily: SANS,
    fontSize: 9,
    color: "#FFFFFF",
    lineHeight: 1.4,
  },

  sectionTitle: {
    fontFamily: SERIF_BOLD,
    fontSize: 15,
    color: COLORS.forest,
    marginTop: 8,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingBottom: 4,
  },
  sectionSubtitle: {
    fontFamily: SANS_BOLD,
    fontSize: 10,
    color: COLORS.forestDark,
    marginTop: 12,
    marginBottom: 4,
    letterSpacing: 0.5,
  },

  // Summary (cover) two-column table.
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingTop: 7,
    paddingBottom: 7,
  },
  summaryLabel: {
    flexBasis: "72%",
    fontFamily: SANS,
    fontSize: 10,
    color: COLORS.forestDark,
    paddingRight: 10,
  },
  summaryValue: {
    flexBasis: "28%",
    textAlign: "right",
    fontFamily: SANS,
    fontSize: 10,
    color: COLORS.forestDark,
  },
  summaryStrong: {
    fontFamily: SANS_BOLD,
    color: COLORS.forest,
  },

  note: {
    fontFamily: SANS_OBLIQUE,
    fontSize: 8.5,
    color: COLORS.muted,
    marginTop: 8,
    lineHeight: 1.45,
  },

  // Generic multi-column tables (income/expense/equipment/mileage).
  tHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.forest,
    paddingBottom: 5,
    marginTop: 4,
  },
  tRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingTop: 6,
    paddingBottom: 6,
  },
  th: {
    fontFamily: SANS_BOLD,
    fontSize: 8,
    color: COLORS.forestDark,
    letterSpacing: 0.8,
    paddingRight: 6,
  },
  td: {
    fontFamily: SANS,
    fontSize: 9,
    color: COLORS.forestDark,
    paddingRight: 6,
  },
  right: {
    textAlign: "right",
    paddingRight: 0,
  },
  tdStrong: {
    fontFamily: SANS_BOLD,
    color: COLORS.forest,
  },

  // Schedule C line header (number + label + subtotal).
  lineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginTop: 14,
  },
  lineHeaderLabel: {
    fontFamily: SANS_BOLD,
    fontSize: 11,
    color: COLORS.forest,
  },
  lineHeaderSubtotal: {
    fontFamily: SANS_BOLD,
    fontSize: 11,
    color: COLORS.forest,
  },
  subGroupLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 3,
  },
  subGroupLabel: {
    fontFamily: SANS,
    fontSize: 8.5,
    color: COLORS.subtle,
  },
  subGroupAmount: {
    fontFamily: SANS,
    fontSize: 8.5,
    color: COLORS.subtle,
  },
  emptyRow: {
    fontFamily: SANS_OBLIQUE,
    fontSize: 9,
    color: COLORS.subtle,
    paddingTop: 6,
    paddingBottom: 6,
  },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: COLORS.forest,
    paddingTop: 8,
    marginTop: 4,
  },
  totalLabel: {
    fontFamily: SANS_BOLD,
    fontSize: 11,
    color: COLORS.forest,
  },
  totalValue: {
    fontFamily: SANS_BOLD,
    fontSize: 11,
    color: COLORS.forest,
  },

  footerLine: {
    fontFamily: SANS,
    fontSize: 8,
    color: COLORS.subtle,
    marginTop: 2,
  },
});

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Th({
  w,
  right,
  children,
}: {
  w: string;
  right?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <Text style={[cpa.th, { flexBasis: w }, ...(right ? [cpa.right] : [])]}>
      {children}
    </Text>
  );
}

function Td({
  w,
  right,
  strong,
  children,
}: {
  w: string;
  right?: boolean;
  strong?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <Text
      style={[
        cpa.td,
        { flexBasis: w },
        ...(right ? [cpa.right] : []),
        ...(strong ? [cpa.tdStrong] : []),
      ]}
    >
      {children}
    </Text>
  );
}

function SummaryLine({
  label,
  value,
  strong,
}: {
  label: string;
  value: number;
  strong?: boolean;
}): JSX.Element {
  return (
    <View style={cpa.summaryRow}>
      <Text style={[cpa.summaryLabel, ...(strong ? [cpa.summaryStrong] : [])]}>
        {label}
      </Text>
      <Text style={[cpa.summaryValue, ...(strong ? [cpa.summaryStrong] : [])]}>
        {formatPdfAmount(value)}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

export function CpaPackageDocument(props: CpaPackagePdfProps): JSX.Element {
  const { summary, income, scheduleCLines, equipment, mileage } = props;

  return (
    <Document
      title={`CPA Tax Package — ${props.rangeLabel}`}
      author={props.businessName}
      creator={props.businessName}
      producer={props.businessName}
    >
      <Page size="LETTER" style={s.page}>
        {/* (1) COVER / SUMMARY ------------------------------------------- */}
        <Text style={s.eyebrow}>CPA TAX PACKAGE</Text>
        <Text style={cpa.businessName}>{props.businessName}</Text>

        <View style={cpa.identityBlock}>
          <Text style={cpa.identityLine}>
            EIN: {props.einBlank ? "____________________" : ""}
          </Text>
          <Text style={cpa.identityLine}>
            Business address:{" "}
            {props.addressBlank ? "________________________________" : ""}
          </Text>
        </View>

        <View style={cpa.metaBlock}>
          <Text style={cpa.metaLine}>
            Tax year / period: {props.rangeLabel}
          </Text>
          <Text style={cpa.metaLine}>{props.preparedOnLabel}</Text>
          <Text style={cpa.basisBadge}>CASH BASIS</Text>
        </View>

        {!props.isFullCalendarYear ? (
          <View style={cpa.warningBanner}>
            <Text style={cpa.warningTitle}>
              PARTIAL PERIOD — NOT A COMPLETE TAX-YEAR FILING
            </Text>
            <Text style={cpa.warningText}>
              This report covers {props.rangeLabel}, not a full January 1 –
              December 31 calendar year. It is valid for quarterly estimates and
              planning but must not be treated as a complete annual filing.
            </Text>
          </View>
        ) : null}

        <View style={s.divider} />

        <Text style={cpa.sectionTitle}>Summary</Text>
        <View>
          <SummaryLine label="Gross income" value={summary.grossIncome} />
          <SummaryLine
            label="Total deductible cash expenses (Schedule C lines 8, 17, 24a, 27a)"
            value={summary.totalDeductibleCashExpenses}
          />
          <SummaryLine
            label="Net cash profit (income − cash expenses)"
            value={summary.netCashProfit}
            strong
          />
          <SummaryLine
            label="Equipment & gear (separate — may be depreciable)"
            value={summary.equipmentTotal}
          />
          <SummaryLine
            label="Mileage deduction (separate — non-cash write-off)"
            value={summary.mileageDeduction}
          />
          <SummaryLine
            label="Estimated taxable income — equipment held for CPA review"
            value={summary.estimatedTaxableIncome}
            strong
          />
          <SummaryLine
            label="Estimated taxable income — if equipment fully expensed"
            value={summary.estimatedTaxableIncomeIfEquipmentExpensed}
            strong
          />
          <SummaryLine
            label={`Tax set-aside reference (${summary.taxSetAsidePercent}% of net profit)`}
            value={summary.taxSetAsideReserve}
          />
        </View>

        <Text style={cpa.note}>
          The two taxable-income figures differ only by the equipment & gear
          total ({formatPdfAmount(summary.equipmentTotal)}). Whether that
          equipment is depreciated, expensed under §179, or capitalized is the
          CPA&apos;s decision — both figures are shown so the choice is explicit.
          Mileage is already deducted in both.
        </Text>

        {/* (2) INCOME DETAIL --------------------------------------------- */}
        <View break>
          <Text style={cpa.sectionTitle}>
            Income detail — gross {formatPdfAmount(income.grossIncome)}
          </Text>

          <Text style={cpa.sectionSubtitle}>Subtotals by income type</Text>
          <View style={cpa.tHeader}>
            <Th w="60%">INCOME TYPE</Th>
            <Th w="15%" right>
              COUNT
            </Th>
            <Th w="25%" right>
              SUBTOTAL
            </Th>
          </View>
          {income.byIncomeType.map((g, i) => (
            <View style={cpa.tRow} wrap={false} key={`it-${i}`}>
              <Td w="60%">{g.label}</Td>
              <Td w="15%" right>
                {g.count}
              </Td>
              <Td w="25%" right>
                {formatPdfAmount(g.amount)}
              </Td>
            </View>
          ))}
          <View style={cpa.totalRow}>
            <Text style={cpa.totalLabel}>Gross income</Text>
            <Text style={cpa.totalValue}>
              {formatPdfAmount(income.grossIncome)}
            </Text>
          </View>

          {income.byClient.length > 0 ? (
            <>
              <Text style={cpa.sectionSubtitle}>Subtotals by client</Text>
              <View style={cpa.tHeader}>
                <Th w="60%">CLIENT</Th>
                <Th w="15%" right>
                  COUNT
                </Th>
                <Th w="25%" right>
                  SUBTOTAL
                </Th>
              </View>
              {income.byClient.map((c, i) => (
                <View style={cpa.tRow} wrap={false} key={`cl-${i}`}>
                  <Td w="60%">{c.label}</Td>
                  <Td w="15%" right>
                    {c.count}
                  </Td>
                  <Td w="25%" right>
                    {formatPdfAmount(c.amount)}
                  </Td>
                </View>
              ))}
            </>
          ) : null}

          <Text style={cpa.sectionSubtitle}>Line items</Text>
          <View style={cpa.tHeader}>
            <Th w="22%">DATE</Th>
            <Th w="38%">CLIENT</Th>
            <Th w="22%">TYPE</Th>
            <Th w="18%" right>
              AMOUNT
            </Th>
          </View>
          {income.rows.length === 0 ? (
            <Text style={cpa.emptyRow}>No income in range.</Text>
          ) : (
            income.rows.map((r, i) => (
              <View style={cpa.tRow} wrap={false} key={`ir-${i}`}>
                <Td w="22%">{r.date}</Td>
                <Td w="38%">{r.clientName}</Td>
                <Td w="22%">{r.typeLabel}</Td>
                <Td w="18%" right>
                  {formatPdfAmount(r.amount)}
                </Td>
              </View>
            ))
          )}
        </View>

        {/* (3) EXPENSES BY SCHEDULE C LINE ------------------------------- */}
        <View break>
          <Text style={cpa.sectionTitle}>Expenses by Schedule C line</Text>
          <Text style={cpa.note}>
            Excludes equipment & gear and vehicle mileage — each is presented in
            its own block below.
          </Text>

          {scheduleCLines.map((line, li) => (
            <View key={`line-${li}`}>
              <View style={cpa.lineHeader}>
                <Text style={cpa.lineHeaderLabel}>
                  Line {line.lineNumber} — {line.lineLabel}
                </Text>
                <Text style={cpa.lineHeaderSubtotal}>
                  {formatPdfAmount(line.subtotal)}
                </Text>
              </View>

              {line.subGroups.length > 1
                ? line.subGroups.map((g, gi) => (
                    <View style={cpa.subGroupLine} key={`sg-${li}-${gi}`}>
                      <Text style={cpa.subGroupLabel}>{g.label}</Text>
                      <Text style={cpa.subGroupAmount}>
                        {formatPdfAmount(g.amount)}
                      </Text>
                    </View>
                  ))
                : null}

              <View style={cpa.tHeader}>
                <Th w="22%">DATE</Th>
                <Th w="45%">DESCRIPTION</Th>
                <Th w="15%">RECEIPT</Th>
                <Th w="18%" right>
                  AMOUNT
                </Th>
              </View>
              {line.rows.length === 0 ? (
                <Text style={cpa.emptyRow}>No expenses in range.</Text>
              ) : (
                line.rows.map((r, ri) => (
                  <View style={cpa.tRow} wrap={false} key={`er-${li}-${ri}`}>
                    <Td w="22%">{r.date}</Td>
                    <Td w="45%">{r.description}</Td>
                    <Td w="15%">{r.receiptLabel}</Td>
                    <Td w="18%" right>
                      {formatPdfAmount(r.amount)}
                    </Td>
                  </View>
                ))
              )}
            </View>
          ))}

          <View style={cpa.totalRow}>
            <Text style={cpa.totalLabel}>Total deductible cash expenses</Text>
            <Text style={cpa.totalValue}>
              {formatPdfAmount(props.totalDeductibleCashExpenses)}
            </Text>
          </View>
        </View>

        {/* (4) EQUIPMENT & GEAR ------------------------------------------ */}
        <View break>
          <Text style={cpa.sectionTitle}>
            Equipment & gear — total {formatPdfAmount(equipment.total)}
          </Text>
          <Text style={cpa.note}>
            These items may be capital assets subject to depreciation or §179
            expensing. They are NOT included in the deductible cash-expense
            total above. Please review and apply the appropriate treatment.
          </Text>

          <View style={cpa.tHeader}>
            <Th w="22%">DATE</Th>
            <Th w="45%">DESCRIPTION</Th>
            <Th w="15%">RECEIPT</Th>
            <Th w="18%" right>
              AMOUNT
            </Th>
          </View>
          {equipment.rows.length === 0 ? (
            <Text style={cpa.emptyRow}>No equipment in range.</Text>
          ) : (
            equipment.rows.map((r, i) => (
              <View style={cpa.tRow} wrap={false} key={`eq-${i}`}>
                <Td w="22%">{r.date}</Td>
                <Td w="45%">{r.description}</Td>
                <Td w="15%">{r.receiptLabel}</Td>
                <Td w="18%" right>
                  {formatPdfAmount(r.amount)}
                </Td>
              </View>
            ))
          )}
          <View style={cpa.totalRow}>
            <Text style={cpa.totalLabel}>Equipment & gear total</Text>
            <Text style={cpa.totalValue}>{formatPdfAmount(equipment.total)}</Text>
          </View>
        </View>

        {/* (5) MILEAGE --------------------------------------------------- */}
        <View break>
          <Text style={cpa.sectionTitle}>
            Mileage — deduction {formatPdfAmount(mileage.mileageDeduction)}
          </Text>
          <Text style={cpa.note}>
            Standard mileage deduction — a non-cash write-off, separate from the
            cash expenses above. Total miles:{" "}
            {mileage.totalMiles.toLocaleString("en-US")} · rate(s) applied:{" "}
            {mileage.ratesApplied.length === 0
              ? "—"
              : mileage.ratesApplied
                  .map((r) => `${formatPdfAmount(r)}/mi`)
                  .join(", ")}
            .
          </Text>

          <View style={cpa.tHeader}>
            <Th w="15%">DATE</Th>
            <Th w="37%">FROM → TO</Th>
            <Th w="15%">CLIENT</Th>
            <Th w="11%" right>
              MILES
            </Th>
            <Th w="10%" right>
              RATE
            </Th>
            <Th w="12%" right>
              AMOUNT
            </Th>
          </View>
          {mileage.rows.length === 0 ? (
            <Text style={cpa.emptyRow}>No mileage in range.</Text>
          ) : (
            mileage.rows.map((r, i) => (
              <View style={cpa.tRow} wrap={false} key={`mi-${i}`}>
                <Td w="15%">{r.date}</Td>
                <Td w="37%">{r.route}</Td>
                <Td w="15%">{r.clientName}</Td>
                <Td w="11%" right>
                  {r.miles.toLocaleString("en-US")}
                </Td>
                <Td w="10%" right>
                  {formatPdfAmount(r.ratePerMile)}
                </Td>
                <Td w="12%" right>
                  {formatPdfAmount(r.amount)}
                </Td>
              </View>
            ))
          )}
          <View style={cpa.totalRow}>
            <Text style={cpa.totalLabel}>Total mileage deduction</Text>
            <Text style={cpa.totalValue}>
              {formatPdfAmount(mileage.mileageDeduction)}
            </Text>
          </View>
        </View>

        {/* (6) TAX SET-ASIDE REFERENCE ----------------------------------- */}
        <View break>
          <Text style={cpa.sectionTitle}>Tax set-aside reference</Text>
          <View>
            <SummaryLine
              label="Net cash profit (basis for the reserve)"
              value={summary.netCashProfit}
            />
            <SummaryLine
              label={`Set-aside rate (${summary.taxSetAsidePercent}%) applied to net profit`}
              value={summary.taxSetAsideReserve}
              strong
            />
          </View>
          <Text style={cpa.note}>
            Reference only. This is the portal&apos;s configured set-aside
            percentage applied to net cash profit — an estimate to guide
            reserves, not a calculated tax liability. Quarterly estimated
            payments are not tracked in the portal.
          </Text>
        </View>

        {/* FOOTER (every page) ------------------------------------------- */}
        <View style={s.footer} fixed>
          <Text style={cpa.footerLine}>
            {props.businessName} · {props.rangeLabel} · Cash basis
          </Text>
          <Text
            style={cpa.footerLine}
            fixed
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}  ·  Prepared by DBS Portal — for CPA review`
            }
          />
        </View>
      </Page>
    </Document>
  );
}

export async function renderCpaPackagePdfBuffer(
  props: CpaPackagePdfProps
): Promise<Buffer> {
  return renderToBuffer(<CpaPackageDocument {...props} />);
}
