"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PackageRecord } from "@/lib/supabase";
import { ClientFormPanel } from "./ClientFormPanel";

interface AddClientButtonProps {
  packages: Pick<
    PackageRecord,
    "id" | "name" | "tier" | "monthly_price" | "monthly_hours"
  >[];
  label?: string;
}

export function AddClientButton({ packages, label = "Add Client" }: AddClientButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ClientFormPanel
        open={open}
        onClose={() => setOpen(false)}
        mode="add"
        packages={packages}
      />
    </>
  );
}
