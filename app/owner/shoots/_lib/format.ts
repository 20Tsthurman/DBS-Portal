import type { ShootStatus } from "@/lib/supabase";

export function shootStatusLabel(status: ShootStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export type ShootStatusTone = "neutral" | "accent" | "success" | "danger";

export function shootStatusTone(status: ShootStatus): ShootStatusTone {
  switch (status) {
    case "requested":
      return "neutral";
    case "confirmed":
      return "accent";
    case "completed":
      return "success";
    case "cancelled":
      return "danger";
  }
}
