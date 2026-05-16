import { Resend } from "resend";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type SenderRole,
} from "@/lib/supabase";
import { buildNewMessageEmailHtml } from "@/lib/messageEmails";
import { resolveBaseUrl } from "@/lib/baseUrl";

interface MaybeSendParams {
  clientId: string;
  newMessageId: string;
  senderRole: SenderRole;
  clientRecord: ClientRecord;
}

interface MaybeSendResult {
  sent: boolean;
  suppressed?: boolean;
  error?: string;
}

const OWNER_DISPLAY_NAME = "Kelsey";
const OWNER_FALLBACK_EMAIL = "digitalbloomsocials@gmail.com";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export async function maybeSendNewMessageEmail(
  params: MaybeSendParams
): Promise<MaybeSendResult> {
  const { clientId, senderRole, clientRecord } = params;
  const recipientRole: SenderRole = senderRole === "owner" ? "client" : "owner";

  let recipientName: string;
  let recipientEmail: string;
  let senderName: string;
  let notifiedColumn:
    | "client_last_new_msg_email_at"
    | "owner_last_new_msg_email_at";
  let recipientLastNotifiedAt: string | null;

  if (recipientRole === "client") {
    recipientName = clientRecord.name;
    recipientEmail = clientRecord.email;
    senderName = OWNER_DISPLAY_NAME;
    notifiedColumn = "client_last_new_msg_email_at";
    recipientLastNotifiedAt = clientRecord.client_last_new_msg_email_at;
  } else {
    recipientName = OWNER_DISPLAY_NAME;
    recipientEmail =
      process.env.OWNER_NOTIFICATION_EMAIL || OWNER_FALLBACK_EMAIL;
    senderName = clientRecord.name;
    notifiedColumn = "owner_last_new_msg_email_at";
    recipientLastNotifiedAt = clientRecord.owner_last_new_msg_email_at;
  }

  const lastNotified = recipientLastNotifiedAt
    ? new Date(recipientLastNotifiedAt).getTime()
    : null;
  const isInCooldown =
    lastNotified !== null && Date.now() - lastNotified < COOLDOWN_MS;
  if (isInCooldown) {
    return { sent: false, suppressed: true };
  }

  const base = resolveBaseUrl();
  const portalUrl =
    recipientRole === "client"
      ? `${base}/client/messages`
      : `${base}/owner/messages?clientId=${encodeURIComponent(clientId)}`;

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(resendKey);
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ||
    "Digital Bloom Socials <onboarding@resend.dev>";

  const { error: sendError } = await resend.emails.send({
    from: fromAddress,
    to: recipientEmail,
    subject: `New message from ${senderName} — Digital Bloom Socials`,
    html: buildNewMessageEmailHtml({
      recipientName,
      senderName,
      portalUrl,
    }),
  });

  if (sendError) {
    return { sent: false, error: sendError.message };
  }

  const supabase = getSupabaseServiceClient();
  const { error: updateError } = await supabase
    .from("clients")
    .update({ [notifiedColumn]: new Date().toISOString() })
    .eq("id", clientId);

  if (updateError) {
    console.error(
      "[messageNotifications] notified-column update failed",
      updateError
    );
  }

  return { sent: true };
}
