# DBS Portal — CPA Financial Package
**Feature Spec | Owner-side**
*Version 1.0 — June 2026*

> Companion to `docs/dbs-portal-blueprint-v1.md` and `docs/tasks-and-timer-feature.md`.
> Source of truth for the CPA export feature. Read before building anything in the
> financials export path.

---

## 1. Purpose

Generate a clean, print-perfect PDF that hands a CPA everything they need to file Kelsey's
taxes, organized the way a CPA actually thinks — mapped to **Schedule C** line items. The
goal is to turn the year-end handoff from "here's a spreadsheet, good luck" into a document
the CPA can work from in minutes.

**North star:** the numbers are correct and the structure mirrors Schedule C. Polish serves
that, it doesn't replace it.

**Owner-only.** Downloaded by Kelsey; not exposed to clients.

---

## 2. Locked Decisions

| # | Decision | Choice | Reason |
|---|---|---|---|
| 1 | Period | **Custom date range** (full year, quarter, or arbitrary range) | Flexibility for quarterly estimates + year-end. |
| 2 | Income timing | **Cash basis only**, labeled on the doc | Correct for a sole-prop creative LLC; matches `income_payments.payment_date`. No accrual toggle. |
| 3 | Non-full-year ranges | **Hard-warn but allow** | A quarterly or partial range is valid for estimates but must not masquerade as a complete tax-year filing. |
| 4 | Delivery | **Download PDF only** (v1) | Email-to-CPA deferred. |
| 5 | Mileage | Presented as a **deduction, separate from cash expenses** — never summed into cash totals | Mileage is a paper write-off, not money spent. Lumping it in produces a confidently-wrong doc. |
| 6 | Equipment/gear | Presented in its **own labeled block** ("may be depreciable — see your CPA"), itemized, NOT auto-classified into a deduction total | Capital assets may need depreciation / §179 — the CPA decides, not the doc. |
| 7 | Schedule C mapping | App maps the 6 expense categories to Schedule C lines (see §4) | The whole value prop — CPA-shaped, not app-shaped. |
| 8 | Polish | Clean AND correct: numbers verified first, then print-perfect designed PDF | Both, per owner. |
| 9 | Security | Owner-only; requireOwner() / requireOwnerApi() | Consistent posture. |

---

## 3. Data Sources

All read-only aggregation over existing tables — **no schema changes, no new tables.**

- **Income** — `income_payments` filtered by `payment_date` within range. Group by
  `income_type` (brand_retainer / wedding_same_day / one_off_shoot / other). Optional
  per-client subtotals via `client_id` / `client_name_snapshot`.
- **Expenses** — `expenses` filtered by `date` within range. Group by `category` (the 6
  values). Note which rows have a `receipt_url` (currently unused column — see §7 gap).
- **Mileage** — `mileage_logs` filtered by `trip_date` within range. Sum `miles`; deduction
  = sum of `miles × rate_per_mile` (use each row's snapshot `rate_per_mile`, not a single
  current rate, so historical rates stay accurate).
- **Settings** — `app_settings` for `tax_set_aside_percent`, business `home_address`.
- **Business identity** — business name, LLC, EIN: see §7 — these are NOT currently in the
  data model. v1 either pulls from settings if present or leaves labeled blanks for the CPA.

---

## 4. Schedule C Category Mapping

| App category | Schedule C line | Treatment |
|---|---|---|
| `marketing_advertising` | **Line 8 — Advertising** | Direct |
| `professional_services` | **Line 17 — Legal & professional services** | Direct |
| `travel_transportation` | **Line 24a — Travel** | **Non-vehicle only** (flights, lodging). Vehicle mileage is NEVER here — it's the separate mileage section. |
| `platform_software` | **Line 27a — Other expenses** (labeled "Software & subscriptions") | Sub-labeled under Other |
| `business_operations` | **Line 27a — Other expenses** (labeled "Business operations") | Sub-labeled under Other |
| `equipment_gear` | **Own block — "Equipment & gear (may be depreciable)"** | Itemized, NOT folded into the deductible expense total. Flagged for CPA review (depreciation / §179). |

**Critical:** the "Total deductible cash expenses" figure includes the four mapped expense
categories but **excludes equipment_gear and excludes mileage**. Equipment and mileage are
presented as separate, clearly-labeled blocks the CPA treats individually.

---

## 5. PDF Structure

1. **Cover / Summary**
   - Business name, LLC designation, EIN (blank-labeled if absent), tax year / date range,
     prepared-on date, **"Cash basis"** label.
   - If range ≠ full Jan–Dec calendar year: a prominent **warning banner** — "This report
     covers [range], not a full tax year. Not a complete annual filing."
   - Top-line summary table:
     - Gross income
     - Total deductible cash expenses (4 mapped categories)
     - Net cash profit (income − cash expenses)
     - Equipment & gear (separate — may be depreciable)
     - Mileage deduction (separate — miles × rate)
     - Estimated taxable income (net cash profit − mileage − [equipment if expensed, else noted])
     - Tax set aside (% from settings, for reference)

2. **Income detail**
   - Total, then subtotaled by `income_type`.
   - Dated line-item table: date, client, type, amount.
   - Optional per-client subtotal summary.

3. **Expenses by Schedule C line**
   - Each mapped line (8, 17, 24a, 27a) with its subtotal, then itemized rows
     (date, description, amount, receipt-on-file indicator).
   - "Total deductible cash expenses" = sum of these.

4. **Equipment & gear** (separate block)
   - Header note: "These items may be capital assets subject to depreciation or §179
     expensing. Please review." Itemized: date, description, amount. Block total.

5. **Mileage** (separate block)
   - Total miles, rate(s) applied, total deduction. Trip log: date, from→to, miles, rate,
     amount. Note: "Standard mileage deduction — a non-cash write-off, separate from cash
     expenses above."

6. **Tax set-aside reference**
   - Set-aside % and computed reserve on net profit. Note any quarterly payments if tracked
     (v1: reference only if data exists).

7. **Footer on every page** — business name, date range, "Cash basis", page N of M,
   "Prepared by DBS Portal — for CPA review."

---

## 6. UI / Generation

- New section on the Financials page (or a sub-route): **"CPA Package"** with a date-range
  picker (presets: This Year, Last Year, Q1–Q4, Custom) and a **Generate PDF** button.
- Generation uses the existing PDF stack (`@react-pdf/renderer`, already used by
  `lib/invoicePdf.ts` / `receiptPdf.ts`) — match that approach, don't introduce a new lib.
- Server action / route is owner-gated, aggregates per §3, builds the PDF, returns it for
  download.
- The non-full-year warning is computed server-side from the range and rendered into the
  cover.

---

## 7. Known Gaps / Decisions Surfaced

- **Business identity (EIN, legal name) not in the data model.** v1: render labeled blanks
  or pull from `app_settings` if added. A small settings addition (business legal name, EIN)
  would make the cover complete — recommended as a tiny precursor, but not blocking; blanks
  are acceptable for v1.
- **`expenses.receipt_url` is currently unused** (no upload UI per the audit). The
  "receipt on file" indicator will show "none" for all rows until receipt upload ships.
  Keep the column in the doc design so it lights up later.
- **Equipment vs. depreciation is intentionally NOT computed** — the doc surfaces, the CPA
  decides. Do not add depreciation math in v1.
- **Quarterly estimated payments** aren't a tracked entity. The set-aside section is
  reference-only unless/until payments are modeled.

---

## 8. Out of Scope for v1

- Email-to-CPA delivery
- Accrual basis
- Depreciation / §179 computation
- A stored "filed" history of generated packages
- Multi-year comparison
- Receipt images embedded in the PDF (indicator only until upload exists)

---

## 9. Build Order

1. **Aggregation layer** — range-filtered queries + the summary math (cash totals, mileage,
   equipment separation, Schedule C grouping). Verify numbers against the Financials page
   before any PDF work. *(stop checkpoint)*
2. **PDF document** — `@react-pdf/renderer` component per §5, print-perfect. *(stop checkpoint)*
3. **UI** — CPA Package section + date-range picker + Generate. Wire to the owner-gated
   generate action. Non-full-year warning. *(stop checkpoint)*

Each phase independently verifiable. The numbers must be proven correct in Phase 1 before
the PDF wraps them.

---