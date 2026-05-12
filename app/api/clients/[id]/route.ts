import { NextResponse } from "next/server";
import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ClientStatus,
  type ClientType,
} from "@/lib/supabase";

// Best-effort Clerk ban — never throws. The DB-level state change is
// the source of truth; the ban is secondary protection so a banned
// client can't create new sessions. If Clerk is down or the user is
// already deleted, log and move on.
async function tryBanClerkUser(clerkUserId: string): Promise<void> {
  try {
    const clerk = await clerkClient();
    await clerk.users.banUser(clerkUserId);
  } catch (err) {
    console.warn(
      `[clients] failed to ban Clerk user ${clerkUserId} (deactivation succeeded anyway):`,
      err instanceof Error ? err.message : err
    );
  }
}

async function tryUnbanClerkUser(clerkUserId: string): Promise<void> {
  try {
    const clerk = await clerkClient();
    await clerk.users.unbanUser(clerkUserId);
  } catch (err) {
    console.warn(
      `[clients] failed to unban Clerk user ${clerkUserId} (reactivation succeeded anyway):`,
      err instanceof Error ? err.message : err
    );
  }
}

interface PatchBody {
  name?: unknown;
  email?: unknown;
  type?: unknown;
  status?: unknown;
}

const VALID_TYPES: ClientType[] = ["brand", "bride"];
const VALID_STATUSES: ClientStatus[] = [
  "active",
  "onboarding",
  "inactive",
  "lead",
];

async function requireOwner() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  if (user?.publicMetadata?.role !== "owner") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireOwner();
  if (guard) return guard;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing client id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Partial<ClientRecord> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return NextResponse.json(
        { error: "name must be a non-empty string" },
        { status: 400 }
      );
    }
    updates.name = body.name.trim();
  }

  if (body.email !== undefined) {
    if (typeof body.email !== "string" || !body.email.includes("@")) {
      return NextResponse.json(
        { error: "email must be a valid address" },
        { status: 400 }
      );
    }
    updates.email = body.email.trim().toLowerCase();
  }

  if (body.type !== undefined) {
    if (
      typeof body.type !== "string" ||
      !VALID_TYPES.includes(body.type as ClientType)
    ) {
      return NextResponse.json(
        { error: "type must be 'brand' or 'bride'" },
        { status: 400 }
      );
    }
    updates.type = body.type as ClientType;
  }

  if (body.status !== undefined) {
    if (
      typeof body.status !== "string" ||
      !VALID_STATUSES.includes(body.status as ClientStatus)
    ) {
      return NextResponse.json(
        { error: "status must be active, onboarding, inactive, or lead" },
        { status: 400 }
      );
    }
    updates.status = body.status as ClientStatus;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "No valid fields to update" },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceClient();

  // Read prior state so we can detect a status transition out of
  // 'inactive' and unban the Clerk user accordingly.
  const { data: priorRow, error: priorError } = await supabase
    .from("clients")
    .select("id, status, clerk_user_id")
    .eq("id", id)
    .maybeSingle();
  if (priorError) {
    return NextResponse.json({ error: priorError.message }, { status: 500 });
  }
  const prior = priorRow as Pick<
    ClientRecord,
    "id" | "status" | "clerk_user_id"
  > | null;

  const { data, error } = await supabase
    .from("clients")
    .update(updates)
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to update client" },
      { status: 500 }
    );
  }

  const updated = data as ClientRecord;
  if (
    prior &&
    prior.clerk_user_id &&
    prior.status === "inactive" &&
    updated.status !== "inactive"
  ) {
    await tryUnbanClerkUser(prior.clerk_user_id);
    console.log(
      `[clients] reactivated row=${updated.id} unbanned=${prior.clerk_user_id}`
    );
  }

  return NextResponse.json({ client: updated });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const guard = await requireOwner();
  if (guard) return guard;

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing client id" }, { status: 400 });
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("clients")
    .update({ status: "inactive" })
    .eq("id", id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to deactivate client" },
      { status: 500 }
    );
  }

  const deactivated = data as ClientRecord;
  if (deactivated.clerk_user_id) {
    await tryBanClerkUser(deactivated.clerk_user_id);
    console.log(
      `[clients] deactivated row=${deactivated.id} banned=${deactivated.clerk_user_id}`
    );
  }

  return NextResponse.json({ client: deactivated });
}
