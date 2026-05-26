"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { sendInviteAction } from "../../_actions";
import type { ClientType } from "@/lib/supabase";

interface SendInviteButtonProps {
  clientId: string;
  clientName: string;
  clientType: ClientType;
  invitedAt: string | null;
}

/**
 * Detail-page entry point for sending (or re-sending) a portal invite.
 * Routes through sendInviteAction, which delegates to /api/invite — the
 * route's "reuse existing unlinked row by email" branch handles both
 * never-invited drafts and re-invites of expired links identically.
 *
 * Hidden entirely for brides (the bride portal is deferred). For brand
 * clients the label flips between "Send Invite" (invited_at IS NULL) and
 * "Resend Invite" (invited_at IS NOT NULL). Inactive clients are not
 * hidden here — the server action returns a friendly error if invoked.
 */
export function SendInviteButton({
  clientId,
  clientName,
  clientType,
  invitedAt,
}: SendInviteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (clientType === "bride") return null;

  const isFirstInvite = invitedAt === null;
  const label = isFirstInvite ? "Send Invite" : "Resend Invite";

  const handleCancel = () => {
    if (isPending) return;
    setOpen(false);
    setError(null);
  };

  const handleConfirm = () => {
    setError(null);
    startTransition(async () => {
      const res = await sendInviteAction({ clientId });
      if (!res.ok) {
        setError(res.error ?? "Failed to send invite");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={open}
        onCancel={handleCancel}
        onConfirm={handleConfirm}
        title={
          isFirstInvite
            ? `Send invite to ${clientName}?`
            : `Resend invite to ${clientName}?`
        }
        body={
          <>
            {isFirstInvite
              ? "They'll receive an email with a portal sign-up link. Their existing record will be linked when they complete signup."
              : "Any previous invitation links will be revoked. They'll receive a new email with a fresh portal sign-up link."}
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
        confirmLabel={label}
        busy={isPending}
      />
    </>
  );
}
