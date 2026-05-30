import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type MessageRecord,
} from "@/lib/supabase";
import { buildUnreadReminderEmailHtml } from "@/lib/messageEmails";
import { resolveBaseUrl } from "@/lib/baseUrl";

export const dynamic = "force-dynamic";

const OWNER_DISPLAY_NAME = "Kelsey";
const OWNER_FALLBACK_EMAIL = "digitalbloomsocials@gmail.com";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

interface ReminderSummary {
  remindersSent: number;
  errors: number;
  suppressed: number;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (
    !process.env.CRON_SECRET ||
    !authHeader ||
    authHeader !== expected
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runReminders();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function runReminders(): Promise<ReminderSummary> {
  const supabase = getSupabaseServiceClient();
  const summary: ReminderSummary = {
    remindersSent: 0,
    errors: 0,
    suppressed: 0,
  };

  const { data: unreadRows, error: unreadError } = await supabase
    .from("messages")
    .select("client_id,sender_role")
    .is("read_at", null);
  if (unreadError) {
    throw new Error(`Failed to fetch unread messages: ${unreadError.message}`);
  }

  const ownerNeedsByClientId = new Set<string>();
  const clientNeedsByClientId = new Set<string>();
  for (const row of (unreadRows ?? []) as Pick<
    MessageRecord,
    "client_id" | "sender_role"
  >[]) {
    if (row.sender_role === "client") {
      ownerNeedsByClientId.add(row.client_id);
    } else if (row.sender_role === "owner") {
      clientNeedsByClientId.add(row.client_id);
    }
  }

  const candidateIds = new Set<string>([
    ...ownerNeedsByClientId,
    ...clientNeedsByClientId,
  ]);
  if (candidateIds.size === 0) {
    return summary;
  }

  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("*")
    .neq("status", "inactive")
    .not("invited_at", "is", null)
    .in("id", Array.from(candidateIds));
  if (clientsError) {
    throw new Error(`Failed to fetch clients: ${clientsError.message}`);
  }

  const now = Date.now();
  const base = resolveBaseUrl();

  const resendKey = process.env.RESEND_API_KEY;
  const resend = resendKey ? new Resend(resendKey) : null;
  const fromAddress =
    process.env.RESEND_FROM_EMAIL ||
    "Digital Bloom Socials <onboarding@resend.dev>";
  const ownerEmail =
    process.env.OWNER_NOTIFICATION_EMAIL || OWNER_FALLBACK_EMAIL;

  for (const record of (clients ?? []) as ClientRecord[]) {
    if (ownerNeedsByClientId.has(record.id)) {
      const cooldownActive = isInCooldown(
        record.owner_last_reminder_email_at,
        now
      );
      if (cooldownActive) {
        summary.suppressed += 1;
      } else {
        const ok = await sendReminder({
          resend,
          fromAddress,
          recipientName: OWNER_DISPLAY_NAME,
          recipientEmail: ownerEmail,
          senderName: record.name,
          portalUrl: `${base}/owner/messages?clientId=${encodeURIComponent(
            record.id
          )}`,
        });
        if (!ok) {
          summary.errors += 1;
        } else {
          const stamped = await stampColumn(
            supabase,
            record.id,
            "owner_last_reminder_email_at"
          );
          if (stamped) {
            summary.remindersSent += 1;
          } else {
            summary.errors += 1;
          }
        }
      }
    }

    if (clientNeedsByClientId.has(record.id)) {
      const cooldownActive = isInCooldown(
        record.client_last_reminder_email_at,
        now
      );
      if (cooldownActive) {
        summary.suppressed += 1;
      } else if (!record.email) {
        // Phone-only client (no email since migration 004) — nothing to email.
        summary.suppressed += 1;
      } else {
        const ok = await sendReminder({
          resend,
          fromAddress,
          recipientName: record.name,
          recipientEmail: record.email,
          senderName: OWNER_DISPLAY_NAME,
          portalUrl: `${base}/client/messages`,
        });
        if (!ok) {
          summary.errors += 1;
        } else {
          const stamped = await stampColumn(
            supabase,
            record.id,
            "client_last_reminder_email_at"
          );
          if (stamped) {
            summary.remindersSent += 1;
          } else {
            summary.errors += 1;
          }
        }
      }
    }
  }

  return summary;
}

function isInCooldown(lastAt: string | null, now: number): boolean {
  if (!lastAt) return false;
  const ts = new Date(lastAt).getTime();
  if (Number.isNaN(ts)) return false;
  return now - ts < COOLDOWN_MS;
}

interface SendReminderParams {
  resend: Resend | null;
  fromAddress: string;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  portalUrl: string;
}

async function sendReminder(params: SendReminderParams): Promise<boolean> {
  if (!params.resend) {
    console.error("[unread-reminders] RESEND_API_KEY not configured");
    return false;
  }
  const { error } = await params.resend.emails.send({
    from: params.fromAddress,
    to: params.recipientEmail,
    subject: "You have unread messages — Digital Bloom Socials",
    html: buildUnreadReminderEmailHtml({
      recipientName: params.recipientName,
      senderName: params.senderName,
      portalUrl: params.portalUrl,
    }),
  });
  if (error) {
    console.error("[unread-reminders] Resend send failed", error);
    return false;
  }
  return true;
}

async function stampColumn(
  supabase: ReturnType<typeof getSupabaseServiceClient>,
  clientId: string,
  column:
    | "owner_last_reminder_email_at"
    | "client_last_reminder_email_at"
): Promise<boolean> {
  const { error } = await supabase
    .from("clients")
    .update({ [column]: new Date().toISOString() })
    .eq("id", clientId);
  if (error) {
    console.error("[unread-reminders] stamp update failed", column, error);
    return false;
  }
  return true;
}
