// DEV-ONLY scratch page for testing <MessageThread> in isolation.
// Delete after Step 6 ships.

import { redirect } from "next/navigation";
import { auth, currentUser } from "@clerk/nextjs/server";
import { MessageThread } from "@/components/messages/MessageThread";
import { getSupabaseServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

interface ClientRow {
  id: string;
  name: string;
}

export default async function MessageThreadDevPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");

  const user = await currentUser();
  const role = user?.publicMetadata?.role;
  if (role !== "owner" && role !== "client") {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 32,
          backgroundColor: "var(--surface-base)",
          color: "var(--text-body)",
        }}
      >
        Cannot test this page without an owner or client account.
      </div>
    );
  }

  const params = await searchParams;
  const raw = params.clientId;
  const clientId = typeof raw === "string" ? raw.trim() : "";

  if (!clientId) {
    const supabase = getSupabaseServiceClient();
    const { data } = await supabase
      .from("clients")
      .select("id, name")
      .order("created_at", { ascending: false })
      .limit(8);
    const recent = (data ?? []) as ClientRow[];

    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 32,
          backgroundColor: "var(--surface-base)",
        }}
      >
        <div style={{ maxWidth: 560 }}>
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
              marginBottom: 8,
            }}
          >
            DEV — Scratch Page
          </p>
          <h1
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: 28,
              fontWeight: 500,
              color: "var(--text-primary)",
              marginBottom: 16,
            }}
          >
            MessageThread test
          </h1>
          <p
            style={{
              fontSize: 14,
              color: "var(--text-body)",
              marginBottom: 16,
            }}
          >
            Provide a <code>clientId</code> to mount the component.
          </p>
          <form method="get" style={{ marginBottom: 24 }}>
            <input
              name="clientId"
              placeholder="client UUID"
              required
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: 14,
                fontFamily: "inherit",
                border: "1px solid var(--border)",
                backgroundColor: "var(--surface-raised)",
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            />
            <button
              type="submit"
              style={{
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                backgroundColor: "var(--accent)",
                color: "#FFFFFF",
                border: "none",
                cursor: "pointer",
              }}
            >
              Open thread
            </button>
          </form>
          {recent.length > 0 && (
            <div>
              <p
                style={{
                  fontSize: 11,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  color: "var(--text-muted)",
                  marginBottom: 8,
                }}
              >
                Recent clients
              </p>
              <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {recent.map((c) => (
                  <li key={c.id} style={{ marginBottom: 6 }}>
                    <a
                      href={`/_dev/message-thread?clientId=${c.id}`}
                      style={{
                        fontSize: 13,
                        color: "var(--accent)",
                        textDecoration: "underline",
                      }}
                    >
                      {c.name}
                    </a>
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 11,
                        color: "var(--text-muted)",
                        fontFamily: "Menlo, Consolas, monospace",
                      }}
                    >
                      {c.id}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "var(--surface-base)",
      }}
    >
      <header
        style={{
          padding: "12px 20px",
          borderBottom: "1px solid var(--border)",
          backgroundColor: "var(--surface-raised)",
          fontSize: 12,
          color: "var(--text-muted)",
          fontFamily: "Menlo, Consolas, monospace",
        }}
      >
        DEV · clientId={clientId} · viewerRole={role}
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <MessageThread
          clientId={clientId}
          viewerRole={role as "owner" | "client"}
        />
      </div>
    </div>
  );
}
