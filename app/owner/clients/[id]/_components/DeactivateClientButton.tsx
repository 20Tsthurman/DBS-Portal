"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { deactivateClientAction } from "../../_actions";

interface DeactivateClientButtonProps {
  clientId: string;
  clientName: string;
  isAlreadyInactive: boolean;
}

/**
 * Detail-page entry point for soft-deleting a client. Renders as a secondary
 * "Deactivate Client" button alongside "Edit Client". Confirmation is required
 * before the action fires — once confirmed, the server action flips
 * `clients.status` to 'inactive' and bans the Clerk user. Calls
 * router.refresh() on success so the detail page re-renders with the new
 * status pill.
 *
 * Hidden entirely when the client is already inactive — re-activation routes
 * through the "Edit Client" form (the status dropdown there exposes the
 * inactive option only when the current status is inactive).
 */
export function DeactivateClientButton({
  clientId,
  clientName,
  isAlreadyInactive,
}: DeactivateClientButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (isAlreadyInactive) return null;

  const handleCancel = () => {
    if (isPending) return;
    setOpen(false);
    setError(null);
  };

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await deactivateClientAction(clientId);
      if (!res.ok) {
        setError(res.error ?? "Failed to deactivate client");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        Deactivate Client
      </Button>
      <ConfirmDialog
        open={open}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        title={`Deactivate ${clientName}?`}
        body={
          <>
            They will no longer be able to log in. Their history (time logs,
            shoots, messages, invoices) is kept. You can reactivate them later
            from the Edit Client form.
            {error && (
              <div
                role="alert"
                style={{
                  marginTop: 12,
                  color: "var(--status-danger)",
                  fontSize: 13,
                }}
              >
                {error}
              </div>
            )}
          </>
        }
        confirmLabel="Deactivate"
        variant="danger"
        busy={isPending}
      />
    </>
  );
}
