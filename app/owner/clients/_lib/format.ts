import type { ClientStatus, ClientType } from "@/lib/supabase";

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  // YYYY-MM-DD: parse the parts directly so we get a local-time Date
  // and toLocaleDateString has no UTC→local shift to perform. Bare
  // `new Date(yyyy-mm-dd)` parses as UTC midnight, which on hosts
  // west of UTC renders one day earlier.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (ymd) {
    const [, y, m, d] = ymd;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  const pct = value * 100;
  const clamped = Math.max(-999.9, Math.min(999.9, pct));
  return `${clamped.toFixed(1)}%`;
}

export function formatHours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function clientTypeLabel(type: ClientType): string {
  return type === "brand" ? "Brand" : "Bride";
}

export function clientStatusLabel(status: ClientStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type StatusTone = "success" | "neutral" | "danger" | "warning";

export function clientStatusTone(status: ClientStatus): StatusTone {
  switch (status) {
    case "active":
      return "success";
    case "onboarding":
      return "neutral";
    case "inactive":
      return "danger";
    case "lead":
      return "warning";
  }
}
