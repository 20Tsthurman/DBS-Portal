"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import type { PackageRecord } from "@/lib/supabase";
import {
  ClientFormPanel,
  type ClientInitialValues,
} from "../../_components/ClientFormPanel";

interface EditClientButtonProps {
  packages: Pick<PackageRecord, "id" | "name" | "tier" | "monthly_price">[];
  initialValues: ClientInitialValues;
}

export function EditClientButton({
  packages,
  initialValues,
}: EditClientButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Edit Client
      </Button>
      <ClientFormPanel
        open={open}
        onClose={() => setOpen(false)}
        mode="edit"
        packages={packages}
        initialValues={initialValues}
      />
    </>
  );
}
