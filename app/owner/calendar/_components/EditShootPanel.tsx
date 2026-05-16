"use client";

import { useRouter } from "next/navigation";
import type { ClientRecord, ShootRecord } from "@/lib/supabase";
import {
  combineDateAndTimeInTimezone,
} from "@/app/owner/calendar/_lib/timezone";
import { ShootFormPanel } from "@/app/owner/shoots/_components/ShootFormPanel";

interface EditShootPanelProps {
  /** When provided, the panel opens in edit mode. Omit for create mode. */
  shoot?: ShootRecord;
  clients: Pick<ClientRecord, "id" | "name">[];
  closeHref: string;
  /**
   * YYYY-MM-DD to prefill the date field when opening in create mode. The
   * concrete time-of-day defaults to noon (12:00 PORTAL_TIMEZONE) since
   * the day panel only knows the date, not the time. Ignored when `shoot`
   * is provided.
   */
  defaultDateKey?: string;
}

/**
 * URL-driven wrapper around the existing ShootFormPanel. The base panel
 * was built with imperative open/onClose props; this adapter renders it
 * always-open and translates the close action to a Next router navigation.
 *
 * Despite the historical name, this also handles create mode — pass
 * `defaultDateKey` instead of `shoot`. The owner calendar's "+ Add shoot"
 * day-panel button uses that path.
 */
export function EditShootPanel({
  shoot,
  clients,
  closeHref,
  defaultDateKey,
}: EditShootPanelProps) {
  const router = useRouter();
  const defaultScheduledAt =
    !shoot && defaultDateKey
      ? combineDateAndTimeInTimezone(defaultDateKey, "12:00").toISOString()
      : undefined;
  return (
    <ShootFormPanel
      open
      onClose={() => {
        router.push(closeHref);
      }}
      clients={clients}
      shoot={shoot}
      defaultScheduledAt={defaultScheduledAt}
    />
  );
}
