"use client";

import { useRouter } from "next/navigation";
import type { ClientRecord, ShootRecord } from "@/lib/supabase";
import { ShootFormPanel } from "@/app/owner/shoots/_components/ShootFormPanel";

interface EditShootPanelProps {
  shoot: ShootRecord;
  clients: Pick<ClientRecord, "id" | "name">[];
  closeHref: string;
}

/**
 * URL-driven wrapper around the existing ShootFormPanel. The base panel
 * was built with imperative open/onClose props; this adapter renders it
 * always-open and translates the close action to a Next router navigation.
 */
export function EditShootPanel({
  shoot,
  clients,
  closeHref,
}: EditShootPanelProps) {
  const router = useRouter();
  return (
    <ShootFormPanel
      open
      onClose={() => {
        router.push(closeHref);
      }}
      clients={clients}
      shoot={shoot}
    />
  );
}
