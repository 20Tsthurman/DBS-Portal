import { NextResponse } from "next/server";
import { requireOwnerApi } from "@/lib/auth";
import { fetchInboxClients } from "@/app/owner/messages/_lib/queries";

export async function GET() {
  const authError = await requireOwnerApi();
  if (authError) return authError;

  try {
    const clients = await fetchInboxClients();
    return NextResponse.json({ clients });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load inbox";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
