import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

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
