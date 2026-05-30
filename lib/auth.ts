import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getCurrentClient } from "@/lib/currentClient";
import type { ClientRecord } from "@/lib/supabase";

export type RequireOwnerResult =
  | { ok: true; ownerLabel: string }
  | { ok: false; error: string };

export async function requireOwner(): Promise<RequireOwnerResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: "Unauthorized" };
  const user = await currentUser();
  if (user?.publicMetadata?.role !== "owner") {
    return { ok: false, error: "Forbidden" };
  }
  const ownerLabel =
    user?.fullName ||
    user?.primaryEmailAddress?.emailAddress ||
    "Owner";
  return { ok: true, ownerLabel };
}

export async function requireOwnerApi(): Promise<NextResponse | null> {
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

/**
 * Gate for the dual-role API routes (messages, message read, unread counts)
 * that legitimately serve BOTH owner and client callers. Mirrors the
 * return-style convention of `requireOwnerApi`: callers check
 * `instanceof NextResponse` for the failure path, otherwise destructure the
 * success object.
 *
 * On success, a client caller's own `clients` row is resolved here (via the
 * audited `getCurrentClient`) so handlers stop re-deriving it. A client whose
 * Clerk session has `role: "client"` but no matching `clients` row gets the
 * same 403 the call sites previously produced after their own
 * `getCurrentClient()` null-check — behavior preserved, just hoisted.
 *
 * Owner callers resolve with `client: null`; the handlers continue to read
 * the target clientId from the request body/query as before.
 */
export type OwnerOrClientApiResult =
  | { userId: string; role: "owner"; client: null }
  | { userId: string; role: "client"; client: ClientRecord };

export async function requireOwnerOrClientApi(): Promise<
  NextResponse | OwnerOrClientApiResult
> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  if (role !== "owner" && role !== "client") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (role === "client") {
    const client = await getCurrentClient();
    if (!client) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return { userId, role, client };
  }

  return { userId, role, client: null };
}
