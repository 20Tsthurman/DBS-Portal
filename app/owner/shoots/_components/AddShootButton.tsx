"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { ClientRecord } from "@/lib/supabase";
import { ShootFormPanel } from "./ShootFormPanel";

interface AddShootButtonProps {
  clients: Pick<ClientRecord, "id" | "name">[];
  label?: string;
}

export function AddShootButton({
  clients,
  label = "Add Shoot",
}: AddShootButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ShootFormPanel
        open={open}
        onClose={() => setOpen(false)}
        clients={clients}
      />
    </>
  );
}
