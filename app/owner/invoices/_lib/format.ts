import type { InvoiceStatus } from "@/lib/supabase";

export const CURRENCY = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatInvoiceAmount(value: number): string {
  return CURRENCY.format(value);
}

export function formatIssuedFromTimestamp(
  ts: string | null
): string {
  if (!ts) return "—";
  // Pull the YYYY-MM-DD slice from a timestamptz then route through the
  // existing local-date formatter so the day doesn't shift in tz=west
  // of UTC. Keeps display consistent with `formatDate` on due_date.
  const ymd = ts.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) return "—";
  const [, y, m, d] = match;
  const date = new Date(Number(y), Number(m) - 1, Number(d));
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export type EffectiveStatus = InvoiceStatus;

export function statusToneFor(
  status: EffectiveStatus
): "success" | "neutral" | "danger" | "warning" | "accent" {
  switch (status) {
    case "paid":
      return "success";
    case "overdue":
      return "danger";
    case "sent":
      return "accent";
    case "inactive":
    case "draft":
    default:
      return "neutral";
  }
}

export function statusLabelFor(status: EffectiveStatus): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "overdue":
      return "Overdue";
    case "sent":
      return "Sent";
    case "inactive":
      return "Inactive";
    case "draft":
    default:
      return "Draft";
  }
}

export const INCOME_TYPE_LABELS = {
  brand_retainer: "Brand Retainer",
  wedding_same_day: "Wedding / Same-Day",
  one_off_shoot: "One-Off Shoot",
  other: "Other",
} as const;

export const PAYMENT_METHOD_LABELS = {
  zelle: "Zelle",
  venmo: "Venmo",
  direct_deposit: "Direct Deposit",
  check: "Check",
  cash: "Cash",
  other: "Other",
} as const;
