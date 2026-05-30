import { NextResponse } from "next/server";
import {
  getSupabaseServiceClient,
  type ClientRecord,
  type ClientStatus,
  type ClientType,
} from "@/lib/supabase";
import { requireOwnerApi } from "@/lib/auth";
import { tryBanClerkUser, tryUnbanClerkUser } from "@/lib/clerk";
import { normalizePhone } from "@/lib/phone";

interface PatchBody {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const authError = await requireOwnerApi();
  if (authError) return authError;

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
    // null or empty string clears the email (allowed for non-invited rows);
    // a non-empty value must look like an address.
    if (
      body.email === null ||
      (typeof body.email === "string" && body.email.trim() === "")
    ) {
      updates.email = null;
    } else if (typeof body.email === "string" && body.email.includes("@")) {
      updates.email = body.email.trim().toLowerCase();
    } else {
      return NextResponse.json(
        { error: "email must be a valid address" },
        { status: 400 }
      );
    }
  }

  if (body.phone !== undefined) {
    if (
      body.phone === null ||
      (typeof body.phone === "string" && body.phone.trim() === "")
    ) {
      updates.phone = null;
    } else if (typeof body.phone === "string") {
      const result = normalizePhone(body.phone);
      if (!result.ok) {
        return NextResponse.json(
          { error: "phone must be a valid 10-digit number" },
          { status: 400 }
        );
      }
      updates.phone = result.value;
    } else {
      return NextResponse.json(
        { error: "phone must be a string or null" },
        { status: 400 }
      );
    }
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
  // 'inactive' (to unban the Clerk user) and enforce the at-least-one-contact
  // rule against the post-update email/phone.
  const { data: priorRow, error: priorError } = await supabase
    .from("clients")
    .select("id, status, clerk_user_id, email, phone")
    .eq("id", id)
    .maybeSingle();
  if (priorError) {
    return NextResponse.json({ error: priorError.message }, { status: 500 });
  }
  const prior = priorRow as Pick<
    ClientRecord,
    "id" | "status" | "clerk_user_id" | "email" | "phone"
  > | null;

  // At least one contact method must remain after the update. Computed from
  // the fields actually being changed, falling back to the stored values.
  const effectiveEmail = "email" in updates ? updates.email : prior?.email ?? null;
  const effectivePhone = "phone" in updates ? updates.phone : prior?.phone ?? null;
  if (!effectiveEmail && !effectivePhone) {
    return NextResponse.json(
      { error: "A client must have either an email address or a phone number." },
      { status: 400 }
    );
  }

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
  const authError = await requireOwnerApi();
  if (authError) return authError;

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
