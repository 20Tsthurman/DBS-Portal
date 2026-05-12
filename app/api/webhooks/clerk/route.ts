import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { clerkClient } from "@clerk/nextjs/server";
import {
  linkClerkUserToClient,
  unlinkClerkUserFromClient,
} from "@/lib/clerk";

type ClerkEmailAddress = {
  id?: string;
  email_address?: string;
};

type ClerkUserData = {
  id?: string;
  email_addresses?: ClerkEmailAddress[];
  public_metadata?: Record<string, unknown>;
  private_metadata?: Record<string, unknown>;
};

type ClerkWebhookEvent = {
  type: string;
  data: ClerkUserData & Record<string, unknown>;
  object?: string;
};

function summarize(event: ClerkWebhookEvent) {
  const { id, email_addresses, public_metadata, private_metadata } = event.data;
  return {
    id,
    emails: email_addresses?.map((e) => e.email_address).filter(Boolean) ?? [],
    public_metadata: public_metadata ?? {},
    private_metadata: private_metadata ?? {},
  };
}

function primaryEmail(event: ClerkWebhookEvent): string | undefined {
  return event.data.email_addresses?.[0]?.email_address;
}

// Best-effort fetch of the existing Clerk user to check for owner role.
// Returns true if confirmed-owner, false in every other case (including
// API errors). False-on-error is intentional: failing-closed here would
// permanently block legitimate client linking on transient Clerk hiccups.
// The owner-overwrite scenario is rare (one owner, set up once); the
// linker logs loudly enough that we can recover manually if it ever fires.
async function isExistingOwner(clerkUserId: string): Promise<boolean> {
  try {
    const clerk = await clerkClient();
    const user = await clerk.users.getUser(clerkUserId);
    return user.publicMetadata?.role === "owner";
  } catch (err) {
    console.warn(
      `[clerk webhook] could not fetch user ${clerkUserId} for owner-role check, proceeding:`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

async function handleUserCreated(event: ClerkWebhookEvent) {
  const clerkUserId = event.data.id;
  if (!clerkUserId) {
    console.warn("[clerk webhook] user.created missing data.id, ignoring");
    return { received: true, action: "skipped_no_user_id" };
  }

  const role = event.data.public_metadata?.role as string | undefined;
  // clientId lives on publicMetadata (not privateMetadata) because
  // Clerk's invitation API only accepts publicMetadata — see
  // app/api/invite/route.ts for context. Invitation publicMetadata is
  // auto-copied to the new user's publicMetadata at signup time.
  const clientId = event.data.public_metadata?.clientId as string | undefined;
  const emailFallback = primaryEmail(event);

  // Manual signup or owner account: no role and no clientId. Webhook fires
  // for every new user, including Kelsey when she sets up her own account
  // for the first time. This is the expected no-op path.
  if (role !== "client" && !clientId) {
    console.log(
      `[clerk webhook] user.created without role/clientId — skipping (likely owner or manual signup): ${clerkUserId}`
    );
    return { received: true, action: "skipped" };
  }

  // role=client but no clientId: the invitation was created without
  // publicMetadata.clientId. Shouldn't happen post-Phase-2 invite refactor;
  // log loudly so any regression is caught.
  if (role === "client" && !clientId) {
    console.warn(
      `[clerk webhook] user.created has role=client but no publicMetadata.clientId for ${clerkUserId} (email=${emailFallback ?? "n/a"}). Invite route may have regressed.`
    );
    return { received: true, action: "skipped_no_client_id" };
  }

  if (!clientId) {
    // Defensive: role !== 'client' but clientId missing — already handled
    // above, but TS flow needs this guard.
    return { received: true, action: "skipped" };
  }

  // Owner-overwrite guard: refuse to link if the Clerk user already has
  // role=owner. Protects against accidentally inviting Kelsey's email.
  if (await isExistingOwner(clerkUserId)) {
    console.warn(
      `[clerk webhook] refusing to overwrite owner role for ${clerkUserId} (email=${emailFallback ?? "n/a"}, clientId=${clientId})`
    );
    return { received: true, action: "skipped_owner_role" };
  }

  const result = await linkClerkUserToClient({
    clerkUserId,
    clientId,
    emailFallback,
  });

  switch (result.kind) {
    case "linked":
      console.log(
        `[clerk webhook] user.created → linked rowId=${result.rowId} clerkUserId=${clerkUserId}`
      );
      return { received: true, action: "linked", rowId: result.rowId };
    case "already_linked":
      console.log(
        `[clerk webhook] user.created → already_linked rowId=${result.rowId} clerkUserId=${clerkUserId}`
      );
      return {
        received: true,
        action: "already_linked",
        rowId: result.rowId,
      };
    case "no_match":
      // 200, not 5xx: retrying won't help if the row doesn't exist.
      return { received: true, action: "no_match" };
    case "error":
      // Transient or otherwise — surface as 5xx so Svix retries.
      return { error: result.message, status: 500 as const };
  }
}

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk webhook] CLERK_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret is not configured" },
      { status: 500 }
    );
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix signature headers" },
      { status: 400 }
    );
  }

  const payload = await request.text();

  let event: ClerkWebhookEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(payload, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkWebhookEvent;
  } catch (err) {
    const message = err instanceof Error ? err.message : "verification failed";
    console.warn("[clerk webhook] signature verification failed:", message);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const summary = summarize(event);

  switch (event.type) {
    case "user.created": {
      const result = await handleUserCreated(event);
      if ("error" in result) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json(result);
    }

    case "user.updated":
      console.log("[clerk webhook] user.updated", summary);
      // TODO(phase 4): handle email changes if needed; for now this is a
      // log-only stub — most updates (metadata edits, profile changes)
      // require no Supabase write.
      return NextResponse.json({ received: true, action: "noop" });

    case "user.deleted": {
      const clerkUserId = event.data.id;
      if (!clerkUserId) {
        console.warn("[clerk webhook] user.deleted missing data.id, ignoring");
        return NextResponse.json({
          received: true,
          action: "skipped_no_user_id",
        });
      }
      const result = await unlinkClerkUserFromClient({ clerkUserId });
      switch (result.kind) {
        case "unlinked":
          console.log(
            `[clerk webhook] user.deleted → unlinked rowId=${result.rowId} previousClerkUserId=${clerkUserId}`
          );
          return NextResponse.json({
            received: true,
            action: "unlinked",
            rowId: result.rowId,
          });
        case "no_match":
          console.log(
            `[clerk webhook] user.deleted but no matching client row for ${clerkUserId} (already unlinked or never linked)`
          );
          return NextResponse.json({ received: true, action: "no_match" });
        case "error":
          return NextResponse.json(
            { error: result.message },
            { status: 500 }
          );
      }
      // unreachable
      return NextResponse.json({ received: true, action: "noop" });
    }

    default:
      console.log("[clerk webhook] unhandled event type:", event.type, summary);
      return NextResponse.json({ received: true, action: "ignored" });
  }
}
