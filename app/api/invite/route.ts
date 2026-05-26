import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { Resend } from "resend";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ClientStatus,
  type ClientType,
} from "@/lib/supabase";
import { escapeHtml } from "@/lib/escapeHtml";
import { requireOwnerApi } from "@/lib/auth";

interface InviteBody {
  name?: unknown;
  email?: unknown;
  type?: unknown;
  packageId?: unknown;
}

function isClientType(value: unknown): value is ClientType {
  return value === "brand" || value === "bride";
}

function getFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(" ");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

function formatExpiryDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

interface InviteEmailOpts {
  name: string;
  inviteUrl: string;
  expiresAt: Date | null;
}

function buildInviteEmailHtml(opts: InviteEmailOpts): string {
  const firstName = escapeHtml(getFirstName(opts.name));
  const inviteUrl = opts.inviteUrl;
  const safeUrl = escapeHtml(inviteUrl);
  const expiresLine = opts.expiresAt
    ? `
              <p style="margin:14px 0 0;font-size:12px;line-height:1.5;color:#7A8B7C;font-family:'DM Sans',Arial,sans-serif;text-align:center;">This link expires on ${escapeHtml(formatExpiryDate(opts.expiresAt))}.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Digital Bloom Socials — Client Portal</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body style="margin:0;padding:0;background-color:#E8E4D8;font-family:'DM Sans',Arial,sans-serif;color:#1A2B1C;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#E8E4D8;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;border:1px solid #D8D4C8;">
            <tr>
              <td style="background-color:#1B3827;padding:28px 40px;">
                <p style="margin:0 0 6px;color:rgba(255,255,255,0.55);font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-family:'DM Sans',Arial,sans-serif;">Client Portal</p>
                <h1 style="margin:0;font-family:'Playfair Display',Georgia,'Times New Roman',serif;color:#FFFFFF;font-size:22px;font-weight:500;line-height:1.2;">Digital Bloom Socials</h1>
              </td>
            </tr>
            <tr>
              <td style="background-color:#F2EDE4;padding:40px;">
                <h2 style="margin:0 0 20px;font-family:'Playfair Display',Georgia,'Times New Roman',serif;color:#1B3827;font-size:24px;font-weight:500;line-height:1.3;">Hi ${firstName},</h2>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#4B5C4E;font-family:'DM Sans',Arial,sans-serif;">Your client portal is ready. Set up your account to view your project, book shoots, message Kelsey, and access your files — all in one place.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 0;">
                  <tr>
                    <td align="center" style="background-color:#A8788A;">
                      <a href="${safeUrl}" style="display:inline-block;background-color:#A8788A;color:#FFFFFF;text-decoration:none;padding:14px 28px;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;font-family:'DM Sans',Arial,sans-serif;">Set Up Your Account</a>
                    </td>
                  </tr>
                </table>${expiresLine}
                <p style="margin:28px 0 0;padding:14px 16px;background-color:#E8E4D8;border:1px solid #D8D4C8;font-size:12px;line-height:1.5;color:#7A8B7C;font-family:'DM Sans',Arial,sans-serif;">If you received an earlier invitation email from us, please use this most recent link — older links have been deactivated for security.</p>
                <p style="margin:32px 0 6px;font-size:12px;line-height:1.5;color:#7A8B7C;font-family:'DM Sans',Arial,sans-serif;">Button not working? Use this link instead:</p>
                <p style="margin:0;padding:12px 14px;background-color:#E8E4D8;border:1px solid #D8D4C8;font-size:12px;line-height:1.5;color:#4B5C4E;font-family:Menlo,Consolas,'Courier New',monospace;word-break:break-all;">
                  <a href="${safeUrl}" style="color:#4B5C4E;text-decoration:none;">${safeUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="background-color:#132A1C;padding:24px 40px;">
                <p style="margin:0 0 8px;color:#FFFFFF;font-size:14px;font-weight:500;font-family:'Playfair Display',Georgia,'Times New Roman',serif;">Digital Bloom Socials</p>
                <p style="margin:0;color:rgba(255,255,255,0.55);font-size:11px;line-height:1.5;font-family:'DM Sans',Arial,sans-serif;">Questions? Email Kelsey directly at <a href="mailto:digitalbloomsocials@gmail.com" style="color:rgba(255,255,255,0.75);text-decoration:underline;">digitalbloomsocials@gmail.com</a>.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function deriveOrigin(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is required in production. Refusing to derive origin from request.url (Host header is spoofable)."
    );
  }
  return new URL(request.url).origin;
}

function isDuplicateInvitationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const errors = (err as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return false;
  for (const e of errors) {
    if (!e || typeof e !== "object") continue;
    const obj = e as {
      code?: string;
      message?: string;
      long_message?: string;
      longMessage?: string;
    };
    const text =
      `${obj.code ?? ""} ${obj.message ?? ""} ${obj.long_message ?? ""} ${obj.longMessage ?? ""}`.toLowerCase();
    if (
      text.includes("duplicate") ||
      text.includes("already exists") ||
      text.includes("pending invitation")
    ) {
      return true;
    }
  }
  return false;
}

function logClerkErrorDetails(err: unknown) {
  console.error("Failed to create Clerk invitation:", err);
  if (err && typeof err === "object" && "errors" in err) {
    console.error(
      "Clerk error details:",
      JSON.stringify((err as { errors: unknown }).errors, null, 2)
    );
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(request: Request) {
  const authError = await requireOwnerApi();
  if (authError) return authError;

  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, email, type, packageId } = body;

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json(
      { error: "valid email is required" },
      { status: 400 }
    );
  }
  if (!isClientType(type)) {
    return NextResponse.json(
      { error: "type must be 'brand' or 'bride'" },
      { status: 400 }
    );
  }
  if (
    packageId !== undefined &&
    packageId !== null &&
    typeof packageId !== "string"
  ) {
    return NextResponse.json(
      { error: "packageId must be a string" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();
  const supabase = getSupabaseServiceClient();
  const clerk = await clerkClient();

  // ---------------------------------------------------------------------
  // Pre-flight 1: existing Clerk user with this email blocks the invite
  // entirely. Done BEFORE any DB write so we don't have to roll back.
  // ---------------------------------------------------------------------
  console.log(`[invite] checking existing user for ${normalizedEmail}`);
  try {
    const userList = await clerk.users.getUserList({
      emailAddress: [normalizedEmail],
    });
    if (userList.data.length > 0) {
      return NextResponse.json(
        {
          error:
            "A user with this email already has an account. Contact Kelsey to relink it manually.",
        },
        { status: 409 }
      );
    }
  } catch (err) {
    logClerkErrorDetails(err);
    return NextResponse.json(
      { error: "Could not check for existing user. Please try again." },
      { status: 502 }
    );
  }

  // ---------------------------------------------------------------------
  // Pre-flight 2: revoke any pending invitations for this email so the
  // new invitation URL is the only valid one. Sequential awaits so all
  // revocations complete before we attempt the new createInvitation.
  // ---------------------------------------------------------------------
  try {
    const pending = await clerk.invitations.getInvitationList({
      query: normalizedEmail,
      status: "pending",
    });
    const matching = pending.data.filter(
      (inv) => inv.emailAddress.toLowerCase() === normalizedEmail
    );
    if (matching.length > 0) {
      console.log(
        `[invite] revoking ${matching.length} pending invitations for ${normalizedEmail}`
      );
      for (const inv of matching) {
        await clerk.invitations.revokeInvitation(inv.id);
      }
    }
  } catch (err) {
    logClerkErrorDetails(err);
    return NextResponse.json(
      { error: "Could not clean up existing invitations. Please try again." },
      { status: 502 }
    );
  }

  // ---------------------------------------------------------------------
  // Look up any existing row for this email. The clients row is the
  // source of truth — a re-invite for an unlinked row should reuse it,
  // not collide with the email UNIQUE constraint.
  // ---------------------------------------------------------------------
  const { data: existingRow, error: lookupError } = await supabase
    .from("clients")
    .select("id, clerk_user_id, status")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: `Could not look up existing client: ${lookupError.message}` },
      { status: 500 }
    );
  }

  const existing = existingRow as
    | { id: string; clerk_user_id: string | null; status: ClientStatus }
    | null;
  const isNewRow = !existing;

  let client: ClientRecord;

  if (existing) {
    // Pre-flight 1 (above) already returned 409 if a Clerk user with
    // this email exists. So a populated clerk_user_id reaching this
    // branch means the Supabase row points at a Clerk user that has
    // been deleted — a dangling reference. Can happen if a user was
    // deleted in the Clerk dashboard while the dev server was offline
    // and we missed the user.deleted webhook. Clear it and reuse.
    if (existing.clerk_user_id) {
      console.warn(
        `[invite] WARNING: dangling clerk_user_id on row ${existing.id} (was ${existing.clerk_user_id}) — Clerk user not found. Clearing and reusing.`
      );
      const { error: clearError } = await supabase
        .from("clients")
        .update({ clerk_user_id: null })
        .eq("id", existing.id);
      if (clearError) {
        return NextResponse.json(
          { error: `Could not clear dangling reference: ${clearError.message}` },
          { status: 500 }
        );
      }
    } else {
      console.log(
        `[invite] reusing existing unlinked client row ${existing.id} for ${normalizedEmail}`
      );
    }

    // Most-recent-form-submission wins on re-invite. status is
    // intentionally excluded — Kelsey may have advanced the client
    // through onboarding stages between invites and a re-send
    // shouldn't reset that progress. packageId is handled in the
    // projects section below.
    const fieldsToUpdate = {
      name: name.trim(),
      type,
    };
    const { error: updateFieldsError } = await supabase
      .from("clients")
      .update(fieldsToUpdate)
      .eq("id", existing.id);
    if (updateFieldsError) {
      return NextResponse.json(
        { error: `Could not update client fields: ${updateFieldsError.message}` },
        { status: 500 }
      );
    }
    console.log(
      `[invite] updated fields on reused row ${existing.id}: name="${name.trim()}", type=${type}`
    );

    const { data: fullRow, error: fullError } = await supabase
      .from("clients")
      .select("*")
      .eq("id", existing.id)
      .single();
    if (fullError || !fullRow) {
      return NextResponse.json(
        { error: fullError?.message ?? "Could not load existing client" },
        { status: 500 }
      );
    }
    client = fullRow as ClientRecord;
  } else {
    const { data: insertedRow, error: insertError } = await supabase
      .from("clients")
      .insert({
        name: name.trim(),
        email: normalizedEmail,
        type,
        status: "onboarding",
      })
      .select("*")
      .single();

    if (insertError || !insertedRow) {
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create client" },
        { status: 500 }
      );
    }
    client = insertedRow as ClientRecord;
  }

  // Package handling on re-invite:
  //   no existing project + packageId given     → INSERT
  //   existing project + same packageId         → no-op
  //   existing project + different packageId    → UPDATE existing.package_id
  //   existing project + no packageId in form   → leave alone (don't auto-delete)
  //   no existing project + no packageId        → skip entirely
  if (typeof packageId === "string" && packageId.length > 0) {
    const { data: existingProject, error: projectLookupError } = await supabase
      .from("projects")
      .select("id, package_id")
      .eq("client_id", client.id)
      .maybeSingle();

    if (projectLookupError) {
      if (isNewRow) {
        const { error: rollbackErr } = await supabase
          .from("clients")
          .delete()
          .eq("id", client.id);
        if (rollbackErr) {
          console.error(
            `[invite] project lookup failed AND rollback failed for clients.id=${client.id}:`,
            rollbackErr.message
          );
        }
      }
      return NextResponse.json(
        { error: `Could not check existing project: ${projectLookupError.message}` },
        { status: 500 }
      );
    }

    if (!existingProject) {
      const { error: projectError } = await supabase.from("projects").insert({
        client_id: client.id,
        package_id: packageId,
        current_phase: "onboarding",
        status: "active",
      });
      if (projectError) {
        // Only roll back the clients row if WE inserted it. Reused
        // rows existed before this request — deleting them would be
        // data loss.
        if (isNewRow) {
          const { error: rollbackErr } = await supabase
            .from("clients")
            .delete()
            .eq("id", client.id);
          if (rollbackErr) {
            console.error(
              `[invite] project insert failed AND rollback failed for clients.id=${client.id}:`,
              rollbackErr.message
            );
          }
        }
        return NextResponse.json(
          {
            error: `Could not link package: ${projectError.message}. Please try again.`,
          },
          { status: 500 }
        );
      }
    } else if ((existingProject as { id: string; package_id: string | null }).package_id !== packageId) {
      const project = existingProject as { id: string; package_id: string | null };
      const { error: updatePackageError } = await supabase
        .from("projects")
        .update({ package_id: packageId })
        .eq("id", project.id);
      if (updatePackageError) {
        return NextResponse.json(
          {
            error: `Could not update package: ${updatePackageError.message}. Please try again.`,
          },
          { status: 500 }
        );
      }
      console.log(
        `[invite] updated project package on reused row ${client.id}: package_id ${project.package_id ?? "null"} → ${packageId}`
      );
    }
  }

  // ---------------------------------------------------------------------
  // Create the invitation. One retry on duplicate-style errors handles
  // Clerk's eventual-consistency window between revocation and create.
  // Any failure rolls back the clients row so retry is clean.
  // ---------------------------------------------------------------------
  const origin = deriveOrigin(request);
  const redirectUrl = `${origin}/sign-up`;

  // Clerk's invitation API only accepts publicMetadata (no
  // privateMetadata field — verified against @clerk/backend types).
  // Invitation publicMetadata is auto-copied to the new user's
  // publicMetadata on signup. clientId is a UUID, not a secret —
  // safe to expose in JWT claims.
  // expiresInDays is set explicitly so the email's "expires on" date is
  // deterministic from our side too. The Clerk SDK's typed Invitation
  // class doesn't expose the expiry, so we read it off invitation.raw
  // when available and fall back to "now + 30 days" if it's missing.
  const INVITE_EXPIRES_IN_DAYS = 30;
  const invitationParams = {
    emailAddress: normalizedEmail,
    redirectUrl,
    publicMetadata: { role: "client", clientId: client.id },
    notify: false,
    expiresInDays: INVITE_EXPIRES_IN_DAYS,
  } as const;

  let inviteUrl: string;
  let expiresAt: Date | null = null;
  try {
    console.log(`[invite] creating new invitation for ${normalizedEmail}`);
    let invitation;
    try {
      invitation = await clerk.invitations.createInvitation(invitationParams);
    } catch (err) {
      if (isDuplicateInvitationError(err)) {
        console.warn(
          `[invite] duplicate-invitation on first attempt, retrying after 500ms`
        );
        await sleep(500);
        invitation = await clerk.invitations.createInvitation(invitationParams);
      } else {
        throw err;
      }
    }

    if (!invitation.url) {
      throw new Error("Clerk invitation did not return a URL");
    }
    inviteUrl = invitation.url;

    // Try the raw payload for the real expiry. Clerk's @clerk/backend
    // doesn't surface expires_at on the typed Invitation, but the JSON
    // it wraps may include it. Heuristic on units: under 1e12 means
    // seconds (any real ms timestamp is in the 10^13 range now).
    const raw = (invitation.raw ?? null) as
      | { expires_at?: number }
      | null;
    if (raw && typeof raw.expires_at === "number") {
      const ts = raw.expires_at < 1e12 ? raw.expires_at * 1000 : raw.expires_at;
      expiresAt = new Date(ts);
    } else {
      expiresAt = new Date(
        Date.now() + INVITE_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000
      );
    }
  } catch (err) {
    logClerkErrorDetails(err);
    const message = err instanceof Error ? err.message : "unknown error";

    if (!isNewRow) {
      // Reused an existing row — never delete it on failure. The row
      // existed before this request, so the safe move is to leave the
      // DB untouched and let Kelsey retry the invite.
      console.warn(
        `[invite] invitation failed during reuse of clients.id=${client.id}; row left intact`
      );
      return NextResponse.json(
        {
          client,
          error: `Could not send invitation: ${message}. The existing client record is unchanged; try again.`,
        },
        { status: 502 }
      );
    }

    const { error: rollbackErr } = await supabase
      .from("clients")
      .delete()
      .eq("id", client.id);

    if (rollbackErr) {
      console.error(
        `[invite] rollback failed for clients.id=${client.id}:`,
        rollbackErr.message
      );
      return NextResponse.json(
        {
          client,
          error: `Client record created but Clerk invitation failed: ${message}. The client record exists; resend the invite once the Clerk error is resolved.`,
        },
        { status: 502 }
      );
    }

    console.log(`[invite] rolled back clients.id=${client.id}`);
    return NextResponse.json(
      {
        error: "Could not send invitation. Please try again. (No data was saved.)",
      },
      { status: 502 }
    );
  }

  // Clerk invitation creation succeeded (every catch path returns early, so
  // reaching here implies success). Stamp invited_at for BOTH the new-row and
  // reused-row paths in one place. Intentionally outside the try/catch so a
  // stamp DB error doesn't get caught and trigger the new-row rollback above.
  const { error: stampError } = await supabase
    .from("clients")
    .update({ invited_at: new Date().toISOString() })
    .eq("id", client.id);
  if (stampError) {
    console.error(
      `[invite] failed to stamp invited_at on ${client.id}:`,
      stampError.message
    );
    // don't fail the request — the invite itself succeeded
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    const resend = new Resend(resendKey);
    const fromAddress =
      process.env.RESEND_FROM_EMAIL ??
      "Digital Bloom Socials <onboarding@resend.dev>";
    const { error: emailError } = await resend.emails.send({
      from: fromAddress,
      to: client.email,
      subject: "You're invited to your client portal — Digital Bloom Socials",
      html: buildInviteEmailHtml({
        name: client.name,
        inviteUrl,
        expiresAt,
      }),
    });
    if (emailError) {
      return NextResponse.json(
        {
          client,
          reused: !isNewRow,
          inviteUrl,
          warning: `Client created and Clerk invitation issued, but email delivery failed: ${emailError.message}. Share the invite URL manually.`,
        },
        { status: 207 }
      );
    }
  } else {
    return NextResponse.json(
      {
        client,
        reused: !isNewRow,
        inviteUrl,
        warning:
          "RESEND_API_KEY is not configured; Clerk invitation issued but no email was sent. Share the invite URL manually.",
      },
      { status: 207 }
    );
  }

  return NextResponse.json(
    { client, reused: !isNewRow },
    { status: 201 }
  );
}
